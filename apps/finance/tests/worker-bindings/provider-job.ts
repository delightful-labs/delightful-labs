import { createActor, toPromise, waitFor } from 'xstate'
import { providerFetchMachine } from '../../src/lib/machines/bank-sync/provider-fetch.js'
import type { OperationWork } from '../../src/lib/machines/bank-sync/types.js'

export async function qualifyProviderJob(
	mode: 'normal' | 'http-failure' | 'cancel' | 'blocked-release'
) {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
	const NativeWorker = globalThis.Worker
	const resources: { worker: Worker; terminate: () => void }[] = []
	let posts = 0,
		releases = 0
	const diagnostics: string[] = []
	Object.defineProperty(globalThis, 'Worker', {
		configurable: true,
		writable: true,
		value: function (url: string | URL, options?: WorkerOptions) {
			const worker = new NativeWorker(url, options)
			const nativeTerminate = worker.terminate,
				nativePost = worker.postMessage
			const terminate = () => nativeTerminate.call(worker)
			resources.push({ worker, terminate })
			worker.postMessage = (
				message: unknown,
				options?: Transferable[] | StructuredSerializeOptions
			) => {
				posts++
				if (mode !== 'cancel' && mode !== 'blocked-release')
					nativePost.call(worker, message, Array.isArray(options) ? { transfer: options } : options)
			}
			worker.terminate = () => {
				if (mode === 'blocked-release') throw new Error('Selected native release refusal')
				terminate()
				releases++
			}
			return worker
		}
	})
	const work: OperationWork = {
		command: { type: 'DISCOVER' },
		attemptAt: new Date(),
		scope: { ownerId: 'owner', organizationId: 'organization', connectionId: 'connection' },
		current: {
			id: 'connection',
			ownerId: 'owner',
			organizationId: 'organization',
			status: 'active',
			accessUrl: '',
			credentialVersion: 1,
			credentialId: 'credential',
			prfSalt: 'salt',
			iv: 'iv',
			ciphertext: 'ciphertext',
			lastOutcome: null,
			importedCount: null,
			existingCount: null,
			omittedCount: null,
			lastSyncAt: null,
			lastError: null,
			claimedAt: new Date()
		},
		trace: {
			id: 'native-provider',
			log: (stage, details) => diagnostics.push(JSON.stringify({ stage, details })),
			failed: (stage) => diagnostics.push(stage),
			step: async (_stage, effect) => effect()
		}
	}
	const actor = createActor(providerFetchMachine, {
		input: { work, accessUrl: 'https://fixture:synthetic@bridge.simplefin.org/simplefin' }
	}).start()
	try {
		await waitFor(actor, (state) => state.matches('requesting'))
		if (mode === 'cancel' || mode === 'blocked-release') actor.send({ type: 'CANCEL' })
		if (mode === 'blocked-release')
			return {
				kind: 'blocked',
				status: actor.getSnapshot().status,
				releases,
				posts,
				hasOutput: actor.getSnapshot().output !== undefined
			}
		const result = await toPromise(actor)
		return {
			kind: result.kind,
			status: actor.getSnapshot().status,
			releases,
			posts,
			clearedInput: actor.getSnapshot().context.input === undefined,
			handlersRemoved: resources.every(
				({ worker }) => !worker.onmessage && !worker.onerror && !worker.onmessageerror
			),
			secretInDiagnostics: diagnostics.some(
				(value) => value.includes('synthetic') || value.includes('bridge.simplefin.org')
			)
		}
	} finally {
		actor.stop()
		for (const resource of resources) resource.terminate()
		if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
	}
}
