import { describe, expect, it, vi } from 'vitest'
import type { FormOperationResult } from '#lib/contracts/form-contract.js'
import { fixture, ready, success } from './scoped-form.fixture.js'
import { waitFor } from 'xstate'

describe('post-save navigation ownership', () => {
	it('keeps fields visible and disabled from persistence through navigation, without a success screen', async () => {
		const navigation = Promise.withResolvers<void>()
		const complete = vi.fn(() => navigation.promise)
		const f = fixture({ complete })
		const visibleContent: string[] = []
		f.actor.subscribe(() => visibleContent.push(f.view().content.kind))
		f.submit()
		const operation = await f.working()
		expect(complete).not.toHaveBeenCalled()
		operation.send({ type: 'SETTLE', result: success })
		await waitFor(f.actor, (s) => s.matches({ open: { workflow: { completion: 'navigating' } } }))
		expect(complete).toHaveBeenCalledExactlyOnceWith(ready.scope, expect.any(AbortSignal))
		expect(f.view()).toMatchObject({
			content: { kind: 'fields' },
			activity: { kind: 'operating' },
			feedback: { kind: 'none' },
			fieldsEditable: false,
			canSubmit: false,
			canReset: false
		})
		f.submit()
		f.actor.send({ type: 'RESET' })
		f.actor.send({ type: 'OPEN' })
		expect(f.started).toHaveBeenCalledTimes(1)
		expect(complete).toHaveBeenCalledTimes(1)
		navigation.resolve()
		await waitFor(f.actor, (s) => s.matches({ open: { workflow: { completion: 'completed' } } }))
		expect(visibleContent).not.toContain('success')
		expect(f.view().fieldsEditable).toBe(false)
		expect(f.view().canSubmit).toBe(false)
	})

	it('retries failed navigation without repeating persistence or losing the saved outcome', async () => {
		const first = Promise.withResolvers<void>()
		const second = Promise.withResolvers<void>()
		const complete = vi
			.fn<(scope: string, signal: AbortSignal) => Promise<void>>()
			.mockImplementationOnce(() => first.promise)
			.mockImplementationOnce(() => second.promise)
		const f = fixture({ complete })
		f.submit()
		const operation = await f.working()
		operation.send({ type: 'SETTLE', result: success })
		await waitFor(f.actor, () => complete.mock.calls.length === 1)
		first.reject(new Error('Navigation failed'))
		await waitFor(f.actor, (s) => s.matches({ open: { workflow: { completion: 'failed' } } }))
		expect(f.view()).toMatchObject({
			canSubmit: true,
			fieldsEditable: false,
			feedback: {
				kind: 'result',
				result: { outcome: 'failed', code: 'completionFailed', settlement: 'locallyPersisted' }
			}
		})
		expect(f.actor.getSnapshot().context.result).toEqual(success)
		f.submit()
		expect(complete).toHaveBeenCalledTimes(2)
		expect(f.started).toHaveBeenCalledTimes(1)
		expect(f.view().canSubmit).toBe(false)
		second.resolve()
		await waitFor(f.actor, (s) => s.matches({ open: { workflow: { completion: 'completed' } } }))
		expect(f.actor.getSnapshot().context.result).toEqual(success)
	})

	it('does not hide the saved form or cancel navigation during same-scope availability refreshes', async () => {
		const navigation = Promise.withResolvers<void>()
		const complete = vi.fn((_scope: string, _signal: AbortSignal) => navigation.promise)
		const f = fixture({ complete })
		f.submit()
		const operation = await f.working()
		operation.send({ type: 'SETTLE', result: success })
		await waitFor(f.actor, () => complete.mock.calls.length === 1)
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, publish: false } })
		expect(f.view().readiness.kind).toBe('ready')
		f.actor.send({ type: 'OBSERVE', observation: { ...ready, allowed: false } })
		expect(complete.mock.calls[0]?.[1].aborted).toBe(false)
		expect(f.view()).toMatchObject({
			content: { kind: 'fields' },
			fieldsEditable: false,
			canSubmit: false
		})
		navigation.resolve()
		await waitFor(f.actor, (s) => s.matches({ open: { workflow: { completion: 'completed' } } }))
		expect(f.started).toHaveBeenCalledTimes(1)
	})

	it.each(['scopeChanged', 'cancelled', 'shutdown'])(
		'aborts navigation on %s and ignores its late resolution',
		async (outcome) => {
			const navigation = Promise.withResolvers<void>()
			const complete = vi.fn((_scope: string, _signal: AbortSignal) => navigation.promise)
			const f = fixture({ complete })
			f.submit()
			const operation = await f.working()
			operation.send({ type: 'SETTLE', result: success })
			await waitFor(f.actor, () => complete.mock.calls.length === 1)
			if (outcome === 'scopeChanged')
				f.actor.send({ type: 'OBSERVE', observation: { ...ready, scope: 'workspace-b' } })
			else f.actor.send({ type: outcome === 'shutdown' ? 'SHUTDOWN' : 'CANCEL' })
			expect(complete.mock.calls[0]?.[1].aborted).toBe(true)
			const before = f.actor.getSnapshot()
			navigation.resolve()
			await navigation.promise
			expect(f.actor.getSnapshot()).toBe(before)
			expect(f.view().feedback.kind).toBe('none')
			expect(f.started).toHaveBeenCalledTimes(1)
		}
	)

	it.each([
		{ outcome: 'failed', code: 'operationFailed', settlement: 'rejected' },
		{ outcome: 'partial', value: undefined, reason: 'partial', settlement: 'locallyPersisted' },
		{ outcome: 'cancelled', settlement: 'notStarted' }
	] satisfies FormOperationResult<void, string>[])(
		'does not navigate for a $outcome persistence outcome',
		async (result) => {
			const complete = vi.fn(async () => {})
			const f = fixture({ complete })
			f.submit()
			const operation = await f.working()
			operation.send({ type: 'SETTLE', result })
			await f.idle()
			expect(complete).not.toHaveBeenCalled()
			expect(f.view().feedback).toEqual({ kind: 'result', result })
		}
	)

	it('does not navigate for invalid input or a success settling after shutdown', async () => {
		const complete = vi.fn(async () => {})
		const f = fixture({ complete })
		f.actor.send({ type: 'SUBMIT', values: { name: '' } })
		await f.idle()
		expect(f.started).not.toHaveBeenCalled()
		f.submit()
		const operation = await f.working()
		f.actor.send({ type: 'SHUTDOWN' })
		operation.send({ type: 'SETTLE', result: success })
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(complete).not.toHaveBeenCalled()
	})
})
