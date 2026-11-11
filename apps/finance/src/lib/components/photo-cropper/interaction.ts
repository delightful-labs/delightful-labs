import type { CropCorner, CropperEvent } from './machine.js'

type ImageSize = { width: number; height: number }
type ViewportBounds = Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>

export function sourcePointFromPointer(
	event: Pick<PointerEvent, 'clientX' | 'clientY'>,
	viewport: ViewportBounds,
	image: ImageSize
) {
	const scale = Math.min(viewport.width / image.width, viewport.height / image.height)
	return {
		x: (event.clientX - viewport.left - (viewport.width - image.width * scale) / 2) / scale,
		y: (event.clientY - viewport.top) / scale
	}
}

export function keyboardNudge(
	key: string,
	shiftKey: boolean,
	image: ImageSize,
	viewport: Pick<DOMRect, 'width' | 'height'>,
	mode: 'move' | 'resize',
	corner?: CropCorner
): Extract<CropperEvent, { type: 'NUDGE' }> | undefined {
	const direction =
		key === 'ArrowLeft'
			? { x: -1, y: 0 }
			: key === 'ArrowRight'
				? { x: 1, y: 0 }
				: key === 'ArrowUp'
					? { x: 0, y: -1 }
					: key === 'ArrowDown'
						? { x: 0, y: 1 }
						: undefined
	if (!direction || viewport.width <= 0 || viewport.height <= 0) return undefined
	const scale = Math.min(viewport.width / image.width, viewport.height / image.height)
	const step = (shiftKey ? 10 : 1) / scale
	const delta = { x: direction.x * step, y: direction.y * step }
	return mode === 'resize' && corner
		? { type: 'NUDGE', mode, corner, delta }
		: { type: 'NUDGE', mode: 'move', delta }
}
