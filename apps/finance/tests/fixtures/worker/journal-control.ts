let release: (() => void) | undefined
export function holdWorkspaceJournal() {
	const open = IDBFactory.prototype.open
	IDBFactory.prototype.open = function (name, version) {
		if (name === 'delightful-finances-workspace-attempts')
			throw new DOMException('Journal unavailable', 'QuotaExceededError')
		return open.call(this, name, version)
	}
	release = () => {
		IDBFactory.prototype.open = open
	}
}
export function releaseWorkspaceJournal() {
	release?.()
	release = undefined
}
