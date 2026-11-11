import { describe, expect, it } from 'vitest'
import { fixture, ready, success, schema } from './scoped-form.fixture.js'
import { waitFor } from 'xstate'

describe('scoped form ownership', () => {
	it('uses the same readiness for views and direct submissions, rejecting stale reports', () => {
		const f = fixture()
		expect(f.view().canSubmit).toBe(true)
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, allowed: false } })
		expect(f.view().readiness).toEqual({ kind: 'blocked', reason: 'readOnly' })
		f.submit()
		expect(f.actor.getSnapshot().context.sequence).toBe(0)
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, publish: false } })
		expect(f.view().readiness).toEqual({ kind: 'observing' })
		f.actor.send({
			type: 'FORM_CAPABILITY_REPORTED',
			generation: f.actor.getSnapshot().context.watchGeneration,
			capability: { revision: 1, scope: ready.scope, readiness: { kind: 'ready' } }
		})
		f.submit()
		expect(f.view().canSubmit).toBe(false)
		expect(f.started).not.toHaveBeenCalled()
		f.actor.send({
			type: 'FORM_CAPABILITY_REPORTED',
			generation: f.actor.getSnapshot().context.watchGeneration,
			capability: { revision: 2, scope: 'other', readiness: { kind: 'ready' } }
		})
		expect(f.view().canSubmit).toBe(false)
		f.actor.send({ type: 'OBSERVE', observation: ready })
		expect(f.view().canSubmit).toBe(true)
	})

	it('rejects duplicate submissions and reset/reopen while busy; projects nested progress and void success', async () => {
		const f = fixture()
		const activities: string[] = []
		f.actor.subscribe(() => activities.push(f.view().activity.kind))
		f.submit()
		expect(f.view().activity.kind).toBe('validating')
		f.submit()
		f.actor.send({ type: 'RESET' })
		f.actor.send({ type: 'OPEN' })
		const operation = await f.working()
		f.submit()
		f.actor.send({ type: 'RESET' })
		expect(f.view().draftRevision).toBe(0)
		expect(f.view().canReset).toBe(false)
		expect(f.started).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				request: expect.objectContaining({ values: { name: 'Home' }, scope: ready.scope })
			})
		)
		operation.send({ type: 'SETTLE', result: success })
		await f.idle()
		expect(activities).toContain('operating')
		expect(f.view().content).toEqual({ kind: 'success', value: undefined })
		expect(f.view().canSubmit).toBe(false)
		f.actor.send({ type: 'OPEN' })
		expect(f.view().content.kind).toBe('fields')
		expect(f.view().draftRevision).toBe(1)
		expect(f.view().feedback.kind).toBe('none')
		f.actor.send({ type: 'OPEN' })
		expect(f.view().draftRevision).toBe(1)
		f.actor.send({ type: 'RESET' })
		expect(f.view().draftRevision).toBe(2)
	})

	it('can retain inline fields after void success', async () => {
		const f = fixture({ retain: true })
		f.submit()
		const child = await f.working()
		child.send({ type: 'SETTLE', result: success })
		await f.idle()
		expect(f.view().content.kind).toBe('fields')
		expect(f.view().canSubmit).toBe(true)
		expect(f.view().feedback).toEqual({ kind: 'result', result: success })
	})

	it('retains a partial checkpoint separately and supplies it to the next submission', async () => {
		const f = fixture()
		const checkpoint = { transactionId: 'stable-transaction', checkId: 'stable-check' }
		f.submit()
		const first = await f.working()
		first.send({
			type: 'SETTLE',
			result: {
				outcome: 'partial',
				value: undefined,
				reason: 'transactionFailed',
				settlement: 'locallyPersisted',
				checkpoint
			}
		})
		await f.idle()
		expect(f.view().feedback).toMatchObject({ result: { outcome: 'partial', checkpoint } })
		expect(f.actor.getSnapshot().context.checkpoint).toEqual(checkpoint)
		f.submit()
		await f.working()
		expect(f.started.mock.calls[1]?.[0].request.checkpoint).toEqual(checkpoint)
	})

	it('keeps a checkpoint from drained cancellation and clears it on reset or scope replacement', async () => {
		const f = fixture()
		const checkpoint = { transactionId: 'stable-transaction' }
		f.submit()
		const child = await f.working()
		f.actor.send({ type: 'CANCEL' })
		child.send({
			type: 'SETTLE',
			result: { outcome: 'failed', code: 'operationFailed', settlement: 'unknown', checkpoint }
		})
		await f.idle()
		expect(f.view().feedback).toMatchObject({ result: { outcome: 'cancelled', checkpoint } })
		expect(f.actor.getSnapshot().context.checkpoint).toEqual(checkpoint)
		f.actor.send({ type: 'RESET' })
		expect(f.actor.getSnapshot().context.checkpoint).toBeUndefined()
		f.submit()
		await f.working()
		expect(f.started.mock.calls[1]?.[0].request.checkpoint).toBeUndefined()
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, scope: 'workspace-b' } })
		expect(f.actor.getSnapshot().context.checkpoint).toBeUndefined()
	})

	it('normalizes invalid fields, permits correction, and distinguishes validation failures', async () => {
		const f = fixture()
		f.actor.send({ type: 'SUBMIT', values: { name: '' } })
		await f.idle()
		expect(f.view().feedback).toEqual({
			kind: 'result',
			result: {
				outcome: 'invalid',
				settlement: 'notStarted',
				issues: [
					{
						path: ['name'],
						code: 'too_small',
						message: 'Too small: expected string to have >=1 characters'
					}
				]
			}
		})
		expect(f.started).not.toHaveBeenCalled()
		f.submit()
		const child = await f.working()
		child.send({ type: 'SETTLE', result: success })
		await f.idle()
		expect(f.view().feedback).toEqual({ kind: 'result', result: success })
		const broken = fixture({
			schema: schema.transform(() => {
				throw new Error('private details')
			})
		})
		broken.submit()
		await broken.idle()
		expect(broken.view().feedback).toEqual({
			kind: 'result',
			result: { outcome: 'failed', code: 'validationFailed', settlement: 'notStarted' }
		})
	})

	it.each(['CANCEL', 'INVALIDATE', 'SHUTDOWN'] satisfies ('CANCEL' | 'INVALIDATE' | 'SHUTDOWN')[])(
		'awaits validation settlement for %s without starting domain work',
		async (type) => {
			const gate = Promise.withResolvers<void>()
			const f = fixture({
				schema: schema.superRefine(async () => {
					await gate.promise
				})
			})
			f.submit()
			f.actor.send({ type })
			expect(f.view().activity.kind).toBe('settling')
			expect(f.actor.getSnapshot().status).toBe('active')
			gate.resolve()
			if (type === 'SHUTDOWN') await waitFor(f.actor, (s) => s.status === 'done')
			else await f.idle()
			expect(f.started).not.toHaveBeenCalled()
			expect(f.view().feedback).toEqual(
				type === 'SHUTDOWN'
					? { kind: 'none' }
					: {
							kind: 'result',
							result: {
								outcome: type === 'CANCEL' ? 'cancelled' : 'scopeChanged',
								settlement: 'notStarted'
							}
						}
			)
		}
	)

	it.each(['locallyPersisted', 'rejected'] satisfies ('locallyPersisted' | 'rejected')[])(
		'preserves %s settlement when permission is lost after work starts',
		async (settlement) => {
			const f = fixture()
			f.submit()
			const child = await f.working()
			f.actor.send({ type: 'OBSERVE', observation: { ...ready, allowed: false } })
			expect(f.view().activity).toEqual({ kind: 'settling', reason: 'scopeChanged' })
			expect(f.received).toHaveBeenCalledWith({ type: 'INVALIDATE' })
			f.actor.send({ type: 'CANCEL' })
			f.submit()
			child.send({
				type: 'SETTLE',
				result:
					settlement === 'locallyPersisted'
						? success
						: { outcome: 'failed', code: 'operationFailed', settlement }
			})
			await f.idle()
			expect(f.view().feedback).toEqual({
				kind: 'result',
				result: { outcome: 'scopeChanged', settlement }
			})
			expect(f.started).toHaveBeenCalledTimes(1)
		}
	)

	it('isolates old results when scope changes away and back before settlement', async () => {
		const f = fixture()
		f.submit()
		const child = await f.working()
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, scope: 'b' } })
		f.actor.send({ type: 'OBSERVE', observation: ready })
		f.submit()
		expect(f.view().canSubmit).toBe(false)
		child.send({ type: 'SETTLE', result: { ...success, checkpoint: { transactionId: 'stale' } } })
		await f.idle()
		expect(f.view().feedback.kind).toBe('none')
		expect(f.actor.getSnapshot().context.checkpoint).toBeUndefined()
		expect(f.view().draftRevision).toBe(2)
		expect(f.view().canSubmit).toBe(true)
	})

	it('keeps shutdown above later cancellation, observation, reset, retry and completion; clears retained payloads', async () => {
		const f = fixture()
		f.submit()
		const child = await f.working()
		f.actor.send({ type: 'CANCEL' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'CANCEL' })
		f.actor.send({ type: 'RESET' })
		f.actor.send({ type: 'RETRY_READINESS' })
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, scope: 'b' } })
		expect(f.view().activity).toEqual({ kind: 'settling', reason: 'closed' })
		expect(f.actor.getSnapshot().status).toBe('active')
		child.send({ type: 'SETTLE', result: success })
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.actor.getSnapshot().context).toMatchObject({
			observation: undefined,
			scope: undefined,
			request: undefined,
			result: undefined,
			capability: undefined
		})
		expect(f.actor.getSnapshot().context).not.toHaveProperty('submission')
		expect(f.view().readiness.kind).toBe('closed')
	})

	it('settles active work on availability failure and allows readiness retry only afterward', async () => {
		const f = fixture()
		f.submit()
		const child = await f.working()
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, broken: true } })
		expect(f.view().readiness.kind).toBe('failed')
		expect(f.view().activity).toEqual({ kind: 'settling', reason: 'scopeChanged' })
		f.actor.send({ type: 'RETRY_READINESS' })
		expect(f.view().canRetryReadiness).toBe(false)
		f.actor.send({ type: 'OBSERVE', observation: ready })
		child.send({ type: 'SETTLE', result: success })
		await f.idle()
		expect(f.view().canSubmit).toBe(false)
		f.actor.send({ type: 'RETRY_READINESS' })
		expect(f.view().canSubmit).toBe(true)
		expect(f.started).toHaveBeenCalledTimes(1)
	})

	it.each(['pending', 'cancelled', 'invalidated', 'closed'])(
		'supervises operation failure while %s',
		async (phase) => {
			const f = fixture()
			f.submit()
			const child = await f.working()
			if (phase === 'cancelled') f.actor.send({ type: 'CANCEL' })
			if (phase === 'invalidated') f.actor.send({ type: 'INVALIDATE' })
			if (phase === 'closed') f.actor.send({ type: 'SHUTDOWN' })
			child.send({ type: 'CRASH' })
			if (phase === 'closed') {
				await waitFor(f.actor, (s) => s.status === 'done')
				expect(f.view().readiness.kind).toBe('closed')
			} else {
				await f.idle()
				expect(f.view().feedback).toEqual({
					kind: 'result',
					result:
						phase === 'pending'
							? { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
							: {
									outcome: phase === 'cancelled' ? 'cancelled' : 'scopeChanged',
									settlement: 'unknown'
								}
				})
			}
		}
	)
})
