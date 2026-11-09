import type { EventPayload } from '../../contracts/machine-events.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createStepLogic, setup, waitFor, createAsyncLogic, types } from 'xstate'
import { createScopedFormSubmissionMachine } from './submission.js'
import type {
	FormChildEvent,
	FormIssue,
	FormObservation,
	FormOperationInput,
	FormOperationResult,
	FormSubmissionProgressEvent
} from '../../contracts/scoped-form.js'

type Values = { name: string }
type Scope = { binding: object; workspace: string }
type Facts = { scope: Scope; version: number }
type Input = FormOperationInput<Values, Scope, Facts>
type Output = FormOperationResult<{ id: string }, 'denied' | 'missing'>
const actors = new Set<{ stop: () => void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function deferred<Value>() {
	let resolve!: (value: Value) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<Value>((accept, fail) => {
		resolve = accept
		reject = fail
	})
	return { promise, resolve, reject }
}
const success: Output = {
	outcome: 'succeeded',
	value: { id: 'saved' },
	settlement: 'locallyPersisted'
}
function fixture(report = true) {
	const validation = deferred<Values>()
	const completion = deferred<Output>()
	const started = vi.fn<(input: Input) => void>()
	const received = vi.fn<(event: FormChildEvent<Facts>) => void>()
	const validationIssues = vi.fn<(_error: unknown) => readonly FormIssue[] | undefined>(
		() => undefined
	)
	const schema = { parseAsync: vi.fn((_value: unknown) => validation.promise) }
	const operation = setup({
		schemas: {
			context: types<{ input: Input; result: Output | undefined }>(),
			events: {
				CANCEL: types<EventPayload<FormChildEvent<Facts>, 'CANCEL'>>(),
				SHUTDOWN: types<EventPayload<FormChildEvent<Facts>, 'SHUTDOWN'>>(),
				INVALIDATE: types<EventPayload<FormChildEvent<Facts>, 'INVALIDATE'>>(),
				OBSERVE: types<EventPayload<FormChildEvent<Facts>, 'OBSERVE'>>()
			},
			input: types<Input>()
		},
		actors: { complete: createAsyncLogic<Output>({ run: () => completion.promise }) }
	}).createMachine({
		initial: 'working',
		context: ({ input }) => {
			started(input)
			return { input, result: undefined }
		},
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing synthetic result')
			return context.result
		},
		states: {
			working: {
				invoke: {
					src: 'complete',
					onDone: (args) => {
						return { target: 'done', context: { result: args.event.output } }
					},
					onError: { target: 'crashed' }
				},
				on: {
					OBSERVE: (args, enq) => {
						const { event } = args
						enq(() => received(event))
					},
					CANCEL: (args, enq) => {
						const { event } = args
						enq(() => received(event))
					},
					INVALIDATE: (args, enq) => {
						const { event } = args
						enq(() => received(event))
					},
					SHUTDOWN: (args, enq) => {
						const { event } = args
						enq(() => received(event))
					}
				}
			},
			done: { type: 'final' },
			crashed: {
				entry: () => {
					throw new Error('Unexpected operation actor failure')
				}
			}
		}
	})
	const scope = { binding: {}, workspace: 'one' }
	const checkpoint = { operation: 'previous-attempt' }
	const request = { id: 11, scope, scopeRevision: 5, values: { name: ' Raw ' }, checkpoint }
	const observation: FormObservation<Facts> = { revision: 1, facts: { scope, version: 1 } }
	const reporter = createActor(
		createStepLogic({
			context: (): FormSubmissionProgressEvent[] => [],
			run: ({
				context,
				event
			}: {
				context: FormSubmissionProgressEvent[]
				event: FormSubmissionProgressEvent
			}) => ({
				context:
					event.type !== 'FORM_SUBMISSION_PROGRESS'
						? context
						: ((events: FormSubmissionProgressEvent[], event: FormSubmissionProgressEvent) => [
								...events,
								event
							])(context, event)
			})
		})
	).start()
	actors.add(reporter)
	const actor = createActor(
		createScopedFormSubmissionMachine({ schema, validationIssues, operation }),
		{
			input: { request, observation, ...(report ? { recipient: reporter } : {}) }
		}
	)
	actors.add(actor)
	const errors: unknown[] = []
	actor.subscribe({ error: (error) => errors.push(error) })
	const done = async () =>
		(await waitFor(actor, (snapshot) => snapshot.status === 'done', { timeout: 1_000 })).output
	const operating = async () => {
		validation.resolve({ name: 'Clean' })
		await vi.waitFor(() => expect(started).toHaveBeenCalledOnce())
	}
	const cleared = () => {
		expect(actor.getSnapshot().context).toMatchObject({
			request: { values: undefined, checkpoint: undefined },
			validated: undefined,
			observation: undefined,
			recipient: undefined
		})
	}
	return {
		actor,
		validation,
		completion,
		schema,
		validationIssues,
		started,
		received,
		reporter,
		request,
		observation,
		checkpoint,
		errors,
		done,
		operating,
		cleared
	}
}
const interruptions = [
	{ type: 'CANCEL', outcome: 'cancelled' },
	{ type: 'INVALIDATE', outcome: 'scopeChanged' },
	{ type: 'SHUTDOWN', outcome: 'closed' }
] satisfies {
	type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'
	outcome: 'cancelled' | 'scopeChanged' | 'closed'
}[]

describe('shared scoped submission lifetime', () => {
	it('passes transformed values and the latest observation, forwards live facts and correlates progress', async () => {
		const f = fixture()
		f.actor.start()
		expect(f.schema.parseAsync).toHaveBeenCalledExactlyOnceWith(f.request.values)
		const latest = { revision: 2, facts: { ...f.observation.facts, version: 2 } }
		f.actor.send({ type: 'OBSERVE', observation: latest })
		await f.operating()
		expect(f.started).toHaveBeenCalledExactlyOnceWith({
			request: { ...f.request, values: { name: 'Clean' } },
			observation: latest
		})
		const live = { revision: 3, facts: { ...latest.facts, version: 3 } }
		f.actor.send({ type: 'OBSERVE', observation: live })
		expect(f.received).toHaveBeenCalledExactlyOnceWith({ type: 'OBSERVE', observation: live })
		expect(f.reporter.getSnapshot().context).toEqual([
			{ type: 'FORM_SUBMISSION_PROGRESS', requestId: 11, scopeRevision: 5, progress: 'validating' },
			{ type: 'FORM_SUBMISSION_PROGRESS', requestId: 11, scopeRevision: 5, progress: 'operating' }
		])
		f.completion.resolve(success)
		expect(await f.done()).toEqual(success)
		f.cleared()
		expect(f.request.values).toEqual({ name: ' Raw ' })
	})
	it('supports a consumer without a progress recipient', async () => {
		const f = fixture(false)
		f.actor.start()
		await f.operating()
		f.completion.resolve(success)
		expect(await f.done()).toEqual(success)
		expect(f.reporter.getSnapshot().context).toEqual([])
		f.cleared()
	})
	it.each([
		{ issues: [] },
		{ issues: [{ path: ['name'], code: 'required', message: 'Caller validation' }] }
	] satisfies { issues: readonly FormIssue[] }[])(
		'classifies normalized issues exactly once, including an empty issue array',
		async ({ issues }) => {
			const f = fixture()
			const error = new Error('Native validation error')
			f.validationIssues.mockReturnValue(issues)
			f.actor.start()
			f.validation.reject(error)
			expect(await f.done()).toEqual({ outcome: 'invalid', issues, settlement: 'notStarted' })
			expect(f.validationIssues).toHaveBeenCalledExactlyOnceWith(error)
			expect(f.started).not.toHaveBeenCalled()
			f.cleared()
		}
	)
	it('reports unexpected parser failure generically without exposing the error or invoking the operation', async () => {
		const f = fixture()
		f.actor.start()
		f.validation.reject(new Error('Private parser detail'))
		expect(await f.done()).toEqual({
			outcome: 'failed',
			code: 'validationFailed',
			settlement: 'notStarted'
		})
		expect(f.started).not.toHaveBeenCalled()
		f.cleared()
	})
	it('exposes a throwing error normalizer to the supervising owner', async () => {
		const f = fixture()
		const error = new Error('Normalizer crashed')
		f.validationIssues.mockImplementation(() => {
			throw error
		})
		f.actor.start()
		f.validation.reject(new Error('Parser failed'))
		await vi.waitFor(() => expect(f.errors).toEqual([error]))
		expect(f.actor.getSnapshot().status).toBe('error')
		expect(f.started).not.toHaveBeenCalled()
	})
	for (const rejects of [false, true]) {
		it.each(interruptions)(
			`waits for ${rejects ? 'rejecting' : 'successful'} validation after $type and prevents operation start`,
			async ({ type, outcome }) => {
				const f = fixture()
				f.actor.start()
				f.actor.send({ type })
				expect(f.actor.getSnapshot().status).toBe('active')
				if (rejects) f.validation.reject(new Error('Late validation failure'))
				else f.validation.resolve({ name: 'Late validated' })
				expect(await f.done()).toEqual({ outcome, settlement: 'notStarted' })
				expect(f.started).not.toHaveBeenCalled()
				expect(f.validationIssues).not.toHaveBeenCalled()
				f.cleared()
			}
		)
	}
	it('keeps shutdown above queued validation cancellation and scope changes', async () => {
		const f = fixture()
		f.actor.start()
		for (const type of [
			'CANCEL',
			'INVALIDATE',
			'SHUTDOWN',
			'CANCEL',
			'INVALIDATE'
		] satisfies FormChildEvent<Facts>['type'][]) {
			f.actor.send({ type })
		}
		f.validation.resolve({ name: 'Late' })
		expect(await f.done()).toEqual({ outcome: 'closed', settlement: 'notStarted' })
		expect(f.started).not.toHaveBeenCalled()
		f.cleared()
	})
	it.each(interruptions)(
		'forwards $type and drains the operation with recovery evidence intact',
		async ({ type, outcome }) => {
			const f = fixture()
			f.actor.start()
			await f.operating()
			f.actor.send({ type })
			expect(f.received).toHaveBeenCalledExactlyOnceWith({ type })
			expect(f.actor.getSnapshot().status).toBe('active')
			f.completion.resolve({ ...success, checkpoint: f.checkpoint })
			expect(await f.done()).toEqual({
				outcome,
				settlement: 'locallyPersisted',
				checkpoint: f.checkpoint
			})
			f.cleared()
		}
	)
	const outcomes = [
		success,
		{ outcome: 'succeeded', value: { id: 'confirmed' }, settlement: 'confirmed' },
		{
			outcome: 'partial',
			value: { id: 'partial' },
			reason: 'missing',
			settlement: 'unknown',
			checkpoint: { retry: 'reconcile' }
		},
		{
			outcome: 'partial',
			value: { id: 'partial-local' },
			reason: 'missing',
			settlement: 'locallyPersisted'
		},
		{ outcome: 'denied', reason: 'denied', settlement: 'notStarted' },
		{ outcome: 'unavailable', reason: 'missing', settlement: 'notStarted' },
		{ outcome: 'failed', code: 'operationFailed', settlement: 'rejected' },
		{ outcome: 'failed', code: 'operationFailed', settlement: 'unknown' },
		{ outcome: 'scopeChanged', settlement: 'locallyPersisted' }
	] satisfies Output[]
	it.each(outcomes)(
		'retains $outcome / $settlement instead of inventing success or replay',
		async (output) => {
			const f = fixture()
			f.actor.start()
			await f.operating()
			f.completion.resolve(output)
			expect(await f.done()).toEqual(output)
			expect(f.started).toHaveBeenCalledOnce()
			f.cleared()
		}
	)
	it.each([{ type: undefined, outcome: 'failed' }, ...interruptions])(
		'reports an unexpected operation crash after $type with unknown settlement',
		async ({ type, outcome }) => {
			const f = fixture()
			f.actor.start()
			await f.operating()
			if (type) f.actor.send({ type })
			f.completion.reject(new Error('Private operation failure'))
			expect(await f.done()).toEqual(
				outcome === 'failed'
					? { outcome, code: 'operationFailed', settlement: 'unknown' }
					: { outcome, settlement: 'unknown' }
			)
			expect(f.errors).toEqual([])
			f.cleared()
		}
	)
	it('retains shutdown precedence and uncertainty while a failed operation drains', async () => {
		const f = fixture()
		f.actor.start()
		await f.operating()
		f.actor.send({ type: 'CANCEL' })
		f.actor.send({ type: 'INVALIDATE' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'OBSERVE', observation: { ...f.observation, revision: 9 } })
		f.actor.send({ type: 'CANCEL' })
		expect(f.received.mock.calls.map(([event]) => event.type)).toEqual([
			'CANCEL',
			'INVALIDATE',
			'SHUTDOWN'
		])
		f.completion.reject(new Error('Late operation failure'))
		expect(await f.done()).toEqual({ outcome: 'closed', settlement: 'unknown' })
		f.cleared()
	})
})
