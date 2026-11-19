import { operations } from './operations.js'
import { failAccountStorageOnce } from './fail-account-storage-once.js'
import { failBankLockOnce } from './fail-bank-lock-once.js'
import { holdWorkspaceJournal } from './journal-control.js'
/** Static fixture operations only, installed by the disposable E2E configuration. No eval/RPC SDK facade. */
self.addEventListener('message', (event: MessageEvent<unknown>) => {
	const command = event.data
	if (
		command &&
		typeof command === 'object' &&
		'type' in command &&
		command.type === 'FINANCE_FIXTURE_FAULT'
	) {
		event.stopImmediatePropagation()
		if (!('fault' in command)) return
		if (command.fault === 'fail-account-storage-once') failAccountStorageOnce()
		if (command.fault === 'fail-bank-lock-once') failBankLockOnce()
		if (command.fault === 'fail-workspace-journal') holdWorkspaceJournal()
		return
	}
	if (
		!command ||
		typeof command !== 'object' ||
		!('type' in command) ||
		command.type !== 'FINANCE_FIXTURE'
	)
		return
	event.stopImmediatePropagation()
	const port = event.ports[0]
	if (!port) return
	if (
		!('operation' in command) ||
		typeof command.operation !== 'string' ||
		!Object.hasOwn(operations, command.operation) ||
		!('args' in command) ||
		!Array.isArray(command.args)
	) {
		port.postMessage({ ok: false, error: 'Unknown fixture operation' })
		port.close()
		return
	}
	const operation: unknown = Reflect.get(operations, command.operation)
	if (typeof operation !== 'function') {
		port.postMessage({ ok: false, error: 'Invalid fixture operation' })
		port.close()
		return
	}
	const args = command.args
	void (async () => {
		try {
			const value: unknown = await Reflect.apply(operation, undefined, args)
			port.postMessage({ ok: true, value })
		} catch (error) {
			port.postMessage({
				ok: false,
				error: error instanceof Error ? error.message : 'Fixture operation failed'
			})
		} finally {
			port.close()
		}
	})()
})
