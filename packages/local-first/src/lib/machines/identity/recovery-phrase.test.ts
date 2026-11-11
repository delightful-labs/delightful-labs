import { setImmediate } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, waitFor, type Actor } from 'xstate'
import type {
	AvailableRecoveryScope,
	RecoveryPhraseCapability,
	RecoveryPhraseView,
	RecoveryScope
} from '../../contracts/recovery-phrase.js'
import { createRecoveryPhraseMachine, selectRecoveryPhraseView } from './recovery-phrase.js'

type RecoveryActor = Actor<ReturnType<typeof createRecoveryPhraseMachine>>
const actors: RecoveryActor[] = []

function availableScope(): AvailableRecoveryScope {
	return { kind: 'available', identityId: 'identity-a', binding: {}, generation: 0 }
}

function pendingPhrase() {
	let resolve = (_value: string): void => {
		throw new Error('Deferred phrase has not been initialized')
	}
	let reject = (_error: Error): void => {
		throw new Error('Deferred phrase has not been initialized')
	}
	const promise = new Promise<string>((complete, fail) => {
		resolve = complete
		reject = fail
	})
	return { promise, resolve, reject }
}

function startRecovery(initial: RecoveryScope = availableScope(), current = true) {
	const readPhrase = vi
		.fn<RecoveryPhraseCapability['readPhrase']>()
		.mockResolvedValue('synthetic phrase')
	const isCurrentScope = vi
		.fn<RecoveryPhraseCapability['isCurrentScope']>()
		.mockReturnValue(current)
	const actor = createActor(createRecoveryPhraseMachine({ readPhrase, isCurrentScope }), {
		input: initial
	})
	const published: RecoveryPhraseView['kind'][] = []
	actor.subscribe((snapshot) => published.push(selectRecoveryPhraseView(snapshot).kind))
	actors.push(actor)
	actor.start()
	return {
		actor,
		readPhrase,
		isCurrentScope,
		published,
		view: () => selectRecoveryPhraseView(actor.getSnapshot())
	}
}

afterEach(() => {
	for (const actor of actors.splice(0)) {
		if (actor.getSnapshot().status === 'active') actor.send({ type: 'SHUTDOWN' })
		actor.stop()
	}
})

describe('recovery phrase workflow', () => {
	it('does not export while unavailable, then uses the observed available scope', async () => {
		const { actor, readPhrase, view } = startRecovery({ kind: 'unavailable' })
		actor.send({ type: 'REVEAL' })
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'COMPLETE' })
		expect(view()).toEqual({ kind: 'unavailable' })
		expect(readPhrase).not.toHaveBeenCalled()
		const scope = availableScope()
		actor.send({ type: 'OBSERVE', scope })
		expect(view()).toEqual({ kind: 'hidden' })
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		expect(readPhrase).toHaveBeenCalledExactlyOnceWith(scope)
	})

	it('rejects an initially stale scope and clears its binding', () => {
		const { actor, readPhrase, view } = startRecovery(availableScope(), false)
		actor.send({ type: 'REVEAL' })
		expect(view()).toEqual({ kind: 'unavailable' })
		expect(actor.getSnapshot().context).toEqual({
			scope: { kind: 'unavailable' },
			phrase: undefined
		})
		expect(readPhrase).not.toHaveBeenCalled()
	})

	it('requires current acknowledgement for completion and resets it on reopen', async () => {
		const { actor, view } = startRecovery()
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		expect(view()).toEqual({
			kind: 'revealed',
			phrase: 'synthetic phrase',
			confirmation: 'unconfirmed'
		})
		actor.send({ type: 'COMPLETE' })
		expect(view()).toMatchObject({ kind: 'revealed', confirmation: 'unconfirmed' })
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'CONFIRM', value: false })
		actor.send({ type: 'COMPLETE' })
		expect(view()).toMatchObject({ kind: 'revealed', confirmation: 'unconfirmed' })
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'COMPLETE' })
		expect(view()).toEqual({ kind: 'hidden' })
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		expect(view()).toMatchObject({ kind: 'revealed', confirmation: 'unconfirmed' })
	})

	it('allows ordinary dismissal without acknowledgement', async () => {
		const { actor, view } = startRecovery()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		actor.send({ type: 'HIDE' })
		expect(view()).toEqual({ kind: 'hidden' })
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
	})

	it('preserves the interaction for equivalent observations without another export', async () => {
		const scope = availableScope()
		const { actor, readPhrase, view } = startRecovery(scope)
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'OBSERVE', scope: { ...scope } })
		expect(view()).toMatchObject({ kind: 'revealed', confirmation: 'confirmed' })
		expect(readPhrase).toHaveBeenCalledTimes(1)
	})

	it.each([
		{ name: 'identity', replacement: { identityId: 'identity-b' } },
		{ name: 'binding', replacement: { binding: {} } },
		{ name: 'generation', replacement: { generation: 1 } }
	])('clears revealed material on $name replacement', async ({ replacement }) => {
		const scope = availableScope()
		const { actor, readPhrase, view } = startRecovery(scope)
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'OBSERVE', scope: { ...scope, ...replacement } })
		expect(view()).toEqual({ kind: 'hidden' })
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		expect(view()).toMatchObject({ kind: 'revealed', confirmation: 'unconfirmed' })
		expect(readPhrase).toHaveBeenCalledTimes(2)
	})

	it('clears revealed data when access becomes unavailable', async () => {
		const { actor, view } = startRecovery()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		actor.send({ type: 'OBSERVE', scope: { kind: 'unavailable' } })
		expect(view()).toEqual({ kind: 'unavailable' })
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
	})

	it.each(['hide', 'unavailable', 'shutdown'])('discards late success after %s', async (change) => {
		const pending = pendingPhrase()
		const { actor, readPhrase, published, view } = startRecovery()
		readPhrase.mockReturnValueOnce(pending.promise)
		actor.send({ type: 'REVEAL' })
		actor.send({ type: 'REVEAL' })
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'COMPLETE' })
		expect(view()).toEqual({ kind: 'revealing' })
		expect(readPhrase).toHaveBeenCalledTimes(1)
		if (change === 'hide') actor.send({ type: 'HIDE' })
		if (change === 'unavailable') actor.send({ type: 'OBSERVE', scope: { kind: 'unavailable' } })
		if (change === 'shutdown') actor.send({ type: 'SHUTDOWN' })
		pending.resolve('synthetic late value')
		await setImmediate()
		expect(published).not.toContain('revealed')
		expect(view().kind).toBe(
			change === 'hide' ? 'hidden' : change === 'shutdown' ? 'closed' : 'unavailable'
		)
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
	})

	it.each(['hide', 'shutdown'])('discards late failure after %s', async (change) => {
		const pending = pendingPhrase()
		const { actor, readPhrase, published, view } = startRecovery()
		readPhrase.mockReturnValueOnce(pending.promise)
		actor.send({ type: 'REVEAL' })
		actor.send({ type: change === 'hide' ? 'HIDE' : 'SHUTDOWN' })
		pending.reject(new Error('synthetic failure'))
		await setImmediate()
		expect(published).not.toContain('failed')
		expect(view()).toEqual({ kind: change === 'hide' ? 'hidden' : 'closed' })
	})

	it('does not publish the first A result after A → B → A while a new reveal is pending', async () => {
		const initial = availableScope()
		const oldResult = pendingPhrase()
		const newResult = pendingPhrase()
		const { actor, readPhrase, published, view } = startRecovery(initial)
		readPhrase.mockReturnValueOnce(oldResult.promise).mockReturnValueOnce(newResult.promise)
		actor.send({ type: 'REVEAL' })
		actor.send({ type: 'OBSERVE', scope: { ...initial, identityId: 'identity-b', generation: 1 } })
		actor.send({ type: 'OBSERVE', scope: { ...initial, generation: 2 } })
		actor.send({ type: 'REVEAL' })
		oldResult.resolve('synthetic obsolete phrase')
		await setImmediate()
		expect(view()).toEqual({ kind: 'revealing' })
		expect(published).not.toContain('revealed')
		newResult.resolve('synthetic current phrase')
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		expect(view()).toMatchObject({ kind: 'revealed', phrase: 'synthetic current phrase' })
	})

	it('rechecks the live binding before accepting output even without an OBSERVE event', async () => {
		const pending = pendingPhrase()
		const { actor, readPhrase, isCurrentScope, published, view } = startRecovery()
		readPhrase.mockReturnValueOnce(pending.promise)
		actor.send({ type: 'REVEAL' })
		isCurrentScope.mockReturnValue(false)
		pending.resolve('synthetic stale phrase')
		await waitFor(actor, (snapshot) => snapshot.matches('unavailable'), { timeout: 1000 })
		expect(view()).toEqual({ kind: 'unavailable' })
		expect(published).not.toContain('revealed')
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
	})

	it('rechecks availability before an ordinary reveal', () => {
		const { actor, readPhrase, isCurrentScope, view } = startRecovery()
		isCurrentScope.mockReturnValue(false)
		actor.send({ type: 'REVEAL' })
		expect(view()).toEqual({ kind: 'unavailable' })
		expect(readPhrase).not.toHaveBeenCalled()
	})

	it('reports failure without retaining the raw error and retries with current scope', async () => {
		const { actor, readPhrase, view } = startRecovery()
		readPhrase.mockRejectedValueOnce(new Error('synthetic private detail'))
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('failed'), { timeout: 1000 })
		expect(view()).toEqual({ kind: 'failed' })
		expect(actor.getSnapshot().context.phrase).toBeUndefined()
		expect(JSON.stringify(actor.getSnapshot().context)).not.toContain('synthetic private detail')
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		expect(readPhrase).toHaveBeenCalledTimes(2)
	})

	it('does not retry an export after its scope becomes stale', async () => {
		const { actor, readPhrase, isCurrentScope, view } = startRecovery()
		readPhrase.mockRejectedValueOnce(new Error('synthetic failure'))
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('failed'), { timeout: 1000 })
		isCurrentScope.mockReturnValue(false)
		actor.send({ type: 'RETRY' })
		expect(view()).toEqual({ kind: 'unavailable' })
		expect(readPhrase).toHaveBeenCalledTimes(1)
	})

	it.each(['', '  \n  '])(
		'rejects an empty or blank phrase without retaining it',
		async (value) => {
			const { actor, readPhrase, view } = startRecovery()
			readPhrase.mockResolvedValueOnce(value)
			actor.send({ type: 'REVEAL' })
			await waitFor(actor, (snapshot) => snapshot.matches('failed'), { timeout: 1000 })
			expect(view()).toEqual({ kind: 'failed' })
			expect(actor.getSnapshot().context.phrase).toBeUndefined()
		}
	)

	it('invalidates rather than reports failure when an old binding rejects', async () => {
		const pending = pendingPhrase()
		const { actor, readPhrase, isCurrentScope, view } = startRecovery()
		readPhrase.mockReturnValueOnce(pending.promise)
		actor.send({ type: 'REVEAL' })
		isCurrentScope.mockReturnValue(false)
		pending.reject(new Error('synthetic stale binding'))
		await waitFor(actor, (snapshot) => snapshot.matches('unavailable'), { timeout: 1000 })
		expect(view()).toEqual({ kind: 'unavailable' })
	})

	it.each(['confirm', 'complete'])(
		'clears material if the binding is stale at %s',
		async (command) => {
			const { actor, isCurrentScope, view } = startRecovery()
			actor.send({ type: 'REVEAL' })
			await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
			if (command === 'complete') actor.send({ type: 'CONFIRM', value: true })
			isCurrentScope.mockReturnValue(false)
			if (command === 'confirm') actor.send({ type: 'CONFIRM', value: true })
			if (command === 'complete') actor.send({ type: 'COMPLETE' })
			expect(view()).toEqual({ kind: 'unavailable' })
			expect(actor.getSnapshot().context.phrase).toBeUndefined()
		}
	)

	it('clears phrase and binding on shutdown and stays closed after later commands', async () => {
		const { actor, readPhrase, view } = startRecovery()
		actor.send({ type: 'REVEAL' })
		await waitFor(actor, (snapshot) => snapshot.matches('revealed'), { timeout: 1000 })
		actor.send({ type: 'CONFIRM', value: true })
		actor.send({ type: 'SHUTDOWN' })
		expect(view()).toEqual({ kind: 'closed' })
		expect(actor.getSnapshot().status).toBe('done')
		expect(actor.getSnapshot().context).toEqual({
			scope: { kind: 'unavailable' },
			phrase: undefined
		})
		actor.send({ type: 'OBSERVE', scope: availableScope() })
		actor.send({ type: 'REVEAL' })
		expect(view()).toEqual({ kind: 'closed' })
		expect(readPhrase).toHaveBeenCalledTimes(1)
	})
})
