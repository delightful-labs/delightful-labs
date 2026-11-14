import { setImmediate } from 'node:timers'
import { afterEach, expect, it, vi } from 'vitest'
import { serveHostClose, workerHostControl, type HostControlReport } from './host-close.js'

const releases = new Set<() => void>()
afterEach(() => {
	for (const release of releases) release()
	releases.clear()
	vi.restoreAllMocks()
})
function fixture(closeHost: () => void = vi.fn()) {
	const data = new MessageChannel(),
		control = new MessageChannel()
	const scope = crypto.randomUUID(),
		requestId = crypto.randomUUID()
	const reports: HostControlReport[] = []
	const serve = serveHostClose(control.port1, scope, closeHost)
	const client = workerHostControl(control.port2, scope)
	const stop = client.listen((report) => reports.push(report))
	const release = () => {
		serve()
		stop()
		data.port1.close()
		data.port2.close()
	}
	releases.add(release)
	return { data, control, scope, requestId, reports, closeHost, client, stop, serve }
}
function envelope(scope: string, requestId: string) {
	return { scope, requestId, version: 1 }
}

it('acknowledges only after actual data-host disposal and prevents later queued effects', async () => {
	const write = vi.fn()
	const f = fixture(() => {
		f.data.port1.onmessage = null
		f.data.port1.close()
	})
	f.data.port1.onmessage = write
	f.data.port1.start()
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() =>
		expect(f.reports).toEqual([
			{ type: 'HOST_CLOSED', receipt: { scope: f.scope, requestId: f.requestId } }
		])
	)
	f.data.port2.postMessage({ type: 'WRITE', value: 'cannot run after receipt' })
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(write).not.toHaveBeenCalled()
})

it('rejects foreign scopes, versions, extra fields and transferred resources before native close', async () => {
	const f = fixture(),
		extra = new MessageChannel(),
		closed = vi.fn()
	extra.port2.addEventListener('close', closed)
	f.control.port2.postMessage({ ...envelope(crypto.randomUUID(), f.requestId), type: 'CLOSE_HOST' })
	f.control.port2.postMessage({ ...envelope(f.scope, f.requestId), version: 2, type: 'CLOSE_HOST' })
	f.control.port2.postMessage({
		...envelope(f.scope, f.requestId),
		type: 'CLOSE_HOST',
		extra: true
	})
	f.control.port2.postMessage(
		{ ...envelope(f.scope, f.requestId), type: 'CLOSE_HOST', port: extra.port1 },
		[extra.port1]
	)
	await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
	expect(f.closeHost).not.toHaveBeenCalled()
	expect(f.reports).toEqual([])
	extra.port2.close()
})

it('reports correlated disposal failure without success and retains control for a later genuine close', async () => {
	const closeHost = vi.fn().mockImplementationOnce(() => {
		throw new Error('native close failed')
	})
	const f = fixture(closeHost)
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() =>
		expect(f.reports).toEqual([
			{
				type: 'HOST_CLOSE_FAILED',
				failure: { scope: f.scope, requestId: f.requestId, stage: 'dispose' }
			}
		])
	)
	expect(closeHost).toHaveBeenCalledOnce()
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() =>
		expect(f.reports[1]).toEqual({
			type: 'HOST_CLOSED',
			receipt: { scope: f.scope, requestId: f.requestId }
		})
	)
	expect(closeHost).toHaveBeenCalledTimes(2)
})

it('control transport errors retain the listener for a later genuine scoped receipt', async () => {
	const f = fixture()
	f.control.port2.dispatchEvent(new MessageEvent('messageerror'))
	expect(f.reports).toEqual([{ type: 'CLOSE_FAILED', scope: f.scope }])
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(f.reports).toHaveLength(2))
	expect(f.reports[1]).toEqual({
		type: 'HOST_CLOSED',
		receipt: { scope: f.scope, requestId: f.requestId }
	})
})

it('malformed and resource-bearing receipts close orphan ports without granting closure', async () => {
	const f = fixture(),
		extra = new MessageChannel(),
		closed = vi.fn()
	extra.port2.addEventListener('close', closed)
	f.control.port1.postMessage({
		...envelope(f.scope, f.requestId),
		type: 'HOST_CLOSED',
		extra: true
	})
	f.control.port1.postMessage(
		{ ...envelope(f.scope, f.requestId), type: 'HOST_CLOSED', port: extra.port1 },
		[extra.port1]
	)
	await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
	expect(f.reports).toEqual([
		{ type: 'CLOSE_FAILED', scope: f.scope },
		{ type: 'CLOSE_FAILED', scope: f.scope }
	])
	extra.port2.close()
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(f.reports[2]?.type).toBe('HOST_CLOSED'))
})

it('ignores a valid receipt from another host scope', async () => {
	const f = fixture()
	f.control.port1.postMessage({
		...envelope(crypto.randomUUID(), f.requestId),
		type: 'HOST_CLOSED'
	})
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(f.reports).toHaveLength(1))
	expect(f.reports[0]).toEqual({
		type: 'HOST_CLOSED',
		receipt: { scope: f.scope, requestId: f.requestId }
	})
})

it('rejects invalid outbound correlation before posting and disposal emits no receipt', async () => {
	const f = fixture()
	expect(() => f.client.post({ scope: crypto.randomUUID(), requestId: f.requestId })).toThrow(
		'Invalid host close identity'
	)
	expect(() => f.client.post({ scope: f.scope, requestId: 'invalid' })).toThrow(
		'Invalid host close identity'
	)
	f.stop()
	f.stop()
	f.serve()
	f.serve()
	f.control.port2.dispatchEvent(new MessageEvent('messageerror'))
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(f.reports).toEqual([])
	expect(f.closeHost).not.toHaveBeenCalled()
})

it('duplicate valid close commands preserve their receipts and leave disposal with the native owner', async () => {
	const f = fixture()
	f.client.post({ scope: f.scope, requestId: f.requestId })
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(f.reports).toHaveLength(2))
	expect(f.closeHost).toHaveBeenCalledTimes(2)
	expect(f.reports).toEqual([
		{ type: 'HOST_CLOSED', receipt: { scope: f.scope, requestId: f.requestId } },
		{ type: 'HOST_CLOSED', receipt: { scope: f.scope, requestId: f.requestId } }
	])
})

it('a failed native receipt post grants no closure and retains independent control for a later command', async () => {
	const f = fixture()
	vi.spyOn(f.control.port1, 'postMessage').mockImplementationOnce(() => {
		throw new Error('Native receipt post failed')
	})
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() =>
		expect(f.reports).toEqual([
			{
				type: 'HOST_CLOSE_FAILED',
				failure: { scope: f.scope, requestId: f.requestId, stage: 'acknowledge' }
			}
		])
	)
	expect(f.closeHost).toHaveBeenCalledOnce()
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() =>
		expect(f.reports).toEqual([
			{
				type: 'HOST_CLOSE_FAILED',
				failure: { scope: f.scope, requestId: f.requestId, stage: 'acknowledge' }
			},
			{ type: 'HOST_CLOSED', receipt: { scope: f.scope, requestId: f.requestId } }
		])
	)
	expect(f.closeHost).toHaveBeenCalledTimes(2)
})

it('does not retry or infer closure when both success and failure reports cannot be posted', async () => {
	const f = fixture()
	const posting = vi.spyOn(f.control.port1, 'postMessage').mockImplementation(() => {
		throw new Error('Control port unavailable')
	})
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(posting).toHaveBeenCalledTimes(2))
	expect(posting.mock.calls.map(([message]) => message)).toEqual([
		{ ...envelope(f.scope, f.requestId), type: 'HOST_CLOSED' },
		{ ...envelope(f.scope, f.requestId), type: 'HOST_CLOSE_FAILED', stage: 'acknowledge' }
	])
	expect(f.closeHost).toHaveBeenCalledOnce()
	expect(f.reports).toEqual([])
	posting.mockRestore()
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(f.reports[0]?.type).toBe('HOST_CLOSED'))
})

it('rejects malformed or resource-bearing failure packets and ignores a foreign failure scope', async () => {
	const f = fixture(),
		extra = new MessageChannel(),
		closed = vi.fn()
	extra.port2.addEventListener('close', closed)
	const failure = { ...envelope(f.scope, f.requestId), type: 'HOST_CLOSE_FAILED', stage: 'dispose' }
	for (const malformed of [
		{ ...failure, stage: 'retry' },
		{ ...failure, version: 2 },
		{ ...failure, detail: 'unexpected private exception' }
	])
		f.control.port1.postMessage(malformed)
	f.control.port1.postMessage({ ...failure, port: extra.port1 }, [extra.port1])
	f.control.port1.postMessage({ ...failure, scope: crypto.randomUUID() })
	// A success on the same port orders all preceding packets before this observation.
	f.control.port1.postMessage({ ...envelope(f.scope, f.requestId), type: 'HOST_CLOSED' })
	await vi.waitFor(() => expect(f.reports).toHaveLength(5))
	expect(f.reports).toEqual([
		...Array.from({ length: 4 }, () => ({ type: 'CLOSE_FAILED', scope: f.scope })),
		{ type: 'HOST_CLOSED', receipt: { scope: f.scope, requestId: f.requestId } }
	])
	await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
	extra.port2.close()
})
