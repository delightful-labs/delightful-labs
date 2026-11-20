import {
	createBrowserWorkerJob,
	type BrowserWorkerJobInput
} from 'delightful-local-first/worker/browser-job'
import type { ImageAdjustments } from '../../domain/image-editor-pixels.js'
import type { ImageSelection } from '../../domain/image-editor-geometry.js'
export type ImageRenderInput = {
	source: ImageData
	selection: ImageSelection
	adjustments: ImageAdjustments
}

export const imageRenderMachine = createBrowserWorkerJob<ImageRenderInput, ImageData>()
/** Domain request/reply mapping only; Local First owns the finite worker lifecycle. */
export function imageRenderJob(
	input: ImageRenderInput
): BrowserWorkerJobInput<ImageRenderInput, ImageData> {
	return {
		open: () =>
			new Worker(new URL('./image-render.worker.ts', import.meta.url), { type: 'module' }),
		message: input,
		decode: (value) => {
			if (!(value instanceof ImageData)) throw new Error('Invalid image render result')
			return value
		}
	}
}
