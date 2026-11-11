import pica, { type PicaCanvas } from 'pica'

const resizer = pica()

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
	return resizer.createCanvas(width, height)
}

export function resizeImage(image: ImageBitmap, canvas: PicaCanvas) {
	return resizer.resize(image, canvas)
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
