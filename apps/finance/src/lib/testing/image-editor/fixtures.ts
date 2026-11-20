import type { ImageRenderInput } from '../../runtime/worker/image-render.js'
import { renderEditorPixels } from '../../domain/image-editor-pixels.js'
/** Minimal native pixel-buffer stand-in for Node; tests exercise the real pixel math. */
export class TestImageData implements ImageData {
	readonly colorSpace: PredefinedColorSpace = 'srgb'
	readonly data: Uint8ClampedArray<ArrayBuffer>
	constructor(
		public readonly width: number,
		public readonly height: number,
		values?: readonly number[]
	) {
		this.data = new Uint8ClampedArray(width * height * 4)
		if (values) this.data.set(values)
	}
}

import { vi } from 'vitest'
import * as platform from '../../domain/image-editor-platform.js'

/** Deterministic native adapters; owner tests still invoke the real editor statechart. */
export function mockEditorPlatform() {
	vi.stubGlobal('ImageData', TestImageData)
	mockEditorRendering()
	const source = new TestImageData(
		4,
		4,
		Array.from({ length: 16 }, () => [64, 128, 192, 255]).flat()
	)
	const bitmap: ImageBitmap = { width: 4, height: 4, close: vi.fn() }
	const canvas = new (class {
		width = 0
		height = 0
	})()
	vi.stubGlobal('document', { createElement: () => canvas })
	const canvasResource = platform.createEditorCanvas()
	const decode = vi.spyOn(platform, 'decodeEditorImage').mockResolvedValue(bitmap)
	const read = vi.spyOn(platform, 'readEditorSource').mockReturnValue(source)
	const paint = vi.spyOn(platform, 'paintEditorCanvas').mockImplementation((target, buffer) => {
		target.width = buffer.width
		target.height = buffer.height
	})
	const encode = vi
		.spyOn(platform, 'encodeEditorCanvas')
		.mockResolvedValue(new Blob(['edited'], { type: 'image/png' }))
	const release = vi.spyOn(platform, 'releaseEditorCanvas')
	return { source, bitmap, canvas, canvasResource, decode, read, paint, encode, release }
}

/** Replace only the native Worker; all tests still invoke the shared lifecycle. */
export function mockEditorRendering(held = false) {
	type Resource = {
		onmessage: ((event: MessageEvent<unknown>) => void) | null
		onerror: ((event?: Event) => void) | null
		onmessageerror: ((event?: Event) => void) | null
		postMessage: ReturnType<typeof vi.fn<(input: ImageRenderInput) => void>>
		terminate: ReturnType<typeof vi.fn<() => void>>
	}
	const workers: Resource[] = []
	vi.stubGlobal('Worker', function () {
		let released = false
		const worker: Resource = {
			onmessage: null,
			onerror: null,
			onmessageerror: null,
			postMessage: vi.fn((input: ImageRenderInput) => {
				if (held) return
				queueMicrotask(() => {
					if (released) return
					try {
						worker.onmessage?.(
							new MessageEvent('message', {
								data: renderEditorPixels(input.source, input.selection, input.adjustments)
							})
						)
					} catch {
						worker.onerror?.(new Event('error'))
					}
				})
			}),
			terminate: vi.fn(() => {
				released = true
			})
		}
		workers.push(worker)
		return worker
	})
	return workers
}
