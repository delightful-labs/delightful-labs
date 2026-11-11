import { afterEach, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { formatAuthSecret } from 'jazz-tools'
import { accountStoreOperationMachine } from '../../src/lib/machines/runtime/account-store-operation.js'
import type {
	AccountStoreRequest,
	AccountStoreStorage
} from '../../src/lib/machines/runtime/account-store-contracts.js'
import {
	accountStorageBinding,
	isEarlierSelectionKey
} from '../../src/lib/runtime/worker/account-selection.js'
import { WorkerHostError } from '../../src/lib/runtime/worker/host-protocol.js'

export const roots = [1, 2, 3].map((value) => formatAuthSecret(new Uint8Array(32).fill(value)))
export function selection(values: string[], selected: number | null = 0, extra: object = {}) {
	return JSON.stringify({
		format: 'jazz-account-selection-v1',
		roots: values,
		selected: values.length ? selected : null,
		...extra
	})
}
export const legacyScope = '11111111-1111-4111-8111-111111111111'
const cleanups = new Set<() => Promise<void>>()
afterEach(async () => {
	for (const close of cleanups) await close()
	cleanups.clear()
})
export function fixture(
	request: AccountStoreRequest,
	options: {
		start?: boolean
		current?: string | null
		earlier?: { registry: string; value: string }[]
		readGate?: Promise<void>
		writeGate?: Promise<void>
		closeGate?: Promise<void>
		afterWrite?: (values: Map<string, string>, legacyKey: (registry: string) => string) => void
	} = {}
) {
	const environment = crypto.randomUUID()
	const binding = accountStorageBinding(
		'https://finance.example/jazz/apps/current/accounts',
		environment,
		legacyScope
	)
	const legacyKey = (registry: string) =>
		`jazz-account-selection-v1:${encodeURIComponent(registry)}:${encodeURIComponent(environment)}`
	const values = new Map<string, string>()
	if (options.current !== null) values.set(binding.key, options.current ?? selection([roots[0]!]))
	for (const entry of options.earlier ?? []) values.set(legacyKey(entry.registry), entry.value)
	const enteredWrite = Promise.withResolvers<void>(),
		enteredClose = Promise.withResolvers<void>()
	const defaultWrite = Promise.withResolvers<void>(),
		defaultClose = Promise.withResolvers<void>()
	const trace: string[] = []
	let hostClosed = false
	const storage = {
		scope: crypto.randomUUID(),
		readSnapshot: vi.fn(async () => {
			trace.push('read')
			await options.readGate
			return {
				current: values.get(binding.key) ?? null,
				earlier: [...values]
					.filter(([key]) => isEarlierSelectionKey(binding, key))
					.map(([key, value]) => ({ key, value }))
			}
		}),
		writePrimary: vi.fn(async (value: string) => {
			trace.push('write-issued')
			enteredWrite.resolve()
			await (options.writeGate ?? defaultWrite.promise)
			if (hostClosed) throw new WorkerHostError('closed', 'not-issued')
			values.set(binding.key, value)
			trace.push('write-acknowledged')
			options.afterWrite?.(values, legacyKey)
		}),
		readEarlier: vi.fn(async (key: string) => {
			trace.push('legacy-read')
			return values.get(key) ?? null
		}),
		writeEarlier: vi.fn(async (key: string, value: string) => {
			if (hostClosed) throw new WorkerHostError('closed', 'not-issued')
			trace.push('legacy-write')
			values.set(key, value)
		}),
		closeHostAndDrain: vi.fn(async () => {
			trace.push('close-request')
			enteredClose.resolve()
			await (options.closeGate ?? defaultClose.promise)
			hostClosed = true
		})
	} satisfies AccountStoreStorage
	const actor = createActor(accountStoreOperationMachine, {
		input: { request, binding, storage, locks: navigator.locks }
	})
	if (options.start !== false) actor.start()
	const closeHost = () => {
		hostClosed = true
		defaultClose.resolve()
		actor.send({ type: 'HOST_CLOSED', scope: storage.scope })
	}
	cleanups.add(async () => {
		if (actor.getSnapshot().status !== 'done') {
			closeHost()
			actor.send({ type: 'SHUTDOWN' })
			defaultWrite.resolve()
		}
		await waitFor(actor, (snapshot) => snapshot.status === 'done', { timeout: 2000 })
		actor.stop()
	})
	return {
		actor,
		storage,
		binding,
		values,
		trace,
		legacyKey,
		enteredWrite,
		enteredClose,
		defaultWrite,
		defaultClose,
		closeHost,
		held: async () =>
			(await navigator.locks.query()).held?.some((lock) => lock.name === binding.key) ?? false
	}
}
