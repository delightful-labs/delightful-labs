export function deferred<T>() {
	let resolve: (value: T) => void = () => {
		throw new Error('Not initialized')
	}
	let reject: (error: unknown) => void = () => {
		throw new Error('Not initialized')
	}
	const promise = new Promise<T>((accept, fail) => {
		resolve = accept
		reject = fail
	})
	return { promise, resolve, reject }
}
