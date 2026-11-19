import {
	financeWebAuthnResult,
	type WebAuthnMaterial,
	type WebAuthnRequest
} from '../contracts/worker-webauthn.js'

/** Only navigator.credentials and copying its non-cloneable native result belong in Window. */
export async function performWebAuthn(
	request: WebAuthnRequest,
	signal: AbortSignal
): Promise<WebAuthnMaterial> {
	if (!globalThis.isSecureContext || !globalThis.PublicKeyCredential)
		throw new Error('passkey-unavailable')
	const credential =
		request.operation === 'create'
			? await navigator.credentials.create({ signal, publicKey: request.publicKey })
			: await navigator.credentials.get({ signal, publicKey: request.publicKey })
	if (!(credential instanceof PublicKeyCredential)) throw new Error('passkey-unavailable')
	const extensions = credential.getClientExtensionResults().prf
	const first = extensions?.results?.first
	const prfFirst = first
		? ArrayBuffer.isView(first)
			? new Uint8Array(first.buffer, first.byteOffset, first.byteLength).slice().buffer
			: new Uint8Array(first).slice().buffer
		: null
	if (first) {
		const bytes = ArrayBuffer.isView(first)
			? new Uint8Array(first.buffer, first.byteOffset, first.byteLength)
			: new Uint8Array(first)
		bytes.fill(0)
	}
	if (signal.aborted) {
		if (prfFirst) new Uint8Array(prfFirst).fill(0)
		throw signal.reason
	}
	return {
		ok: true,
		rawId: new Uint8Array(credential.rawId).slice().buffer,
		prfEnabled: extensions?.enabled === true,
		prfFirst
	}
}

export async function requestWebAuthn(
	request: WebAuthnRequest,
	signal: AbortSignal
): Promise<WebAuthnMaterial> {
	signal.throwIfAborted()
	if (typeof navigator.credentials?.get === 'function') return performWebAuthn(request, signal)
	const channel = new MessageChannel()
	const abort = () => channel.port1.postMessage({ type: 'CANCEL' })
	try {
		return await new Promise<WebAuthnMaterial>((resolve, reject) => {
			channel.port1.onmessage = (event) => {
				const result = financeWebAuthnResult.safeParse(event.data)
				if (signal.aborted) {
					if (result.success && result.data.ok && result.data.prfFirst)
						new Uint8Array(result.data.prfFirst).fill(0)
					reject(signal.reason)
				} else if (result.success && result.data.ok) resolve(result.data)
				else reject(new Error('passkey-unavailable'))
			}
			channel.port1.onmessageerror = () => reject(new Error('passkey-unavailable'))
			signal.addEventListener('abort', abort, { once: true })
			globalThis.postMessage(request, { transfer: [channel.port2] })
		})
	} finally {
		signal.removeEventListener('abort', abort)
		channel.port1.close()
	}
}

export async function dispatchWindowWebAuthn(port: MessagePort, request: WebAuthnRequest) {
	const controller = new AbortController()
	port.onmessage = () => controller.abort()
	port.onmessageerror = () => controller.abort()
	let material: WebAuthnMaterial | undefined
	try {
		const result = await performWebAuthn(request, controller.signal)
		material = result
		port.postMessage(result, [result.rawId, ...(result.prfFirst ? [result.prfFirst] : [])])
	} catch {
		port.postMessage({ ok: false })
	} finally {
		if (material?.prfFirst?.byteLength) new Uint8Array(material.prfFirst).fill(0)
		port.close()
	}
}
