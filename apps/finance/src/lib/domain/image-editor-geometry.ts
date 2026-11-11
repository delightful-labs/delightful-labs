export type ImagePoint = { x: number; y: number }
export type ImageSize = { width: number; height: number }
export type ImageCorner = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft'
export type ImageQuad = Record<ImageCorner, ImagePoint>
export type ImageRect = ImagePoint & ImageSize
export type ImageSelection =
	{ mode: 'square' | 'rectangle'; rect: ImageRect } | { mode: 'perspective'; quad: ImageQuad }
export type ImageSelectionMode = ImageSelection['mode']
export type SelectionMovement =
	{ kind: 'move'; delta: ImagePoint } | { kind: 'corner'; corner: ImageCorner; delta: ImagePoint }

export const MAX_EDITOR_EDGE = 2048
const EPSILON = 1e-8
const clamp = (value: number, minimum: number, maximum: number) =>
	Math.max(minimum, Math.min(maximum, value))
const distance = (left: ImagePoint, right: ImagePoint) =>
	Math.hypot(left.x - right.x, left.y - right.y)

export function selectionQuad(selection: ImageSelection): ImageQuad {
	if (selection.mode === 'perspective') return selection.quad
	const { x, y, width, height } = selection.rect
	return {
		topLeft: { x, y },
		topRight: { x: x + width, y },
		bottomRight: { x: x + width, y: y + height },
		bottomLeft: { x, y: y + height }
	}
}

/** Clockwise source-image coordinates; rejects crossed, concave and collapsed selections. */
export function validImageQuad(quad: ImageQuad, image: ImageSize): boolean {
	const points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
	if (
		!Number.isFinite(image.width) ||
		!Number.isFinite(image.height) ||
		image.width < 1 ||
		image.height < 1
	)
		return false
	return points.every((point, index) => {
		const next = points[(index + 1) % 4]
		const after = points[(index + 2) % 4]
		if (!next || !after) return false
		return (
			Number.isFinite(point.x) &&
			Number.isFinite(point.y) &&
			point.x >= 0 &&
			point.y >= 0 &&
			point.x <= image.width &&
			point.y <= image.height &&
			distance(point, next) >= 1 &&
			(next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x) > EPSILON
		)
	})
}

export function initialImageSelection(mode: ImageSelectionMode, image: ImageSize): ImageSelection {
	const width = mode === 'square' ? Math.min(image.width, image.height) : image.width
	const height = mode === 'square' ? width : image.height
	const rect = { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height }
	return mode === 'perspective'
		? { mode, quad: selectionQuad({ mode: 'rectangle', rect }) }
		: { mode, rect }
}

export function moveImageSelection(
	selection: ImageSelection,
	movement: SelectionMovement,
	image: ImageSize
): ImageSelection {
	if (!Number.isFinite(movement.delta.x) || !Number.isFinite(movement.delta.y)) return selection
	const quad = selectionQuad(selection)
	if (movement.kind === 'move') {
		const points = Object.values(quad)
		const dx = clamp(
			movement.delta.x,
			-Math.min(...points.map(({ x }) => x)),
			image.width - Math.max(...points.map(({ x }) => x))
		)
		const dy = clamp(
			movement.delta.y,
			-Math.min(...points.map(({ y }) => y)),
			image.height - Math.max(...points.map(({ y }) => y))
		)
		if (selection.mode !== 'perspective')
			return {
				...selection,
				rect: { ...selection.rect, x: selection.rect.x + dx, y: selection.rect.y + dy }
			}
		const translate = (point: ImagePoint) => ({ x: point.x + dx, y: point.y + dy })
		return {
			mode: 'perspective',
			quad: {
				topLeft: translate(quad.topLeft),
				topRight: translate(quad.topRight),
				bottomRight: translate(quad.bottomRight),
				bottomLeft: translate(quad.bottomLeft)
			}
		}
	}
	const point = quad[movement.corner]
	const moved = {
		x: clamp(point.x + movement.delta.x, 0, image.width),
		y: clamp(point.y + movement.delta.y, 0, image.height)
	}
	if (selection.mode === 'perspective') {
		const next = { ...quad, [movement.corner]: moved }
		return validImageQuad(next, image) ? { mode: 'perspective', quad: next } : selection
	}
	const left = movement.corner === 'topLeft' || movement.corner === 'bottomLeft'
	const top = movement.corner === 'topLeft' || movement.corner === 'topRight'
	const anchor = {
		x: left ? selection.rect.x + selection.rect.width : selection.rect.x,
		y: top ? selection.rect.y + selection.rect.height : selection.rect.y
	}
	const maxWidth = left ? anchor.x : image.width - anchor.x
	const maxHeight = top ? anchor.y : image.height - anchor.y
	let width = clamp(left ? anchor.x - moved.x : moved.x - anchor.x, 1, maxWidth)
	let height = clamp(top ? anchor.y - moved.y : moved.y - anchor.y, 1, maxHeight)
	if (selection.mode === 'square') {
		const preferred = Math.abs(movement.delta.x) >= Math.abs(movement.delta.y) ? width : height
		width = clamp(preferred, 1, Math.min(maxWidth, maxHeight))
		height = width
	}
	return {
		mode: selection.mode,
		rect: {
			x: left ? anchor.x - width : anchor.x,
			y: top ? anchor.y - height : anchor.y,
			width,
			height
		}
	}
}

export function imageSelectionSize(selection: ImageSelection): ImageSize {
	const quad = selectionQuad(selection)
	const width = Math.max(
		distance(quad.topLeft, quad.topRight),
		distance(quad.bottomLeft, quad.bottomRight)
	)
	const height = Math.max(
		distance(quad.topLeft, quad.bottomLeft),
		distance(quad.topRight, quad.bottomRight)
	)
	const scale = Math.min(1, MAX_EDITOR_EDGE / width, MAX_EDITOR_EDGE / height)
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale))
	}
}

/** Maps a point on a unit rectangle into the selected source quadrilateral. */
export function quadProjection(quad: ImageQuad): (u: number, v: number) => ImagePoint {
	const { topLeft: a, topRight: b, bottomRight: c, bottomLeft: d } = quad
	const sx = a.x - b.x + c.x - d.x
	const sy = a.y - b.y + c.y - d.y
	const dx1 = b.x - c.x,
		dx2 = d.x - c.x
	const dy1 = b.y - c.y,
		dy2 = d.y - c.y
	const determinant = dx1 * dy2 - dx2 * dy1
	const affine = Math.abs(sx) < EPSILON && Math.abs(sy) < EPSILON
	if (!affine && Math.abs(determinant) < EPSILON)
		throw new Error('Degenerate perspective selection')
	const g = affine ? 0 : (sx * dy2 - dx2 * sy) / determinant
	const h = affine ? 0 : (dx1 * sy - sx * dy1) / determinant
	const ax = b.x - a.x + g * b.x,
		bx = d.x - a.x + h * d.x
	const ay = b.y - a.y + g * b.y,
		by = d.y - a.y + h * d.y
	return (u, v) => {
		const denominator = g * u + h * v + 1
		if (!Number.isFinite(denominator) || Math.abs(denominator) < EPSILON)
			throw new Error('Invalid perspective projection')
		return { x: (ax * u + bx * v + a.x) / denominator, y: (ay * u + by * v + a.y) / denominator }
	}
}
