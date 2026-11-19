import type { ImageAdjustments } from '../../domain/image-editor-pixels.js'
import type { ImageSelection } from '../../domain/image-editor-geometry.js'
export type ImageRenderInput = {
	source: ImageData
	selection: ImageSelection
	adjustments: ImageAdjustments
}

/** One cancellable CPU operation. No SDK, persistence or application lifecycle is involved. */
export async function renderImageInWorker(
	input: ImageRenderInput,
	signal: AbortSignal
): Promise<ImageData> {
	signal.throwIfAborted()
	let abort: (() => void) | undefined
	const worker = new Worker(new URL('./image-render.worker.ts', import.meta.url), {
		type: 'module'
	})
	try {
		return await new Promise<ImageData>((resolve, reject) => {
			abort = () => reject(signal.reason)
			signal.addEventListener('abort', abort, { once: true })
			worker.onmessage = (event: MessageEvent<unknown>) => {
				if (abort) signal.removeEventListener('abort', abort)
				if (event.data instanceof ImageData) resolve(event.data)
				else reject(new Error('Invalid image render result'))
			}
			worker.onerror = () => {
				if (abort) signal.removeEventListener('abort', abort)
				reject(new Error('Image render failed'))
			}
			worker.onmessageerror = () => {
				if (abort) signal.removeEventListener('abort', abort)
				reject(new Error('Image render transport failed'))
			}
			worker.postMessage(input)
		})
	} finally {
		if (abort) signal.removeEventListener('abort', abort)
		worker.terminate()
	}
}
