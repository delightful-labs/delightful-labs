import pica, { type PicaCanvas } from 'pica'

const resizer = pica({ features: ['js', 'wasm'] })

export type ImageDimensions = { width: number; height: number }
export type ImageProcessingOptions = {
	maxWidth: number
	maxHeight: number
	mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
	quality?: number
}

export function decodeImage(file: Blob) {
	return createImageBitmap(file, { imageOrientation: 'from-image' })
}

export async function initializeImageResizer(): Promise<void> {
	await resizer.init()
}

export function fitImageDimensions(
	image: ImageDimensions,
	max: Pick<ImageProcessingOptions, 'maxWidth' | 'maxHeight'>
): ImageDimensions {
	const scale = Math.min(1, max.maxWidth / image.width, max.maxHeight / image.height)
	return {
		width: Math.max(1, Math.round(image.width * scale)),
		height: Math.max(1, Math.round(image.height * scale))
	}
}

export function createImageCanvas(image: ImageBitmap, options: ImageProcessingOptions) {
	const { width, height } = fitImageDimensions(image, options)
	return resizer.createCanvas(width, height, { preferOffscreen: true })
}

export async function resizeImage(image: ImageBitmap, canvas: PicaCanvas) {
	// Pica 10's ImageBitmap orientation fallback creates a DOM canvas even
	// inside a worker. Its native canvas input avoids that fallback entirely.
	const source = new OffscreenCanvas(image.width, image.height)
	try {
		const context = source.getContext('2d')
		if (!context) throw new Error('Image canvas unavailable')
		context.drawImage(image, 0, 0)
		return await resizer.resize(source, canvas)
	} finally {
		releaseImageCanvas(source)
	}
}

export function encodeImage(
	canvas: PicaCanvas,
	options: ImageProcessingOptions
): Promise<Blob | null> {
	return resizer.toBlob(canvas, options.mimeType, options.quality)
}

export async function readImageBytes(blob: Blob) {
	return new Uint8Array(await blob.arrayBuffer())
}

export function releaseImageBitmap(image: ImageBitmap) {
	image.close()
}

export function releaseImageCanvas(canvas: PicaCanvas) {
	try {
		canvas.width = 0
	} finally {
		canvas.height = 0
	}
}
