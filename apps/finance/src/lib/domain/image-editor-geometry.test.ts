import { describe, expect, it } from 'vitest'
import {
	initialImageSelection,
	selectionQuad,
	validImageQuad,
	moveImageSelection,
	quadProjection,
	imageSelectionSize,
	type ImageQuad,
	type ImageCorner
} from './image-editor-geometry.js'

const image = { width: 400, height: 200 }
const quad: ImageQuad = {
	topLeft: { x: 20, y: 10 },
	topRight: { x: 350, y: 40 },
	bottomRight: { x: 380, y: 180 },
	bottomLeft: { x: 10, y: 190 }
}

describe('image editor geometry', () => {
	it('initializes centered squares and full-image rectangles/perspective selections', () => {
		expect(initialImageSelection('square', image)).toEqual({
			mode: 'square',
			rect: { x: 100, y: 0, width: 200, height: 200 }
		})
		expect(initialImageSelection('rectangle', image)).toEqual({
			mode: 'rectangle',
			rect: { x: 0, y: 0, ...image }
		})
		expect(selectionQuad(initialImageSelection('perspective', image))).toEqual({
			topLeft: { x: 0, y: 0 },
			topRight: { x: 400, y: 0 },
			bottomRight: { x: 400, y: 200 },
			bottomLeft: { x: 0, y: 200 }
		})
	})

	it.each<ImageCorner>(['topLeft', 'topRight', 'bottomRight', 'bottomLeft'])(
		'moves %s independently',
		(corner) => {
			const changed = moveImageSelection(
				{ mode: 'perspective', quad },
				{ kind: 'corner', corner, delta: { x: 2, y: 3 } },
				image
			)
			const expected = { ...quad, [corner]: { x: quad[corner].x + 2, y: quad[corner].y + 3 } }
			expect(selectionQuad(changed)).toEqual(expected)
			expect(validImageQuad(selectionQuad(changed), image)).toBe(true)
		}
	)

	it.each([
		{ ...quad, topLeft: { x: -1, y: 10 } },
		{ ...quad, topLeft: { x: NaN, y: 10 } },
		{ ...quad, topLeft: { x: 300, y: 160 } },
		{ ...quad, topLeft: quad.bottomRight, bottomRight: quad.topLeft },
		{ ...quad, topLeft: quad.topRight }
	])('rejects out-of-bounds, nonfinite, concave, crossed and collapsed corners', (invalid) => {
		expect(validImageQuad(invalid, image)).toBe(false)
	})

	it('ignores a corner move that crosses its opposite edge and ignores invalid deltas', () => {
		const selection = { mode: 'perspective', quad } satisfies Parameters<
			typeof moveImageSelection
		>[0]
		expect(
			moveImageSelection(
				selection,
				{ kind: 'corner', corner: 'topLeft', delta: { x: 300, y: 170 } },
				image
			)
		).toBe(selection)
		expect(
			moveImageSelection(selection, { kind: 'move', delta: { x: Infinity, y: 0 } }, image)
		).toBe(selection)
	})

	it('translates a quadrilateral to image bounds without changing its shape', () => {
		const moved = moveImageSelection(
			{ mode: 'perspective', quad },
			{ kind: 'move', delta: { x: 999, y: -999 } },
			image
		)
		expect(selectionQuad(moved)).toEqual({
			topLeft: { x: 40, y: 0 },
			topRight: { x: 370, y: 30 },
			bottomRight: { x: 400, y: 170 },
			bottomLeft: { x: 30, y: 180 }
		})
	})

	it('allows unrestricted rectangle proportions while keeping square corners constrained', () => {
		expect(
			moveImageSelection(
				initialImageSelection('rectangle', image),
				{ kind: 'corner', corner: 'topLeft', delta: { x: 120, y: 30 } },
				image
			)
		).toEqual({ mode: 'rectangle', rect: { x: 120, y: 30, width: 280, height: 170 } })
		expect(
			moveImageSelection(
				initialImageSelection('square', image),
				{ kind: 'corner', corner: 'topLeft', delta: { x: 40, y: 20 } },
				image
			)
		).toEqual({ mode: 'square', rect: { x: 140, y: 40, width: 160, height: 160 } })
	})

	it('maps all four unit-rectangle corners to the corresponding perspective corners', () => {
		const project = quadProjection(quad)
		for (const { u, v, point } of [
			{ u: 0, v: 0, point: quad.topLeft },
			{ u: 1, v: 0, point: quad.topRight },
			{ u: 1, v: 1, point: quad.bottomRight },
			{ u: 0, v: 1, point: quad.bottomLeft }
		]) {
			expect(project(u, v).x).toBeCloseTo(point.x, 10)
			expect(project(u, v).y).toBeCloseTo(point.y, 10)
		}
	})

	it('maps the middle of a trapezoid with perspective rather than linear interpolation', () => {
		const project = quadProjection({
			topLeft: { x: 1, y: 0 },
			topRight: { x: 3, y: 0 },
			bottomRight: { x: 4, y: 4 },
			bottomLeft: { x: 0, y: 4 }
		})
		expect(project(0.5, 0.5)).toEqual({ x: 2, y: 4 / 3 })
	})

	it('preserves one-pixel selections and caps large output without changing proportions', () => {
		const pixel = initialImageSelection('perspective', { width: 1, height: 1 })
		expect(validImageQuad(selectionQuad(pixel), { width: 1, height: 1 })).toBe(true)
		expect(imageSelectionSize(pixel)).toEqual({ width: 1, height: 1 })
		expect(
			imageSelectionSize(initialImageSelection('rectangle', { width: 4096, height: 2048 }))
		).toEqual({ width: 2048, height: 1024 })
	})
})
