// Disposable browser fixture: fail the worker's actual IndexedDB opening once.
// Restore the native method before throwing so the existing retry uses real storage.
export function failAccountStorageOnce() {
	const open = IDBFactory.prototype.open
	IDBFactory.prototype.open = function (name, version) {
		if (name === 'delightful-finances-account-selection') {
			IDBFactory.prototype.open = open
			throw new DOMException(
				'Synthetic account storage failure token=PRIVATE_STARTUP_TOKEN',
				'SecurityError'
			)
		}
		return open.call(this, name, version)
	}
}

export function failPreferencesStorage() {
	const open = IDBFactory.prototype.open
	IDBFactory.prototype.open = function (name, version) {
		if (name === 'delightful-finance-preferences')
			throw new DOMException('Storage unavailable', 'QuotaExceededError')
		return open.call(this, name, version)
	}
}
