import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	decodeEditorImage,
	readEditorSource,
	createEditorCanvas,
	paintEditorCanvas,
	encodeEditorCanvas,
	releaseEditorCanvas
} from './image-editor-platform.js'
import { TestImageData } from '../testing/image-editor/fixtures.js'

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function fixture() {
	const drawImage = vi.fn()
	const putImageData = vi.fn()
	const getImageData = vi.fn(
		(_x: number, _y: number, width: number, height: number) => new TestImageData(width, height)
	)
	const context = { drawImage, putImageData, getImageData }
	const encoded = new Blob(['encoded'], { type: 'image/png' })
	const canvas = {
		width: 0,
		height: 0,
		getContext: vi.fn((): typeof context | null => context),
		toBlob: vi.fn((callback: BlobCallback, _type: string, _quality: number) => callback(encoded))
	}
	vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
	return { canvas, context, encoded }
}

describe('image editor platform boundaries', () => {
	it('decodes with orientation from the source metadata', async () => {
		const bitmap: ImageBitmap = { width: 4, height: 2, close: vi.fn() }
		const decode = vi.fn(async () => bitmap)
		vi.stubGlobal('createImageBitmap', decode)
		const file = new File(['image'], 'receipt.jpg', { type: 'image/jpeg' })
		await expect(decodeEditorImage(file)).resolves.toBe(bitmap)
		expect(decode).toHaveBeenCalledExactlyOnceWith(file, { imageOrientation: 'from-image' })
	})

	it('reads a proportionally bounded raster and releases the scratch canvas', () => {
		const f = fixture()
		const bitmap: ImageBitmap = { width: 4096, height: 1024, close: vi.fn() }
		const source = readEditorSource(bitmap)
		expect([source.width, source.height]).toEqual([2048, 512])
		expect(f.context.drawImage).toHaveBeenCalledExactlyOnceWith(bitmap, 0, 0, 2048, 512)
		expect([f.canvas.width, f.canvas.height]).toEqual([0, 0])
	})

	it('releases scratch resources when reading pixels throws', () => {
		const f = fixture()
		f.context.getImageData.mockImplementation(() => {
			throw new Error('pixels blocked')
		})
		expect(() => readEditorSource({ width: 100, height: 50, close: vi.fn() })).toThrow(
			'pixels blocked'
		)
		expect([f.canvas.width, f.canvas.height]).toEqual([0, 0])
	})

	it('fails explicitly when a canvas context is unavailable', () => {
		const f = fixture()
		f.canvas.getContext.mockReturnValue(null)
		expect(() => readEditorSource({ width: 100, height: 50, close: vi.fn() })).toThrow(
			'Image pixels are unavailable'
		)
		expect([f.canvas.width, f.canvas.height]).toEqual([0, 0])
	})

	it('paints exactly the supplied pixels and encodes using the requested MIME type', async () => {
		const f = fixture()
		const canvas = createEditorCanvas()
		const pixels = new TestImageData(4, 2)
		paintEditorCanvas(canvas, pixels)
		expect([canvas.width, canvas.height]).toEqual([4, 2])
		expect(f.context.putImageData).toHaveBeenCalledExactlyOnceWith(pixels, 0, 0)
		await expect(encodeEditorCanvas(canvas, 'image/png')).resolves.toBe(f.encoded)
		expect(f.canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png', 0.92)
		releaseEditorCanvas(canvas)
		expect([canvas.width, canvas.height]).toEqual([0, 0])
	})
})
