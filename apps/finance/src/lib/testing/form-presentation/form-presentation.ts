import { z } from 'zod'
import type {
	FormCapability,
	FormChildEvent,
	FormObservation,
	FormOperationInput,
	FormOperationResult
} from '../../contracts/form-contract.js'
import type { ScopedFormOptions } from '../../machines/forms/scoped-form.js'
import { setup, types, createAsyncLogic } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

export type Facts = { scope: string; allowed: boolean; publish?: boolean; broken?: boolean }
type Values = { name: string }
type Result = FormOperationResult<void, string>

export function harnessOptions(controls: {
	observe: () => Facts
	validate?: () => Promise<void>
	start: () => Promise<Result>
	command: (event: FormChildEvent<Facts>) => void
}) {
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
			context: types<{ observation: FormObservation<Facts> }>(),
			events: events1,
			input: types<FormObservation<Facts>>()
		}
	}).createMachine({
		context: ({ input }) => ({ observation: input }),
		on: {
			OBSERVE: (args) => {
				return { context: { observation: args.event.observation } }
			}
		}
	})
	const settle = createAsyncLogic<Result>({ run: () => controls.start() })
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
			context: types<{ result: Result }>(),
			events: events0,
			input: types<FormOperationInput<Values, string, Facts>>(),
			output: types<Result>(),
			children: {
				settle: types<import('xstate').ActorRefFrom<{ settle: typeof settle }['settle']>>()
			}
		},
		actors: { settle }
	}).createMachine({
		context: { result: { outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' } },
		initial: 'working',
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
						enq(() => controls.command(event))
					},
					INVALIDATE: (args, enq) => {
						const { event } = args
						enq(() => controls.command(event))
					},
					CANCEL: (args, enq) => {
						const { event } = args
						enq(() => controls.command(event))
					},
					SHUTDOWN: (args, enq) => {
						const { event } = args
						enq(() => controls.command(event))
					}
				}
			},
			done: { type: 'final' }
		}
	})
	const fields = z.object({ name: z.string().trim().min(1) })
	const validate = controls.validate
	return {
		schema: validate
			? fields.superRefine(async () => {
					await validate()
				})
			: fields,
		availability,
		operation,
		selectAvailability: (
			snapshot: ReturnType<typeof availability.getInitialSnapshot>
		): FormCapability<string, string> => {
			const { revision, facts } = snapshot.context.observation
			if (facts.broken) throw new Error('Synthetic readiness projection failure')
			return {
				revision: facts.publish === false ? -1 : revision,
				scope: facts.scope,
				readiness: facts.allowed ? { kind: 'ready' } : { kind: 'blocked', reason: 'readOnly' }
			}
		},
		scopeOf: (facts: Facts) => facts.scope,
		sameScope: (left: string, right: string) => left === right,
		observe: controls.observe
	} satisfies ScopedFormOptions<
		Values,
		void,
		string,
		string,
		Facts,
		ReturnType<typeof availability.getInitialSnapshot>,
		ReturnType<typeof operation.getInitialSnapshot>
	> & { observe: () => Facts }
}
