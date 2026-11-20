import { createActor, toPromise, waitFor } from 'xstate'
import { imageEditorMachine } from '../../src/lib/machines/images/image-editor.js'

type Mode = 'normal' | 'cancel-preview' | 'cancel-apply' | 'replace-preview' | 'blocked-release'
/** Real editor, pixel worker and browser resources; only selected transport faults are injected. */
async function qualifyImageJob(mode: Mode) {
	const surface = document.createElement('canvas')
	surface.width = surface.height = 4
	const paint = surface.getContext('2d')
	if (!paint) throw new Error('Fixture canvas unavailable')
	paint.fillStyle = 'rgb(64, 128, 192)'
	paint.fillRect(0, 0, 4, 4)
	const blob = await new Promise<Blob>((resolve, reject) =>
		surface.toBlob(
			(value) => (value ? resolve(value) : reject(new Error('Fixture pixels unavailable'))),
			'image/png'
		)
	)
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Worker')
	const NativeWorker = globalThis.Worker
	const resources: { worker: Worker; terminate: () => void }[] = []
	let posts = 0,
		releases = 0
	Object.defineProperty(globalThis, 'Worker', {
		configurable: true,
		writable: true,
		value: function (url: string | URL, options?: WorkerOptions) {
			const worker = new NativeWorker(url, options)
			const terminate = () => WorkerTerminate.call(worker)
			const WorkerTerminate = worker.terminate,
				post = worker.postMessage
			resources.push({ worker, terminate })
			worker.postMessage = (
				message: unknown,
				options?: Transferable[] | StructuredSerializeOptions
			) => {
				posts++
				const held =
					mode === 'cancel-preview' ||
					mode === 'cancel-apply' ||
					mode === 'blocked-release' ||
					(mode === 'replace-preview' && resources.length === 1)
				if (!held)
					post.call(worker, message, Array.isArray(options) ? { transfer: options } : options)
			}
			worker.terminate = () => {
				if (mode === 'blocked-release') throw new Error('Selected native release refusal')
				terminate()
				releases++
			}
			return worker
		}
	})
	const actor = createActor(imageEditorMachine, {
		input: { file: new File([blob], 'fixture.png', { type: 'image/png' }) }
	}).start()
	try {
		await waitFor(actor, (snapshot) => snapshot.matches('interactive'))
		if (mode === 'cancel-apply') actor.send({ type: 'APPLY' })
		else actor.send({ type: 'PREVIEW' })
		if (mode === 'cancel-preview' || mode === 'cancel-apply' || mode === 'blocked-release') {
			actor.send({ type: 'SHUTDOWN' })
			if (mode === 'blocked-release')
				return {
					kind: 'blocked',
					status: actor.getSnapshot().status,
					hasOutput: actor.getSnapshot().output !== undefined,
					posts,
					releases,
					resources: resources.length
				}
		} else {
			if (mode === 'normal') {
				await waitFor(actor, (snapshot) => snapshot.matches({ interactive: 'previewReady' }))
			} else {
				actor.send({ type: 'SET_CONTRAST', value: 150 })
			}
			actor.send({ type: 'APPLY' })
		}
		const result = await toPromise(actor)
		let dimensions: number[] | undefined, pixel: number[] | undefined
		if (result.kind === 'applied') {
			const bitmap = await createImageBitmap(result.file)
			try {
				paint.drawImage(bitmap, 0, 0)
				dimensions = [bitmap.width, bitmap.height]
				pixel = [...paint.getImageData(0, 0, 1, 1).data]
			} finally {
				bitmap.close()
			}
		}
		return {
			kind: result.kind,
			status: actor.getSnapshot().status,
			posts,
			releases,
			resources: resources.length,
			dimensions,
			pixel,
			handlersRemoved: resources.every(
				({ worker }) =>
					worker.onmessage === null && worker.onerror === null && worker.onmessageerror === null
			),
			retainsPixels:
				actor.getSnapshot().context.source !== undefined ||
				actor.getSnapshot().context.canvas !== undefined
		}
	} finally {
		// Forced test cleanup is deliberately separate from the asserted clean-release result.
		actor.stop()
		for (const resource of resources) resource.terminate()
		if (descriptor) Object.defineProperty(globalThis, 'Worker', descriptor)
		surface.width = surface.height = 0
	}
}
declare global {
	interface Window {
		qualifyImageJob: typeof qualifyImageJob
	}
}
window.qualifyImageJob = qualifyImageJob
