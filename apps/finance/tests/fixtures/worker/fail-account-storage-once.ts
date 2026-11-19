// Fail the SDK's first actual selection read, after the store's eager opening.
// Restore the native method before throwing so explicit retry uses real storage.
export function failAccountStorageOnce() {
	const cursor = IDBObjectStore.prototype.openCursor
	IDBObjectStore.prototype.openCursor = function (...args) {
		if (
			this.transaction.db.name === 'delightful-finances-account-selection' &&
			this.name === 'selections'
		) {
			IDBObjectStore.prototype.openCursor = cursor
			throw new DOMException(
				'Synthetic account storage failure token=PRIVATE_STARTUP_TOKEN',
				'SecurityError'
			)
		}
		return cursor.apply(this, args)
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
