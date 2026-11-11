import { afterEach, describe, expect, it } from 'vitest'
import type { FormSubmissionProgressEvent } from '#lib/contracts/form-contract.js'
import { createScopedFormSubmissionMachine } from './scoped-form-submission.js'
import { fixture, ready, schema, success } from './scoped-form.fixture.js'
import { createActor, waitFor, createStepLogic } from 'xstate'
import { collectEvents } from '../report-collector.fixture.js'

const cleanup: (() => void)[] = []
afterEach(() => {
	for (const stop of cleanup.splice(0)) stop()
})
const progress = (
	requestId: number,
	scopeRevision: number,
	progress: FormSubmissionProgressEvent['progress']
): FormSubmissionProgressEvent => ({
	type: 'FORM_SUBMISSION_PROGRESS',
	requestId,
	scopeRevision,
	progress
})

function submission() {
	const validation = Promise.withResolvers<void>()
	const f = fixture({
		schema: schema.superRefine(async () => {
			await validation.promise
		})
	})
	const recipient = collectEvents<FormSubmissionProgressEvent>()
	const actor = createActor(createScopedFormSubmissionMachine(f.config), {
		input: {
			request: { id: 9, scope: ready.scope, scopeRevision: 4, values: { name: ' Private draft ' } },
			observation: { revision: 7, facts: ready },
			recipient
		}
	}).start()
	cleanup.push(
		() => actor.stop(),
		() => recipient.stop()
	)
	return { ...f, submission: actor, validation, reports: () => recipient.getSnapshot().context }
}

describe('public submission progress protocol', () => {
	it('publishes only correlated progress to a real recipient and releases the recipient on success', async () => {
		const f = submission()
		expect(f.reports()).toEqual([progress(9, 4, 'validating')])
		f.submission.send({ type: 'OBSERVE', observation: { revision: 8, facts: ready } })
		f.validation.resolve()
		await waitFor(f.submission, (snapshot) => snapshot.hasTag('operating'))
		expect(f.reports()).toEqual([progress(9, 4, 'validating'), progress(9, 4, 'operating')])
		expect(f.started.mock.calls[0]?.[0].observation.revision).toBe(8)
		f.settlement.resolve(success)
		const done = await waitFor(f.submission, (snapshot) => snapshot.status === 'done')
		expect(done.output).toEqual(success)
		expect(done.context.recipient).toBeUndefined()
		expect(f.reports()).toHaveLength(2)
	})
	it.each(['CANCEL', 'INVALIDATE', 'SHUTDOWN'] satisfies ('CANCEL' | 'INVALIDATE' | 'SHUTDOWN')[])(
		'publishes no operating progress after %s during validation',
		async (type) => {
			const f = submission()
			f.submission.send({ type })
			expect(f.submission.getSnapshot().status).toBe('active')
			f.validation.resolve()
			const done = await waitFor(f.submission, (snapshot) => snapshot.status === 'done')
			expect(f.reports()).toEqual([progress(9, 4, 'validating')])
			expect(f.started).not.toHaveBeenCalled()
			expect(done.context.recipient).toBeUndefined()
			expect(done.output?.settlement).toBe('notStarted')
		}
	)
})

describe('form consumption of submission progress', () => {
	it('notifies parent subscribers from validation through operation and result without copying child snapshots', async () => {
		const validation = Promise.withResolvers<void>()
		const f = fixture({
			schema: schema.superRefine(async () => {
				await validation.promise
			})
		})
		const activities: string[] = []
		const subscription = f.actor.subscribe(() => activities.push(f.view().activity.kind))
		cleanup.push(() => subscription.unsubscribe())
		f.submit()
		expect(f.view().activity.kind).toBe('validating')
		expect(f.actor.getSnapshot().context).not.toHaveProperty('submission')
		f.actor.send({ type: 'OBSERVE', observation: ready })
		validation.resolve()
		await f.working()
		expect(f.view().activity.kind).toBe('operating')
		f.settlement.resolve(success)
		await f.idle()
		expect(activities).toContain('validating')
		expect(activities).toContain('operating')
		expect(activities.at(-1)).toBe('idle')
		expect(f.view().feedback).toEqual({ kind: 'result', result: success })
	})
	it.each([
		{ requestId: 0, scopeRevision: 0 },
		{ requestId: 2, scopeRevision: 0 },
		{ requestId: 1, scopeRevision: -1 },
		{ requestId: 1, scopeRevision: 1 }
	])(
		'rejects progress from request $requestId / scope revision $scopeRevision',
		async ({ requestId, scopeRevision }) => {
			const validation = Promise.withResolvers<void>()
			const f = fixture({
				schema: schema.superRefine(async () => {
					await validation.promise
				})
			})
			f.submit()
			f.actor.send(progress(requestId, scopeRevision, 'operating'))
			expect(f.view().activity.kind).toBe('validating')
			expect(f.started).not.toHaveBeenCalled()
			validation.resolve()
			await f.working()
			f.actor.send(progress(requestId, scopeRevision, 'validating'))
			expect(f.view().activity.kind).toBe('operating')
			f.settlement.resolve(success)
			await f.idle()
		}
	)
	for (const stage of ['validating', 'operating']) {
		it.each(['CANCEL', 'INVALIDATE', 'SHUTDOWN'] satisfies (
			'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'
		)[])(
			`ignores matching late progress after %s while ${stage}, retaining actual settlement`,
			async (type) => {
				const validation = Promise.withResolvers<void>()
				const f = fixture({
					schema: schema.superRefine(async () => {
						await validation.promise
					})
				})
				f.submit()
				if (stage === 'operating') {
					validation.resolve()
					await f.working()
				}
				f.actor.send({ type })
				const activity = f.view().activity
				f.actor.send(progress(1, 0, 'operating'))
				f.actor.send(progress(1, 0, 'validating'))
				expect(f.view().activity).toEqual(activity)
				expect(f.view().activity.kind).toBe('settling')
				expect(f.actor.getSnapshot().status).toBe('active')
				expect(f.aborted).not.toHaveBeenCalled()
				validation.resolve()
				f.settlement.resolve(success)
				if (type === 'SHUTDOWN') await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
				else {
					await f.idle()
					expect(f.view().feedback).toMatchObject({
						kind: 'result',
						result: { settlement: stage === 'operating' ? 'locallyPersisted' : 'notStarted' }
					})
				}
				if (stage === 'validating') expect(f.started).not.toHaveBeenCalled()
			}
		)
	}
	it.each([false, true])(
		'rejects a previous request during a later submission (scope replaced: %s)',
		async (replaceScope) => {
			const nextValidation = Promise.withResolvers<void>()
			let attempts = 0
			const f = fixture({
				retain: true,
				schema: schema.superRefine(async () => {
					if (attempts++ > 0) await nextValidation.promise
				})
			})
			f.submit()
			await f.working()
			if (replaceScope) {
				f.actor.send({ type: 'OBSERVE', observation: { ...ready, scope: 'b' } })
				f.actor.send({ type: 'OBSERVE', observation: ready })
				f.actor.send(progress(1, 0, 'validating'))
				expect(f.view().activity).toEqual({ kind: 'settling', reason: 'scopeChanged' })
			}
			f.settlement.resolve(success)
			await f.idle()
			f.actor.send(progress(1, 0, 'validating'))
			expect(f.view().activity.kind).toBe('idle')
			f.submit()
			expect(f.actor.getSnapshot().context.request?.id).toBe(2)
			expect(f.view().activity.kind).toBe('validating')
			f.actor.send(progress(1, 0, 'operating'))
			if (replaceScope) f.actor.send(progress(2, 0, 'operating'))
			expect(f.view().activity.kind).toBe('validating')
			nextValidation.resolve()
			await f.idle()
			expect(f.started).toHaveBeenCalledTimes(2)
		}
	)
})
