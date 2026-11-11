import { afterEach, describe, expect, it, vi } from 'vitest'
import * as platform from '#lib/domain/image-processing.js'
import { imageProcessingMachine } from './image-processing.js'
import { createActor, toPromise } from 'xstate'

const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function fixture() {
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			constructor(
				public width: number,
				public height: number
			) {}
		}
	)
	const canvas = new OffscreenCanvas(256, 128)
	const bitmap = { width: 512, height: 256, close: vi.fn() }
	vi.spyOn(platform, 'decodeImage').mockResolvedValue(bitmap)
	vi.spyOn(platform, 'initializeImageResizer').mockResolvedValue(undefined)
	vi.spyOn(platform, 'createImageCanvas').mockReturnValue(canvas)
	vi.spyOn(platform, 'resizeImage').mockResolvedValue(canvas)
	vi.spyOn(platform, 'encodeImage').mockResolvedValue(new Blob(['encoded'], { type: 'image/webp' }))
	vi.spyOn(platform, 'readImageBytes').mockResolvedValue(new TextEncoder().encode('encoded'))
	vi.spyOn(platform, 'releaseImageBitmap')
	vi.spyOn(platform, 'releaseImageCanvas').mockImplementation((target) => {
		target.width = 0
		target.height = 0
	})
	const actor = createActor(imageProcessingMachine, {
		input: {
			file: new File(['source'], 'source.webp', { type: 'image/webp' }),
			options: { maxWidth: 2048, maxHeight: 2048, mimeType: 'image/webp', quality: 0.85 }
		}
	}).start()
	cleanups.push(() => actor.stop())
	return { actor, bitmap, canvas }
}

describe('image processing actor', () => {
	it('processes one image and releases acquired resources before completion', async () => {
		const f = fixture()
		await expect(toPromise(f.actor)).resolves.toMatchObject({
			outcome: 'processed',
			blob: { type: 'image/webp' },
			bytes: new TextEncoder().encode('encoded'),
			dimensions: { width: 256, height: 128 }
		})
		expect(platform.releaseImageBitmap).toHaveBeenCalledExactlyOnceWith(f.bitmap)
		expect(platform.releaseImageCanvas).toHaveBeenCalledExactlyOnceWith(f.canvas)
		expect(f.canvas).toEqual({ width: 0, height: 0 })
	})

	it('waits for decode to settle, then releases a late bitmap on cancellation', async () => {
		const pending = Promise.withResolvers<ImageBitmap>()
		vi.spyOn(platform, 'decodeImage').mockReturnValue(pending.promise)
		const f = fixture()
		f.actor.send({ type: 'CANCEL' })
		pending.resolve(f.bitmap)
		await expect(toPromise(f.actor)).resolves.toEqual({ outcome: 'failed' })
		expect(platform.initializeImageResizer).not.toHaveBeenCalled()
		expect(platform.releaseImageBitmap).toHaveBeenCalledExactlyOnceWith(f.bitmap)
		expect(platform.releaseImageCanvas).not.toHaveBeenCalled()
	})

	it('cleans an image whose encoder returns no blob', async () => {
		const f = fixture()
		vi.spyOn(platform, 'encodeImage').mockResolvedValue(null)
		await expect(toPromise(f.actor)).resolves.toEqual({ outcome: 'failed' })
		expect(platform.releaseImageBitmap).toHaveBeenCalledExactlyOnceWith(f.bitmap)
		expect(platform.releaseImageCanvas).toHaveBeenCalledExactlyOnceWith(f.canvas)
	})
})
