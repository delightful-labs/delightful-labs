import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderEditorPixels } from './image-editor-pixels.js'
import { initialImageSelection, type ImageSelection } from './image-editor-geometry.js'
import { TestImageData } from '../testing/image-editor/fixtures.js'

beforeEach(() => vi.stubGlobal('ImageData', TestImageData))
afterEach(() => vi.unstubAllGlobals())
const neutral = { blackWhite: false, contrast: 100 }

describe('image editor pixels', () => {
	it('preserves an identity crop and never mutates the original pixels', () => {
		const source = new TestImageData(
			2,
			2,
			[255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]
		)
		const original = source.data.slice()
		const selection = initialImageSelection('rectangle', source)
		expect(renderEditorPixels(source, selection, neutral).data).toEqual(original)
		renderEditorPixels(source, selection, { blackWhite: true, contrast: 200 })
		expect(source.data).toEqual(original)
		expect(renderEditorPixels(source, selection, neutral).data).toEqual(original)
	})

	it('crops exactly the selected rectangular region', () => {
		const source = new TestImageData(2, 1, [255, 0, 0, 255, 0, 255, 0, 255])
		const result = renderEditorPixels(
			source,
			{ mode: 'rectangle', rect: { x: 1, y: 0, width: 1, height: 1 } },
			neutral
		)
		expect([result.width, result.height]).toEqual([1, 1])
		expect([...result.data]).toEqual([0, 255, 0, 255])
	})

	it('converts color to luminance-weighted grayscale', () => {
		const source = new TestImageData(1, 1, [255, 0, 0, 255])
		const result = renderEditorPixels(source, initialImageSelection('rectangle', source), {
			blackWhite: true,
			contrast: 100
		})
		expect([...result.data]).toEqual([54, 54, 54, 255])
	})

	it.each([
		{ contrast: 0, expected: [128, 128, 128, 255] },
		{ contrast: 100, expected: [64, 128, 192, 255] },
		{ contrast: 200, expected: [0, 128, 255, 255] }
	])('applies $contrast percent contrast', ({ contrast, expected }) => {
		const source = new TestImageData(1, 1, [64, 128, 192, 255])
		expect([
			...renderEditorPixels(source, initialImageSelection('rectangle', source), {
				blackWhite: false,
				contrast
			}).data
		]).toEqual(expected)
	})

	it('interpolates alpha without darkening color at a transparent edge', () => {
		const source = new TestImageData(2, 1, [0, 0, 0, 0, 255, 0, 0, 255])
		const result = renderEditorPixels(
			source,
			{ mode: 'rectangle', rect: { x: 0.5, y: 0, width: 1, height: 1 } },
			neutral
		)
		expect([...result.data]).toEqual([255, 0, 0, 128])
	})

	it('flattens a perspective quadrilateral into a bounded rectangular buffer', () => {
		const source = new TestImageData(
			4,
			4,
			Array.from({ length: 16 }, () => [100, 150, 200, 255]).flat()
		)
		const selection: ImageSelection = {
			mode: 'perspective',
			quad: {
				topLeft: { x: 1, y: 0 },
				topRight: { x: 3, y: 0 },
				bottomRight: { x: 4, y: 4 },
				bottomLeft: { x: 0, y: 4 }
			}
		}
		const result = renderEditorPixels(source, selection, neutral)
		expect([result.width, result.height]).toEqual([4, 4])
		expect([...result.data]).toEqual([...source.data])
	})

	it.each([NaN, Infinity, -1, 201])('rejects invalid contrast %s', (contrast) => {
		const source = new TestImageData(1, 1, [255, 255, 255, 255])
		expect(() =>
			renderEditorPixels(source, initialImageSelection('rectangle', source), {
				blackWhite: false,
				contrast
			})
		).toThrow('Invalid image contrast')
	})
})
