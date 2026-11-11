import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { imageEditorMachine, imageEditorPresentation } from './image-editor.js'
import * as platform from '../../domain/image-editor-platform.js'
import * as pixels from '../../domain/image-editor-pixels.js'
import { TestImageData } from '../../testing/image-editor/fixtures.js'
import { createActor, toPromise, waitFor, createAsyncLogic } from 'xstate'

const cleanups: (() => void)[] = []
beforeEach(() => vi.stubGlobal('ImageData', TestImageData))
afterEach(() => {
	cleanups.splice(0).forEach((cleanup) => cleanup())
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

function fixture(mimeType = 'image/png') {
	const file = new File(['original'], 'receipt.png', { type: mimeType })
	const source = new TestImageData(
		4,
		4,
		Array.from({ length: 16 }, () => [64, 128, 192, 255]).flat()
	)
	const bitmap: ImageBitmap = { width: 4, height: 4, close: vi.fn() }
	const canvas = new (class {
		width = 0
		height = 0
	})()
	vi.stubGlobal('document', { createElement: () => canvas })
	const canvasResource = platform.createEditorCanvas()
	const decode = vi.spyOn(platform, 'decodeEditorImage').mockResolvedValue(bitmap)
	const read = vi.fn(async (_bitmap: ImageBitmap): Promise<ImageData> => source)
	const allocate = vi.fn(async () => canvasResource)
	const paint = vi.spyOn(platform, 'paintEditorCanvas').mockImplementation((target, buffer) => {
		target.width = buffer.width
		target.height = buffer.height
	})
	const encode = vi
		.spyOn(platform, 'encodeEditorCanvas')
		.mockResolvedValue(new Blob(['edited'], { type: mimeType }))
	const release = vi.spyOn(platform, 'releaseEditorCanvas')
	const render = vi.spyOn(pixels, 'renderEditorPixels')
	const actor = createActor(
		imageEditorMachine.provide({
			actors: {
				read: createAsyncLogic({ run: ({ input }: { input: ImageBitmap }) => read(input) }),
				allocate: createAsyncLogic({ run: () => allocate() })
			}
		}),
		{ input: { file } }
	)
	cleanups.push(() => actor.stop())
	return {
		actor,
		file,
		source,
		bitmap,
		canvas,
		canvasResource,
		decode,
		read,
		allocate,
		paint,
		encode,
		release,
		render
	}
}
async function ready(f: ReturnType<typeof fixture>) {
	f.actor.start()
	await waitFor(f.actor, (snapshot) => snapshot.matches('interactive'))
}

describe('image editor actor', () => {
	it('rejects unsupported inputs before decoding', async () => {
		const f = fixture('image/svg+xml')
		f.actor.start()
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'failed', reason: 'input' })
		expect(f.decode).not.toHaveBeenCalled()
	})

	it('releases the bitmap before interaction and initializes independent perspective corners', async () => {
		const f = fixture()
		await ready(f)
		expect(f.bitmap.close).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().context.bitmap).toBeUndefined()
		f.actor.send({
			type: 'NUDGE',
			target: { kind: 'corner', corner: 'topLeft' },
			delta: { x: 1, y: 1 }
		})
		expect(f.actor.getSnapshot().context.selection).toEqual({
			mode: 'perspective',
			quad: {
				topLeft: { x: 1, y: 1 },
				topRight: { x: 4, y: 0 },
				bottomRight: { x: 4, y: 4 },
				bottomLeft: { x: 0, y: 4 }
			}
		})
		f.actor.send({
			type: 'BEGIN_DRAG',
			target: { kind: 'corner', corner: 'topRight' },
			point: { x: 3.5, y: 0.5 }
		})
		f.actor.send({ type: 'DRAG', point: { x: 3.5, y: 0.5 } })
		expect(f.actor.getSnapshot().context.selection?.mode).toBe('perspective')
		const selection = f.actor.getSnapshot().context.selection
		if (selection?.mode !== 'perspective') throw new Error('Missing perspective selection')
		expect(selection.quad.topRight).toEqual({ x: 4, y: 0 })
		f.actor.send({ type: 'END_DRAG' })
		expect(f.actor.getSnapshot().matches({ interactive: { editing: 'idle' } })).toBe(true)
	})

	it('uses original pixels for every preview, resets adjustments, and exports the same preview pixels', async () => {
		const f = fixture()
		await ready(f)
		f.actor.send({ type: 'SET_BLACK_WHITE', value: true })
		f.actor.send({ type: 'SET_CONTRAST', value: 150 })
		f.actor.send({ type: 'PREVIEW' })
		await waitFor(f.actor, (snapshot) => snapshot.matches({ interactive: 'previewReady' }))
		const preview = f.actor.getSnapshot().context.preview
		f.actor.send({ type: 'EDIT' })
		f.actor.send({ type: 'APPLY' })
		const result = await toPromise(f.actor)
		expect(result.kind).toBe('applied')
		if (result.kind !== 'applied') throw new Error('Missing edited file')
		expect([result.file.name, result.file.type, await result.file.text()]).toEqual([
			'receipt.png',
			'image/png',
			'edited'
		])
		expect(await f.file.text()).toBe('original')
		expect(f.render.mock.calls.every(([source]) => source === f.source)).toBe(true)
		expect(f.paint.mock.calls[0]?.[1].data).toEqual(preview?.data)
		expect(f.release).toHaveBeenCalledExactlyOnceWith(f.canvasResource)
		expect(f.canvas).toEqual({ width: 0, height: 0 })
		expect(f.actor.getSnapshot().context.source).toBeUndefined()
	})

	it('resets geometry and adjustments and clamps contrast without accepting nonfinite values', async () => {
		const f = fixture()
		await ready(f)
		f.actor.send({ type: 'SET_MODE', mode: 'rectangle' })
		f.actor.send({
			type: 'NUDGE',
			target: { kind: 'corner', corner: 'topLeft' },
			delta: { x: 2, y: 1 }
		})
		expect(f.actor.getSnapshot().context.selection).toEqual({
			mode: 'rectangle',
			rect: { x: 2, y: 1, width: 2, height: 3 }
		})
		f.actor.send({ type: 'SET_CONTRAST', value: 999 })
		expect(f.actor.getSnapshot().context.adjustments.contrast).toBe(200)
		f.actor.send({ type: 'SET_CONTRAST', value: NaN })
		expect(f.actor.getSnapshot().context.adjustments.contrast).toBe(200)
		f.actor.send({ type: 'SET_BLACK_WHITE', value: true })
		f.actor.send({ type: 'RESET' })
		expect(f.actor.getSnapshot().context.adjustments).toEqual({ blackWhite: false, contrast: 100 })
		expect(f.actor.getSnapshot().context.selection).toEqual({
			mode: 'rectangle',
			rect: { x: 0, y: 0, width: 4, height: 4 }
		})
	})

	it.each(['CANCEL', 'SHUTDOWN'] satisfies ('CANCEL' | 'SHUTDOWN')[])(
		'waits for late decoding on %s and releases the acquired bitmap',
		async (type) => {
			const f = fixture()
			const pending = Promise.withResolvers<ImageBitmap>()
			f.decode.mockReturnValue(pending.promise)
			f.actor.start()
			f.actor.send({ type })
			expect(f.actor.getSnapshot().status).toBe('active')
			pending.resolve(f.bitmap)
			await expect(toPromise(f.actor)).resolves.toEqual({
				kind: type === 'CANCEL' ? 'cancelled' : 'closed'
			})
			expect(f.bitmap.close).toHaveBeenCalledOnce()
			expect(f.read).not.toHaveBeenCalled()
		}
	)

	it('releases the source bitmap after cancellation while reading pixels', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<ImageData>()
		f.read.mockReturnValue(pending.promise)
		f.actor.start()
		await waitFor(f.actor, (snapshot) => snapshot.matches('readingSource'))
		f.actor.send({ type: 'CANCEL' })
		pending.resolve(f.source)
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'cancelled' })
		expect(f.bitmap.close).toHaveBeenCalledOnce()
		expect(f.allocate).not.toHaveBeenCalled()
	})

	it('retains and releases a canvas allocated after cancellation', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<HTMLCanvasElement>()
		f.allocate.mockReturnValue(pending.promise)
		await ready(f)
		f.actor.send({ type: 'APPLY' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('creatingCanvas'))
		f.actor.send({ type: 'CANCEL' })
		pending.resolve(f.canvasResource)
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'cancelled' })
		expect(f.paint).not.toHaveBeenCalled()
		expect(f.release).toHaveBeenCalledExactlyOnceWith(f.canvasResource)
	})

	it.each(['CANCEL', 'SHUTDOWN'] satisfies ('CANCEL' | 'SHUTDOWN')[])(
		'discards late encoding on %s and drains cleanup before completion',
		async (type) => {
			const f = fixture()
			const pending = Promise.withResolvers<Blob | null>()
			f.encode.mockReturnValue(pending.promise)
			await ready(f)
			f.actor.send({ type: 'APPLY' })
			await waitFor(f.actor, (snapshot) => snapshot.matches('encoding'))
			f.actor.send({ type })
			if (type === 'SHUTDOWN') f.actor.send({ type: 'CANCEL' })
			expect(f.actor.getSnapshot().status).toBe('active')
			pending.resolve(new Blob(['late'], { type: 'image/png' }))
			await expect(toPromise(f.actor)).resolves.toEqual({
				kind: type === 'CANCEL' ? 'cancelled' : 'closed'
			})
			expect(f.release).toHaveBeenCalledOnce()
			expect(f.canvas).toEqual({ width: 0, height: 0 })
		}
	)

	it.each([
		null,
		new Blob([], { type: 'image/png' }),
		new Blob(['wrong codec'], { type: 'image/webp' })
	])('rejects missing, empty or wrong-codec output and releases its canvas', async (blob) => {
		const f = fixture()
		f.encode.mockResolvedValue(blob)
		await ready(f)
		f.actor.send({ type: 'APPLY' })
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'failed', reason: 'encode' })
		expect(f.release).toHaveBeenCalledOnce()
	})

	it('cleans the bitmap when source reading fails', async () => {
		const f = fixture()
		f.read.mockRejectedValue(new Error('read failed'))
		f.actor.start()
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'failed', reason: 'read' })
		expect(f.bitmap.close).toHaveBeenCalledOnce()
	})

	it('reports rendering failures without allocating an export canvas', async () => {
		const f = fixture()
		f.render.mockImplementation(() => {
			throw new Error('render failed')
		})
		await ready(f)
		f.actor.send({ type: 'APPLY' })
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'failed', reason: 'render' })
		expect(f.allocate).not.toHaveBeenCalled()
	})

	it('releases the export canvas when painting fails', async () => {
		const f = fixture()
		f.paint.mockImplementation(() => {
			throw new Error('paint failed')
		})
		await ready(f)
		f.actor.send({ type: 'APPLY' })
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'failed', reason: 'render' })
		expect(f.release).toHaveBeenCalledOnce()
		expect(f.encode).not.toHaveBeenCalled()
	})

	it('does not publish success if canvas cleanup fails', async () => {
		const f = fixture()
		f.release.mockImplementation(() => {
			throw new Error('release failed')
		})
		await ready(f)
		f.actor.send({ type: 'APPLY' })
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'failed', reason: 'cleanup' })
	})
	it('projects loading, editing, preview and export into explicit presentation capabilities', async () => {
		const f = fixture()
		const decode = Promise.withResolvers<ImageBitmap>()
		f.decode.mockReturnValue(decode.promise)
		f.actor.start()
		expect(imageEditorPresentation(f.actor.getSnapshot())).toMatchObject({
			status: 'loading',
			viewport: { kind: 'empty' },
			controls: { apply: false, adjust: false, cancel: true }
		})
		decode.resolve(f.bitmap)
		await waitFor(f.actor, (snapshot) => snapshot.matches('interactive'))
		expect(imageEditorPresentation(f.actor.getSnapshot())).toMatchObject({
			status: 'editing',
			viewport: { kind: 'selection', enabled: true },
			controls: { apply: true, preview: true, edit: false }
		})
		f.actor.send({ type: 'PREVIEW' })
		await waitFor(f.actor, (snapshot) => snapshot.matches({ interactive: 'previewReady' }))
		expect(imageEditorPresentation(f.actor.getSnapshot())).toMatchObject({
			status: 'preview',
			viewport: { kind: 'preview' },
			controls: { edit: true, preview: false }
		})
		const encode = Promise.withResolvers<Blob | null>()
		f.encode.mockReturnValue(encode.promise)
		f.actor.send({ type: 'APPLY' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('encoding'))
		expect(imageEditorPresentation(f.actor.getSnapshot())).toMatchObject({
			status: 'exporting',
			busy: true,
			controls: { apply: false, adjust: false, cancel: true }
		})
		f.actor.send({ type: 'CANCEL' })
		encode.resolve(null)
		await toPromise(f.actor)
		expect(imageEditorPresentation(f.actor.getSnapshot())).toMatchObject({
			status: 'finished',
			viewport: { kind: 'empty' },
			controls: { apply: false, cancel: false }
		})
	})

	it('handles a native display failure without allocating export resources', async () => {
		const f = fixture()
		await ready(f)
		f.actor.send({ type: 'DISPLAY_FAILED' })
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'failed', reason: 'render' })
		expect(imageEditorPresentation(f.actor.getSnapshot())).toMatchObject({
			status: 'failed',
			viewport: { kind: 'empty' },
			controls: { apply: false, cancel: true }
		})
		expect(f.allocate).not.toHaveBeenCalled()
	})
})
