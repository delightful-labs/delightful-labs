import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor, createCallbackLogic, waitFor } from 'xstate'
import type {
	RestorationCapability,
	RestorationEvent,
	RestorationIdentity,
	RestorationReport
} from '../../contracts/restoration.js'
import { createRestorationMachine, restorationMachine } from './restoration.js'

function deferred<Value>() {
	let resolve = (_value: Value): void => {
		throw new Error('Deferred result not initialized')
	}
	let reject = (_error: Error): void => {
		throw new Error('Deferred result not initialized')
	}
	const promise = new Promise<Value>((done, fail) => {
		resolve = done
		reject = fail
	})
	return { promise, resolve, reject }
}

const actors = new Set<{ stop: () => void }>()
const interruptions = [
	'CANCEL',
	'SHUTDOWN',
	'BINDING_INVALIDATED'
] satisfies RestorationEvent['type'][]

function startFixture(overrides: Partial<RestorationCapability>, entry: 'fixed' | 'supplied') {
	const scope = { binding: {}, attempt: 7 }
	let current = true
	const reports: RestorationReport[] = []
	const recipient = createActor(
		createCallbackLogic<RestorationReport>(({ receive }) =>
			receive((report) => reports.push(report))
		)
	).start()
	const parse = vi.fn(async () => 'synthetic credential')
	const restore = vi.fn(async () => {})
	const identity = vi.fn(async (): Promise<RestorationIdentity> => ({
		kind: 'ready',
		identityId: 'restored-user'
	}))
	const capability: RestorationCapability = {
		parsePhrase: parse,
		restoreIdentity: restore,
		readIdentity: identity,
		isCurrentBinding: (binding) => binding === scope.binding && current,
		...overrides
	}
	const logic = entry === 'fixed' ? createRestorationMachine(capability) : restorationMachine
	const input = { capability, scope, phrase: 'synthetic phrase', reportTo: recipient }
	const actor = createActor(logic, { input }).start()
	actors.add(actor)
	actors.add(recipient)
	return {
		actor,
		scope,
		reports,
		parse,
		restore,
		identity,
		invalidate: () => {
			current = false
		},
		prepare: () => actor.send({ type: 'PREPARED', ...scope })
	}
}

async function completed(f: ReturnType<typeof startFixture>) {
	return (await waitFor(f.actor, (snapshot) => snapshot.status === 'done')).output
}

function secretsCleared(f: ReturnType<typeof startFixture>) {
	expect(f.actor.getSnapshot().context.phrase).toBeUndefined()
	expect(f.actor.getSnapshot().context.credential).toBeUndefined()
}

afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})

describe.each(['fixed', 'supplied'] satisfies ('fixed' | 'supplied')[])(
	'restoration child protocol (%s)',
	(entry) => {
		const fixture = (overrides: Partial<RestorationCapability> = {}) =>
			startFixture(overrides, entry)
		it('reports correlated preparation, waits for a matching permit, and releases credentials on issue', async () => {
			const pending = deferred<void>()
			const restore = vi.fn(() => pending.promise)
			const f = fixture({ restoreIdentity: restore })
			f.prepare() // A premature permit cannot skip validation/preparation.
			await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
			expect(f.reports).toEqual([
				{ type: 'RESTORATION_VALIDATED', ...f.scope },
				{ type: 'RESTORATION_PREPARE_REQUESTED', ...f.scope }
			])
			expect(f.actor.getSnapshot().context.phrase).toBeUndefined()
			f.actor.send({ type: 'PREPARED', ...f.scope, attempt: 6 })
			f.actor.send({ type: 'PREPARED', ...f.scope, binding: {} })
			expect(restore).not.toHaveBeenCalled()
			f.prepare()
			f.prepare()
			await waitFor(f.actor, (s) => s.matches({ restoring: 'active' }))
			expect(restore).toHaveBeenCalledExactlyOnceWith(f.scope, 'synthetic credential')
			secretsCleared(f)
			pending.resolve()
			expect(await completed(f)).toEqual({
				...f.scope,
				outcome: 'restored',
				mutation: 'settled',
				identityId: 'restored-user'
			})
			secretsCleared(f)
			f.prepare()
			expect(restore).toHaveBeenCalledTimes(1)
		})

		it.each(['rejection', 'empty', 'whitespace'])(
			'rejects %s before drain or mutation',
			async (failure) => {
				const f = fixture({
					parsePhrase: async () => {
						if (failure === 'rejection') throw new Error('private parsing error')
						return failure === 'empty' ? '' : '   '
					}
				})
				expect(await completed(f)).toEqual({
					...f.scope,
					outcome: 'invalid',
					mutation: 'notStarted'
				})
				expect(f.reports).toEqual([])
				expect(f.restore).not.toHaveBeenCalled()
				secretsCleared(f)
			}
		)

		it('does not parse when the initial binding is invalid', async () => {
			const f = fixture({ isCurrentBinding: () => false })
			expect(await completed(f)).toEqual({
				...f.scope,
				outcome: 'cancelled',
				mutation: 'notStarted'
			})
			expect(f.parse).not.toHaveBeenCalled()
			secretsCleared(f)
		})

		for (const type of interruptions) {
			it.each([false, true])(`discards late parsing after ${type} (reject: %s)`, async (reject) => {
				const pending = deferred<string>()
				const f = fixture({ parsePhrase: () => pending.promise })
				f.actor.send({ type })
				expect(await completed(f)).toEqual({
					...f.scope,
					outcome: 'cancelled',
					mutation: 'notStarted'
				})
				if (reject) pending.reject(new Error('private parser failure'))
				else pending.resolve('late synthetic credential')
				await Promise.resolve()
				expect(f.reports).toEqual([])
				expect(f.restore).not.toHaveBeenCalled()
				secretsCleared(f)
			})

			it(`cancels preparation on ${type} without issuing restore`, async () => {
				const f = fixture()
				await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
				f.actor.send({ type })
				f.prepare()
				expect(await completed(f)).toEqual({
					...f.scope,
					outcome: 'cancelled',
					mutation: 'notStarted'
				})
				expect(f.restore).not.toHaveBeenCalled()
				secretsCleared(f)
			})

			it.each([false, true])(
				`retains the same issued call after ${type} (reject: %s)`,
				async (reject) => {
					const pending = deferred<void>()
					const restore = vi.fn(() => pending.promise)
					const f = fixture({ restoreIdentity: restore })
					await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
					f.prepare()
					const invocation = Object.values(f.actor.getSnapshot().children)[0]
					f.actor.send({ type })
					for (const interruption of interruptions) f.actor.send({ type: interruption })
					f.prepare()
					expect(f.actor.getSnapshot().matches({ restoring: 'settlingCancellation' })).toBe(true)
					expect(f.actor.getSnapshot().status).toBe('active')
					expect(invocation).toBeDefined()
					expect(Object.values(f.actor.getSnapshot().children)[0]).toBe(invocation)
					secretsCleared(f)
					if (reject) pending.reject(new Error('private SDK failure'))
					else pending.resolve()
					expect(await completed(f)).toEqual({
						...f.scope,
						outcome: 'cancelled',
						mutation: 'settled'
					})
					expect(restore).toHaveBeenCalledTimes(1)
					expect(f.identity).not.toHaveBeenCalled()
					secretsCleared(f)
				}
			)

			it(`discards late identity observation after ${type}`, async () => {
				const pending = deferred<RestorationIdentity>()
				const f = fixture({ readIdentity: () => pending.promise })
				await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
				f.prepare()
				await waitFor(f.actor, (s) => s.matches('readingIdentity'))
				f.actor.send({ type })
				pending.resolve({ kind: 'ready', identityId: 'late-user' })
				expect(await completed(f)).toEqual({
					...f.scope,
					outcome: 'cancelled',
					mutation: 'settled'
				})
				secretsCleared(f)
			})
		}

		it('rechecks a silently invalidated binding before accepting a permit', async () => {
			const f = fixture()
			await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
			f.invalidate()
			f.prepare()
			expect(await completed(f)).toEqual({
				...f.scope,
				outcome: 'cancelled',
				mutation: 'notStarted'
			})
			expect(f.restore).not.toHaveBeenCalled()
			secretsCleared(f)
		})

		it.each([false, true])(
			'rechecks binding on late SDK settlement (reject: %s)',
			async (reject) => {
				const pending = deferred<void>()
				const f = fixture({ restoreIdentity: () => pending.promise })
				await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
				f.prepare()
				f.invalidate()
				if (reject) pending.reject(new Error('private SDK failure'))
				else pending.resolve()
				expect(await completed(f)).toEqual({
					...f.scope,
					outcome: 'cancelled',
					mutation: 'settled'
				})
				expect(f.identity).not.toHaveBeenCalled()
				secretsCleared(f)
			}
		)

		it.each([false, true])(
			'rejects a stale binding after parsing settles (reject: %s)',
			async (reject) => {
				const pending = deferred<string>()
				const f = fixture({ parsePhrase: () => pending.promise })
				f.invalidate()
				if (reject) pending.reject(new Error('private parsing failure'))
				else pending.resolve('synthetic credential')
				expect(await completed(f)).toEqual({
					...f.scope,
					outcome: 'cancelled',
					mutation: 'notStarted'
				})
				expect(f.reports).toEqual([])
				expect(f.restore).not.toHaveBeenCalled()
				secretsCleared(f)
			}
		)

		it.each([false, true])('rejects stale identity observation (reject: %s)', async (reject) => {
			const pending = deferred<RestorationIdentity>()
			const f = fixture({ readIdentity: () => pending.promise })
			await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
			f.prepare()
			await waitFor(f.actor, (s) => s.matches('readingIdentity'))
			f.invalidate()
			if (reject) pending.reject(new Error('private identity failure'))
			else pending.resolve({ kind: 'ready', identityId: 'stale-user' })
			expect(await completed(f)).toEqual({ ...f.scope, outcome: 'cancelled', mutation: 'settled' })
			secretsCleared(f)
		})

		it('reports sanitized failure without automatic retry', async () => {
			const restore = vi.fn(async () => {
				throw new Error('private SDK failure')
			})
			const f = fixture({ restoreIdentity: restore })
			await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
			f.prepare()
			expect(await completed(f)).toEqual({ ...f.scope, outcome: 'failed', mutation: 'settled' })
			f.prepare()
			expect(restore).toHaveBeenCalledTimes(1)
			secretsCleared(f)
		})

		it.each(['unavailable', 'empty', 'rejection'])(
			'reports partial completion on %s identity',
			async (failure) => {
				const f = fixture({
					readIdentity: async () => {
						if (failure === 'rejection') throw new Error('private snapshot failure')
						return failure === 'empty'
							? { kind: 'ready', identityId: '  ' }
							: { kind: 'unavailable' }
					}
				})
				await waitFor(f.actor, (s) => s.matches('awaitingPreparation'))
				f.prepare()
				expect(await completed(f)).toEqual({
					...f.scope,
					outcome: 'identityUnavailable',
					mutation: 'settled'
				})
				secretsCleared(f)
			}
		)
	}
)
