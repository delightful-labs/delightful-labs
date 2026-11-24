import { createActor } from 'xstate'
import type { ActorOptions } from 'xstate'
import { vi } from 'vitest'
import {
	createSessionRuntimeMachine,
	createSessionRuntimeConnection
} from 'delightful-local-first/session/runtime'
import type { SessionRuntimeResource } from 'delightful-local-first/session/runtime'
import type {
	AccountCapabilities,
	AccountInput,
	AccountObservation,
	RootAccess
} from '../../contracts/account.js'
import { testLibraryCapability } from '../capture/library.test-support.js'

const machine = createSessionRuntimeMachine<AccountCapabilities>()
/** Controlled native leaves; the real shared session chart owns admission, retry and close. */
export function nativeSessionFixture(
	initial: AccountObservation = { status: 'signed-out', binding: {} },
	options?: { acquisition?: Promise<void>; clock?: ActorOptions<typeof machine>['clock'] }
) {
	let current = initial
	const listeners = new Set<(value: AccountObservation) => void>()
	const failures = new Set<() => void>()
	const emit = (value: AccountObservation) => {
		current = value
		for (const notify of listeners) notify(value)
	}
	const change = vi.fn<SessionRuntimeResource<AccountCapabilities>['changeIdentity']>(
		async () => 'completed'
	)
	const close = vi.fn(async () => {})
	const dispose = vi.fn(() => {})
	const resource: SessionRuntimeResource<AccountCapabilities> = {
		observe: (publish, failed) => {
			listeners.add(publish)
			failures.add(failed)
			publish(current)
			return () => {
				listeners.delete(publish)
				failures.delete(failed)
				dispose()
			}
		},
		changeIdentity: change,
		close
	}
	const open = vi.fn(async () => {
		await options?.acquisition
		return resource
	})
	const binding = {}
	const owner = createActor(machine, {
		input: { binding, capability: { open } },
		...(options?.clock ? { clock: options.clock } : {})
	})
	const session = createSessionRuntimeConnection(owner, binding)
	const parsePhrase = vi.fn(async (phrase: string) => {
		if (phrase !== 'valid synthetic phrase') throw new Error('Invalid synthetic phrase')
		return 'synthetic-secret'
	})
	const input: AccountInput = { session, parsePhrase }
	return {
		owner,
		session,
		input,
		resource,
		change,
		close,
		dispose,
		open,
		parsePhrase,
		emit,
		current: () => current,
		failObservation: () => {
			for (const fail of failures) fail()
		},
		listeners
	}
}
export function readyAccount(
	identityId = 'A',
	root: RootAccess = {
		read: async () => 'compatible',
		ensure: () => {
			throw new Error('Unexpected root write')
		}
	}
): Extract<AccountObservation, { status: 'ready' }> {
	return {
		status: 'ready',
		identityId,
		identityKind: 'backend',
		binding: {},
		localFirst: true,
		capabilities: {
			root,
			access: {
				workspaceId: identityId,
				subscribe: (publish) => {
					publish('allowed')
					return () => {}
				}
			},
			recovery: {
				source: {
					subscribe: (notify) => {
						notify({ kind: 'unavailable' })
						return () => {}
					}
				},
				capability: { isCurrentScope: () => false, readPhrase: async () => '' }
			},
			createLibrary: vi.fn(() =>
				testLibraryCapability({
					id: crypto.randomUUID(),
					title: identityId,
					text: 'local',
					html: '<p>local</p>',
					submittedUrl: 'https://example.com/',
					finalUrl: 'https://example.com/',
					provenance: '{}',
					imagesMissing: false
				})
			)
		}
	}
}
