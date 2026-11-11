import {
	imageSelectionSize,
	quadProjection,
	selectionQuad,
	validImageQuad,
	type ImageSelection
} from './image-editor-geometry.js'

export type ImageAdjustments = { blackWhite: boolean; contrast: number }
const clampByte = (value: number) => Math.max(0, Math.min(255, value))

/** Pure inverse perspective mapping, with bilinear samples in premultiplied alpha. */
export function renderEditorPixels(
	source: ImageData,
	selection: ImageSelection,
	adjustments: ImageAdjustments
): ImageData {
	const quad = selectionQuad(selection)
	if (!validImageQuad(quad, source)) throw new Error('Invalid image selection')
	if (
		!Number.isFinite(adjustments.contrast) ||
		adjustments.contrast < 0 ||
		adjustments.contrast > 200
	)
		throw new Error('Invalid image contrast')
	const { width, height } = imageSelectionSize(selection)
	const output = new ImageData(width, height)
	const project = quadProjection(quad)
	const pixels = source.data
	const factor = adjustments.contrast / 100
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const point = project((x + 0.5) / width, (y + 0.5) / height)
			const sx = Math.max(0, Math.min(source.width - 1, point.x - 0.5))
			const sy = Math.max(0, Math.min(source.height - 1, point.y - 0.5))
			const x0 = Math.floor(sx),
				y0 = Math.floor(sy)
			const x1 = Math.min(x0 + 1, source.width - 1),
				y1 = Math.min(y0 + 1, source.height - 1)
			const fx = sx - x0,
				fy = sy - y0
			const a = (y0 * source.width + x0) * 4,
				b = (y0 * source.width + x1) * 4
			const c = (y1 * source.width + x0) * 4,
				d = (y1 * source.width + x1) * 4
			const wa = (1 - fx) * (1 - fy) * (pixels[a + 3] ?? 0)
			const wb = fx * (1 - fy) * (pixels[b + 3] ?? 0)
			const wc = (1 - fx) * fy * (pixels[c + 3] ?? 0)
			const wd = fx * fy * (pixels[d + 3] ?? 0)
			const alpha = wa + wb + wc + wd
			const target = (y * width + x) * 4
			// Interpolate color before adjustments so transparent edges do not bleed black.
			for (let channel = 0; channel < 3; channel += 1) {
				output.data[target + channel] =
					alpha > 0
						? ((pixels[a + channel] ?? 0) * wa +
								(pixels[b + channel] ?? 0) * wb +
								(pixels[c + channel] ?? 0) * wc +
								(pixels[d + channel] ?? 0) * wd) /
							alpha
						: 0
			}
			const red = output.data[target] ?? 0,
				green = output.data[target + 1] ?? 0,
				blue = output.data[target + 2] ?? 0
			const gray = 0.2126 * red + 0.7152 * green + 0.0722 * blue
			output.data[target] = clampByte(
				((adjustments.blackWhite ? gray : red) - 127.5) * factor + 127.5
			)
			output.data[target + 1] = clampByte(
				((adjustments.blackWhite ? gray : green) - 127.5) * factor + 127.5
			)
			output.data[target + 2] = clampByte(
				((adjustments.blackWhite ? gray : blue) - 127.5) * factor + 127.5
			)
			output.data[target + 3] = alpha
		}
	}
	return output
}
