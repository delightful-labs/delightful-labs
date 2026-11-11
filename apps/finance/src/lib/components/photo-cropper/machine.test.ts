import { afterEach, describe, expect, it, vi } from 'vitest'
import { photoCropperMachine } from './machine.js'
import { createActor, waitFor } from 'xstate'

const cleanups: (() => void)[] = []

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.unstubAllGlobals()
})

function fixture(aspectRatio = 1) {
	const bitmap = { width: 400, height: 200, close: vi.fn() }
	vi.stubGlobal(
		'createImageBitmap',
		vi.fn(async () => bitmap)
	)
	const file = new File(['source'], 'avatar.png', { type: 'image/png' })
	const actor = createActor(photoCropperMachine, { input: { file, aspectRatio } })
	cleanups.push(() => actor.stop())
	return { actor, bitmap, file }
}

describe('photo cropper machine', () => {
	it('initializes a centered square crop and supports bounded dragging and keyboard movement', async () => {
		const { actor } = fixture()
		actor.start()
		await waitFor(actor, (snapshot) => snapshot.matches('ready'))
		expect(actor.getSnapshot().context.crop).toEqual({ x: 100, y: 0, width: 200, height: 200 })

		actor.send({ type: 'NUDGE', mode: 'move', delta: { x: 1000, y: -1000 } })
		expect(actor.getSnapshot().context.crop).toEqual({ x: 200, y: 0, width: 200, height: 200 })
		actor.send({ type: 'POINTER_DOWN', point: { x: 10, y: 10 }, mode: 'move' })
		actor.send({ type: 'POINTER_MOVE', point: { x: -500, y: 500 } })
		expect(actor.getSnapshot().context.crop).toEqual({ x: 0, y: 0, width: 200, height: 200 })
		actor.send({ type: 'POINTER_UP' })
		expect(actor.getSnapshot().matches({ ready: 'idle' })).toBe(true)
		actor.stop()
	})

	it('resizes from a selected corner while retaining the opposite corner', async () => {
		const { actor } = fixture()
		actor.start()
		await waitFor(actor, (snapshot) => snapshot.matches('ready'))
		actor.send({
			type: 'NUDGE',
			mode: 'resize',
			corner: 'topLeft',
			delta: { x: 20, y: 20 }
		})
		expect(actor.getSnapshot().context.crop).toEqual({ x: 120, y: 20, width: 180, height: 180 })
		actor.stop()
	})

	it('closes the decoded bitmap and returns the cropped file after a crop request', async () => {
		const { actor, bitmap } = fixture(2)
		const drawImage = vi.fn()
		const canvas = {
			width: 0,
			height: 0,
			getContext: vi.fn(() => ({ drawImage })),
			toBlob: (callback: BlobCallback) => callback(new Blob(['crop'], { type: 'image/png' }))
		}
		vi.stubGlobal('document', { createElement: vi.fn(() => canvas) })
		actor.start()
		await waitFor(actor, (snapshot) => snapshot.matches('ready'))
		actor.send({ type: 'CROP' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(actor.getSnapshot().output).toMatchObject({ kind: 'cropped', file: expect.any(File) })
		expect(bitmap.close).toHaveBeenCalledOnce()
		expect(drawImage).toHaveBeenCalledOnce()
		expect([canvas.width, canvas.height]).toEqual([0, 0])
	})

	it('closes the decoded bitmap and returns the original file on cancel', async () => {
		const { actor, bitmap, file } = fixture()
		actor.start()
		await waitFor(actor, (snapshot) => snapshot.matches('ready'))
		actor.send({ type: 'CANCEL' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(actor.getSnapshot().output).toEqual({ kind: 'cancelled', file })
		expect(bitmap.close).toHaveBeenCalledOnce()
	})
})
