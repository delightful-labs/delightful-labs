import { financeRecoveryReply } from '../../contracts/worker-application.js'

/** Private key-read reply. No actor snapshot/history, persistence or generic RPC dispatcher. */
export async function replyWithRecoveryPhrase(
	port: MessagePort,
	read: (() => Promise<string>) | undefined
) {
	try {
		if (!read) {
			port.postMessage({ outcome: 'unavailable' })
			return
		}
		const phrase = await read()
		port.postMessage(financeRecoveryReply.parse({ outcome: 'ready', phrase }))
	} catch {
		port.postMessage({ outcome: 'unavailable' })
	} finally {
		port.close()
	}
}
