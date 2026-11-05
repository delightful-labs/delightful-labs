import { describe, expect, it } from 'vitest'
import { createMutationAdmission, type MutationAdmissionResult } from './admission.js'

function admitted<Lease>(result: MutationAdmissionResult<Lease>): Lease {
	if (result.outcome !== 'admitted') throw new Error(result.reason)
	return result.lease
}
function deferred() {
	let resolve = () => {}
	let reject = (_reason: unknown) => {}
	const promise = new Promise<void>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}

describe('session mutation admission', () => {
	it('closes admission immediately and drains both operations and native receipts', async () => {
		const admission = createMutationAdmission()
		const writer = admitted(admission.write())
		const receipt = deferred()
		writer.retain(receipt.promise)
		const capture = admitted(admission.capture(new AbortController().signal))
		expect(admission.write()).toEqual({ outcome: 'denied', reason: 'capturing' })
		let drained = false
		const drain = capture.drain().then(() => {
			drained = true
		})
		writer.release()
		await Promise.resolve()
		expect(drained).toBe(false)
		receipt.resolve()
		await drain
		expect(drained).toBe(true)
		expect(admission.write().outcome).toBe('denied')
		capture.release()
		admitted(admission.write()).release()
		admission.close()
	})
	it('retains receipts after ordinary offline operation completion without awaiting them', async () => {
		const admission = createMutationAdmission()
		const pending = deferred()
		const writer = admitted(admission.write())
		writer.retain(pending.promise)
		writer.release()
		admitted(admission.write()).release()
		const capture = admitted(admission.capture(new AbortController().signal))
		const drain = capture.drain()
		pending.resolve()
		await drain
		capture.release()
		admission.close()
	})
	it('releases only its own reservation, including when an old capture aborts late', async () => {
		const admission = createMutationAdmission()
		const old = new AbortController()
		const first = admitted(admission.capture(old.signal))
		first.release()
		const next = admitted(admission.capture(new AbortController().signal))
		old.abort()
		first.release()
		expect(admission.write().outcome).toBe('denied')
		await next.drain()
		next.release()
		admitted(admission.write()).release()
		admission.close()
	})
	it('aborts a waiting capture promptly without discarding existing native receipts', async () => {
		const admission = createMutationAdmission()
		const writer = admitted(admission.write())
		const signal = new AbortController()
		const capture = admitted(admission.capture(signal.signal))
		const drain = expect(capture.drain()).rejects.toThrow()
		signal.abort()
		await drain
		admitted(admission.write()).release()
		const next = admitted(admission.capture(new AbortController().signal))
		const waiting = next.drain()
		writer.release()
		await waiting
		next.release()
		admission.close()
	})
	it('does not acknowledge drain when release races the resolved idle observation', async () => {
		const admission = createMutationAdmission()
		const capture = admitted(admission.capture(new AbortController().signal))
		const drain = expect(capture.drain()).rejects.toThrow()
		capture.release()
		await drain
		admission.close()
	})
	it.each(['receipt', 'writer'])(
		'blocks capture after an unresolved %s while keeping ordinary writes usable',
		async (kind) => {
			const admission = createMutationAdmission()
			const writer = admitted(admission.write())
			const receipt = deferred()
			if (kind === 'receipt') writer.retain(receipt.promise)
			const capture = admitted(admission.capture(new AbortController().signal))
			const drain = expect(capture.drain()).rejects.toThrow()
			if (kind === 'receipt') {
				writer.release()
				receipt.reject(new Error('unknown native outcome'))
			} else writer.unresolved()
			await drain
			capture.release()
			expect(admission.capture(new AbortController().signal)).toEqual({
				outcome: 'denied',
				reason: 'unresolved'
			})
			admitted(admission.write()).release()
			admission.close()
		}
	)
	it('rejects retention after operation release and prevents late writer cleanup from releasing capture', async () => {
		const admission = createMutationAdmission()
		const writer = admitted(admission.write())
		writer.release()
		expect(() => writer.retain(Promise.resolve())).toThrow()
		const capture = admitted(admission.capture(new AbortController().signal))
		writer.release()
		writer.unresolved()
		await capture.drain()
		expect(admission.write().outcome).toBe('denied')
		capture.release()
		admission.close()
	})
	it('retires the owner, rejects its pending capture, and accepts late native settlement', async () => {
		const admission = createMutationAdmission()
		const writer = admitted(admission.write())
		const receipt = deferred()
		writer.retain(receipt.promise)
		const capture = admitted(admission.capture(new AbortController().signal))
		const drain = expect(capture.drain()).rejects.toThrow()
		admission.close()
		await drain
		writer.release()
		receipt.resolve()
		await Promise.resolve()
		capture.release()
		expect(admission.write()).toEqual({ outcome: 'denied', reason: 'closed' })
		expect(admission.capture(new AbortController().signal)).toEqual({
			outcome: 'denied',
			reason: 'closed'
		})
	})
})
