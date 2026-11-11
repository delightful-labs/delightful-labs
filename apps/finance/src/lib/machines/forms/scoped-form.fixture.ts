import { afterEach, vi } from 'vitest'
import { z } from 'zod'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '#lib/contracts/form-contract.js'
import { createScopedFormMachine, selectScopedFormView } from './scoped-form.js'
import { createActor, setup, waitFor, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type Facts = { scope: string; allowed: boolean; publish?: boolean; broken?: boolean }
type Values = { name: string }
type Result = FormOperationResult<void, string>
export const schema = z.object({ name: z.string().trim().min(1) })
export const ready: Facts = { scope: 'workspace-a', allowed: true }
export const success: Result = {
	outcome: 'succeeded',
	value: undefined,
	settlement: 'locallyPersisted'
}
const cleanup: (() => void)[] = []
afterEach(() => {
	cleanup.splice(0).forEach((stop) => stop())
})

export function fixture(
	options: {
		schema?: z.ZodType<Values>
		retain?: boolean
		complete?: (scope: string, signal: AbortSignal) => Promise<void>
	} = {}
) {
	const received = vi.fn<(event: FormChildEvent<Facts>) => void>()
	const started = vi.fn<(input: FormOperationInput<Values, string, Facts>) => void>()
	const events1 = {
		INVALIDATE: types<EventPayload<FormChildEvent<Facts>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<Facts>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<Facts>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<Facts>, 'OBSERVE'>>()
	}
	type NativeEvent1 =
		| import('xstate').InferEvents<typeof events1>
		| import('xstate').DoneActorEvent<never>
		| import('xstate').ErrorActorEvent
	const availability = setup({
		schemas: {
			context: types<{
				observation: FormObservation<Facts>
				capability: FormCapability<string, string>
			}>(),
			events: events1,
			input: types<FormObservation<Facts>>()
		}
	}).createMachine({
		context: ({ input }) => ({ observation: input, capability: capability(input) }),
		on: {
			OBSERVE: (args) => {
				const { event } = args
				return {
					context: {
						observation: event.observation,
						capability:
							event.observation.facts.publish === false
								? args.context.capability
								: capability(event.observation)
					}
				}
			}
		}
	})
	const settlement = Promise.withResolvers<Result>()
	const aborted = vi.fn()
	const settle = createAsyncLogic<Result>({
		run: ({ signal }) => {
			signal.addEventListener('abort', aborted)
			return settlement.promise
		}
	})
	const events0 = {
		INVALIDATE: types<EventPayload<FormChildEvent<Facts>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<Facts>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<Facts>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<Facts>, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof settle>>
		| import('xstate').ErrorActorEvent
	const operation = setup({
		schemas: {
			context: types<{ input: FormOperationInput<Values, string, Facts>; result: Result }>(),
			events: events0,
			input: types<FormOperationInput<Values, string, Facts>>(),
			output: types<Result>(),
			children: {
				settle: types<import('xstate').ActorRefFrom<{ settle: typeof settle }['settle']>>()
			}
		},
		actors: { settle }
	}).createMachine({
		context: ({ input }) => ({ input, result: success }),
		initial: 'working',
		entry: ({ context }) => started(context.input),
		output: ({ context }) => context.result,
		states: {
			working: {
				invoke: {
					src: 'settle',
					onDone: (args) => {
						return { target: 'done', context: { result: args.event.output } }
					}
				},
				on: {
					OBSERVE: (args, enq) => {
						const { event } = args
						enq(() => received(event))
					},
					INVALIDATE: (args, enq) => {
						const { event } = args
						enq(() => received(event))
					},
					CANCEL: (args, enq) => {
						const { event } = args
						enq(() => received(event))
					},
					SHUTDOWN: (args, enq) => {
						const { event } = args
						enq(() => received(event))
					}
				}
			},
			done: { type: 'final' }
		}
	})
	const config = {
		...(options.complete ? { complete: options.complete } : {}),
		schema: options.schema ?? schema,
		availability,
		operation,
		selectAvailability: (snapshot: ReturnType<typeof availability.getInitialSnapshot>) => {
			if (snapshot.context.observation.facts.broken) throw new Error('projection failed')
			return snapshot.context.capability
		},
		scopeOf: (facts: Facts) => facts.scope,
		sameScope: (left: string, right: string) => left === right,
		successContent: options.retain ? 'retain' : 'replace'
	} satisfies Parameters<
		typeof createScopedFormMachine<
			Values,
			void,
			string,
			string,
			Facts,
			ReturnType<typeof availability.getInitialSnapshot>,
			ReturnType<typeof operation.getInitialSnapshot>
		>
	>[0]
	const actor = createActor(
		createScopedFormMachine<
			Values,
			void,
			string,
			string,
			Facts,
			ReturnType<typeof availability.getInitialSnapshot>,
			ReturnType<typeof operation.getInitialSnapshot>
		>(config),
		{ input: ready }
	).start()
	cleanup.push(() => actor.stop())
	const view = () =>
		selectScopedFormView<
			Values,
			void,
			string,
			string,
			Facts,
			ReturnType<typeof availability.getInitialSnapshot>,
			ReturnType<typeof operation.getInitialSnapshot>
		>(actor.getSnapshot(), config)
	const submit = () => actor.send({ type: 'SUBMIT', values: { name: ' Home ' } })
	const working = async () => {
		// Wait on the public progress report, not an incidental snapshot after a child entry action.
		await waitFor(actor, () => view().activity.kind === 'operating')
		const submission = actor.getSnapshot().children.submission
		const child = submission?.getSnapshot().children.operation
		if (!child) throw new Error('Operation did not start')
		return {
			send: (event: { type: 'SETTLE'; result: Result } | { type: 'CRASH' }) => {
				if (event.type === 'SETTLE') settlement.resolve(event.result)
				else settlement.reject(new Error('operation failed'))
			}
		}
	}
	const idle = () => waitFor(actor, (snapshot) => snapshot.matches({ open: { workflow: 'idle' } }))
	return { actor, view, submit, working, idle, received, started, config, settlement, aborted }
}
function capability(observation: FormObservation<Facts>): FormCapability<string, string> {
	return {
		revision: observation.revision,
		scope: observation.facts.scope,
		readiness: observation.facts.allowed
			? { kind: 'ready' }
			: { kind: 'blocked', reason: 'readOnly' }
	}
}
