export function failBankLockOnce() {
	const request = navigator.locks.request.bind(navigator.locks)
	let failed = false
	Object.defineProperty(navigator.locks, 'request', {
		configurable: true,
		value: (...args: Parameters<typeof request>) => {
			if (!failed && args[0].startsWith('simplefin:')) {
				failed = true
				throw new Error('Synthetic lock acquisition failure')
			}
			return request(...args)
		}
	})
}
