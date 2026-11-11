import { MAX_EDITOR_EDGE } from './image-editor-geometry.js'

export function decodeEditorImage(file: File): Promise<ImageBitmap> {
	return createImageBitmap(file, { imageOrientation: 'from-image' })
}

/** Reads one bounded raster; the scratch canvas never escapes this platform operation. */
export function readEditorSource(bitmap: ImageBitmap): ImageData {
	const canvas = document.createElement('canvas')
	try {
		const scale = Math.min(1, MAX_EDITOR_EDGE / bitmap.width, MAX_EDITOR_EDGE / bitmap.height)
		canvas.width = Math.max(1, Math.round(bitmap.width * scale))
		canvas.height = Math.max(1, Math.round(bitmap.height * scale))
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error('Image pixels are unavailable')
		context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
		return context.getImageData(0, 0, canvas.width, canvas.height)
	} finally {
		releaseEditorCanvas(canvas)
	}
}

export function createEditorCanvas(): HTMLCanvasElement {
	return document.createElement('canvas')
}

export function paintEditorCanvas(canvas: HTMLCanvasElement, pixels: ImageData): void {
	canvas.width = pixels.width
	canvas.height = pixels.height
	const context = canvas.getContext('2d')
	if (!context) throw new Error('Image export is unavailable')
	context.putImageData(pixels, 0, 0)
}

export function encodeEditorCanvas(
	canvas: HTMLCanvasElement,
	mimeType: string
): Promise<Blob | null> {
	return new Promise((resolve) => canvas.toBlob(resolve, mimeType, 0.92))
}

export function releaseEditorCanvas(canvas: HTMLCanvasElement): void {
	try {
		canvas.width = 0
	} finally {
		canvas.height = 0
	}
}
