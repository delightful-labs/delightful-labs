import {
	financeNavigationRequest,
	financeNavigationReply
} from '../../contracts/worker-application.js'
import type { z } from 'zod'
import type { WorkspaceNavigate } from '../../contracts/workspace-orchestration-contract.js'

/** One selected Window effect. Its private coordinator retains this receipt through shutdown. */
export function requestWindowNavigation(destination: string, origin: string) {
	const request = financeNavigationRequest.parse({
		type: 'NAVIGATE',
		destination,
		origin,
		replace: false
	})
	const channel = new MessageChannel()
	return new Promise<void>((resolve, reject) => {
		channel.port1.onmessageerror = () => reject(new Error('Navigation reply unavailable'))
		channel.port1.onmessage = (event) => {
			const reply = financeNavigationReply.safeParse(event.data)
			if (reply.success && reply.data.outcome === 'completed') resolve()
			else reject(new Error('Native navigation failed'))
		}
		try {
			globalThis.postMessage(request, { transfer: [channel.port2] })
		} catch (error) {
			channel.port2.close()
			reject(error)
		}
	}).finally(() => channel.port1.close())
}

/** Window owns actual goto/history. No SDK, domain eligibility or navigation retry policy. */
export async function replyWithWindowNavigation(
	port: MessagePort,
	request: z.output<typeof financeNavigationRequest>,
	navigate: WorkspaceNavigate
) {
	try {
		await navigate(
			request.destination,
			new AbortController().signal,
			request.origin,
			request.replace
		)
		port.postMessage({ outcome: 'completed' })
	} catch {
		port.postMessage({ outcome: 'failed' })
	} finally {
		port.close()
	}
}
