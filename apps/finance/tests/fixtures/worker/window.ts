import type { operations } from './operations.js'
export type FixtureOperation = keyof typeof operations
export type FixtureArguments<Key extends FixtureOperation> = Parameters<(typeof operations)[Key]>
export type FixtureResult<Key extends FixtureOperation> = Awaited<
	ReturnType<(typeof operations)[Key]>
>
export type FixtureHost = {
	request: <Key extends FixtureOperation>(
		operation: Key,
		args: FixtureArguments<Key>
	) => Promise<FixtureResult<Key>>
}
declare global {
	interface Window {
		financeFixture: FixtureHost
		financeWorkerFault?:
			'fail-account-storage-once' | 'fail-bank-lock-once' | 'fail-workspace-journal'
	}
}
let captured: Worker | undefined
export function registerFixtureWorker(worker: Worker) {
	captured = worker
	if (window.financeWorkerFault)
		worker.postMessage({ type: 'FINANCE_FIXTURE_FAULT', fault: window.financeWorkerFault })
	Object.defineProperty(window, 'financeFixture', { value: host, configurable: true })
	worker.addEventListener('message', (event: MessageEvent<unknown>) => {
		const value = event.data
		if (
			!value ||
			typeof value !== 'object' ||
			!('type' in value) ||
			value.type !== 'FINANCE_FIXTURE_EFFECT'
		)
			return
		event.stopImmediatePropagation()
		if (!('effect' in value)) return
		if (value.effect === 'backup-commit') sessionStorage.setItem('backup-test-commit-attempt', '1')
		if (value.effect === 'profile-lookup-failed')
			document.documentElement.dataset.profileLookupFailed = 'true'
	})
}
const host: FixtureHost = {
	request: <Key extends FixtureOperation>(operation: Key, args: FixtureArguments<Key>) =>
		new Promise<FixtureResult<Key>>((resolve, reject) => {
			const worker = captured
			if (!worker) {
				reject(new Error('Finance worker is not mounted'))
				return
			}
			const channel = new MessageChannel()
			channel.port1.onmessage = (
				event: MessageEvent<{ ok: true; value: FixtureResult<Key> } | { ok: false; error: string }>
			) => {
				channel.port1.close()
				if (event.data.ok) resolve(event.data.value)
				else reject(new Error(event.data.error))
			}
			channel.port1.onmessageerror = () => {
				channel.port1.close()
				reject(new Error('Fixture transport failed'))
			}
			worker.postMessage({ type: 'FINANCE_FIXTURE', operation, args }, [channel.port2])
		})
}
