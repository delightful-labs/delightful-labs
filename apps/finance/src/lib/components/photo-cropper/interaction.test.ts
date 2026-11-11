import { describe, expect, it } from 'vitest'
import { keyboardNudge, sourcePointFromPointer } from './interaction.js'

describe('photo cropper pointer and keyboard interaction', () => {
	it('maps pointer coordinates into source image coordinates for a contained image', () => {
		expect(
			sourcePointFromPointer(
				{ clientX: 160, clientY: 90 },
				{ left: 10, top: 20, width: 300, height: 200 },
				{ width: 400, height: 200 }
			)
		).toEqual({ x: 200, y: 93.33333333333333 })
	})

	it('uses one source pixel for an arrow key and ten for Shift plus an arrow key', () => {
		const viewport = { width: 200, height: 200 }
		const image = { width: 400, height: 200 }
		expect(keyboardNudge('ArrowRight', false, image, viewport, 'move')).toEqual({
			type: 'NUDGE',
			mode: 'move',
			delta: { x: 2, y: 0 }
		})
		expect(keyboardNudge('ArrowUp', true, image, viewport, 'move')).toEqual({
			type: 'NUDGE',
			mode: 'move',
			delta: { x: 0, y: -20 }
		})
	})

	it('preserves the resize corner and ignores unsupported keys or zero-sized viewports', () => {
		const image = { width: 400, height: 200 }
		expect(
			keyboardNudge('ArrowLeft', false, image, { width: 200, height: 200 }, 'resize', 'topLeft')
		).toMatchObject({ type: 'NUDGE', mode: 'resize', corner: 'topLeft' })
		expect(
			keyboardNudge('Enter', false, image, { width: 200, height: 200 }, 'move')
		).toBeUndefined()
		expect(
			keyboardNudge('ArrowDown', false, image, { width: 0, height: 200 }, 'move')
		).toBeUndefined()
	})
})
