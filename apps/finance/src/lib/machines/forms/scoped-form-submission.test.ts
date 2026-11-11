import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createScopedFormSubmissionMachine } from './scoped-form-submission.js'
import { fixture, ready, success } from './scoped-form.fixture.js'
import { createActor, waitFor } from 'xstate'

function submission(options: Parameters<typeof fixture>[0] = {}) {
	const f = fixture(options)
	const actor = createActor(createScopedFormSubmissionMachine(f.config), {
		input: {
			request: { id: 1, scope: ready.scope, scopeRevision: 0, values: { name: 'Home' } },
			observation: { revision: 0, facts: ready }
		}
	}).start()
	return { ...f, submission: actor }
}

describe('scoped form submission resources', () => {
	it.each(['CANCEL', 'INVALIDATE', 'SHUTDOWN'] satisfies ('CANCEL' | 'INVALIDATE' | 'SHUTDOWN')[])(
		'awaits asynchronous validation even when it rejects after %s; releases payloads',
		async (type) => {
			const gate = Promise.withResolvers<void>()
			const f = submission({
				schema: z.object({ name: z.string() }).superRefine(async () => {
					await gate.promise
					throw new Error('late private validation error')
				})
			})
			try {
				f.submission.send({ type })
				expect(f.submission.getSnapshot().status).toBe('active')
				gate.resolve()
				const done = await waitFor(f.submission, (snapshot) => snapshot.status === 'done')
				expect(done.output).toEqual({
					outcome:
						type === 'CANCEL' ? 'cancelled' : type === 'INVALIDATE' ? 'scopeChanged' : 'closed',
					settlement: 'notStarted'
				})
				expect(done.context).toMatchObject({
					validated: undefined,
					observation: undefined,
					request: { values: undefined }
				})
				expect(f.started).not.toHaveBeenCalled()
			} finally {
				f.submission.stop()
			}
		}
	)

	it('forwards the latest observations during validation and operation, then clears transient inputs', async () => {
		const gate = Promise.withResolvers<void>()
		const f = submission({
			schema: z.object({ name: z.string() }).superRefine(async () => {
				await gate.promise
			})
		})
		try {
			const observation = { revision: 7, facts: ready }
			f.submission.send({ type: 'OBSERVE', observation })
			gate.resolve()
			await waitForOperation(f)
			expect(f.started.mock.calls[0]?.[0].observation).toEqual(observation)
			f.submission.send({ type: 'OBSERVE', observation: { ...observation, revision: 8 } })
			expect(f.received).toHaveBeenCalledWith({
				type: 'OBSERVE',
				observation: { ...observation, revision: 8 }
			})
			f.settlement.resolve(success)
			const done = await waitFor(f.submission, (snapshot) => snapshot.status === 'done')
			expect(done.output).toEqual(success)
			expect(done.context).toMatchObject({
				validated: undefined,
				observation: undefined,
				request: { values: undefined }
			})
		} finally {
			f.submission.stop()
		}
	})

	it('preserves an operation checkpoint when interruption changes its outcome', async () => {
		const checkpoint = { transactionId: 'stable-transaction', checkId: 'stable-check' }
		const f = submission()
		try {
			await waitForOperation(f)
			f.submission.send({ type: 'CANCEL' })
			f.settlement.resolve({ ...success, checkpoint })
			const done = await waitFor(f.submission, (snapshot) => snapshot.status === 'done')
			expect(done.output).toEqual({
				outcome: 'cancelled',
				settlement: 'locallyPersisted',
				checkpoint
			})
			expect(done.context.request).toMatchObject({ values: undefined, checkpoint: undefined })
		} finally {
			f.submission.stop()
		}
	})

	it.each([
		{ outcome: 'denied', reason: 'readOnly', settlement: 'notStarted' },
		{ outcome: 'unavailable', reason: 'missingRecord', settlement: 'notStarted' },
		{
			outcome: 'partial',
			value: undefined,
			reason: 'oneWriteFailed',
			settlement: 'locallyPersisted'
		}
	] satisfies import('#lib/contracts/form-contract.js').FormOperationResult<void, string>[])(
		'preserves domain $outcome outcomes without reclassification',
		async (result) => {
			const f = submission()
			try {
				await waitForOperation(f)
				f.settlement.resolve(result)
				const done = await waitFor(f.submission, (snapshot) => snapshot.status === 'done')
				expect(done.value).toBe(result.outcome)
				expect(done.output).toEqual(result)
			} finally {
				f.submission.stop()
			}
		}
	)
})

async function waitForOperation(f: ReturnType<typeof submission>) {
	await waitFor(f.submission, (snapshot) => snapshot.hasTag('operating'))
}
