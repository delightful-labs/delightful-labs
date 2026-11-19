import type { ArchiveFileHandoff } from 'delightful-local-first/backend/jazz/backup'
import { financeDownloadReply } from '../../contracts/worker-backup.js'

/** The existing export chart retains custody until Window acknowledges this one native dispatch. */
export const windowBackupHandoff: ArchiveFileHandoff = {
	dispatch(archive, _binding, signal) {
		if (signal.aborted) return Promise.resolve('rejected')
		const bytes = archive.copyBytes()
		const buffer = bytes.buffer
		const channel = new MessageChannel()
		return new Promise<'dispatched' | 'rejected' | 'unknown'>((resolve) => {
			channel.port1.onmessageerror = () => resolve('unknown')
			channel.port1.onmessage = (event) => {
				const reply = financeDownloadReply.safeParse(event.data)
				resolve(reply.success ? reply.data.outcome : 'unknown')
			}
			try {
				globalThis.postMessage(
					{ type: 'DOWNLOAD_BACKUP', bytes: buffer },
					{ transfer: [buffer, channel.port2] }
				)
			} catch {
				bytes.fill(0)
				channel.port2.close()
				resolve('rejected')
			}
		}).finally(() => channel.port1.close())
	}
}

/** Native Window download only: no archive generation, encryption, SDK or domain work. */
export function dispatchWindowBackup(port: MessagePort, buffer: ArrayBuffer) {
	let url: string | undefined
	try {
		url = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }))
		const link = document.createElement('a')
		link.href = url
		link.download = 'finance-backup.dlf'
		link.click()
		port.postMessage({ outcome: 'dispatched' })
	} catch {
		port.postMessage({ outcome: 'rejected' })
	} finally {
		if (url) {
			const completedUrl = url
			setTimeout(() => URL.revokeObjectURL(completedUrl), 0)
		}
		new Uint8Array(buffer).fill(0)
		port.close()
	}
}
