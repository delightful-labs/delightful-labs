import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	transactionImageSelectionMachine,
	transactionImageSelectionPresentation
} from './transaction-image-selection.js'
import { mockEditorPlatform } from '../../../testing/image-editor/fixtures.js'
import { createActor, toPromise, waitFor } from 'xstate'

const cleanups: (() => void)[] = []
afterEach(() => {
	cleanups.splice(0).forEach((cleanup) => cleanup())
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
function fixture(editable = true) {
	const platform = mockEditorPlatform()
	const files = [
		new File(['original'], 'receipt.png', { type: 'image/png' }),
		new File(['second'], 'other.png', { type: 'image/png' })
	]
	const first = files[0]
	if (!first) throw new Error('Missing first image')
	const actor = createActor(transactionImageSelectionMachine, { input: { editable } }).start()
	cleanups.push(() => actor.stop())
	actor.send({ type: 'SELECT', files })
	return { ...platform, actor, files, first }
}
async function edit(f: ReturnType<typeof fixture>) {
	f.actor.send({ type: 'EDIT', file: f.first })
	const editor = f.actor.getSnapshot().children.editor
	if (!editor) throw new Error('Missing draft editor')
	await waitFor(editor, (snapshot) => snapshot.matches('interactive'))
	return editor
}

describe('transaction image draft selection owner', () => {
	it('applies one edited file in place while retaining the other selected file and source bytes', async () => {
		const f = fixture()
		const editor = await edit(f)
		expect(transactionImageSelectionPresentation(f.actor.getSnapshot()).canSelect).toBe(false)
		editor.send({ type: 'APPLY' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('ready'))
		const files = f.actor.getSnapshot().context.files
		expect(files).toHaveLength(2)
		expect(files[0]).not.toBe(f.first)
		expect(files[1]).toBe(f.files[1])
		expect(await files[0]?.text()).toBe('edited')
		expect(await f.first.text()).toBe('original')
		expect(f.release).toHaveBeenCalledOnce()
	})

	it('cancels pending encoding and retains the existing selection', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<Blob | null>()
		f.encode.mockReturnValue(pending.promise)
		const editor = await edit(f)
		editor.send({ type: 'APPLY' })
		await waitFor(editor, (snapshot) => snapshot.matches('encoding'))
		f.actor.send({ type: 'CLOSE' })
		expect(f.actor.getSnapshot().matches({ editing: 'cancelling' })).toBe(true)
		pending.resolve(new Blob(['late'], { type: 'image/png' }))
		await waitFor(f.actor, (snapshot) => snapshot.matches('ready'))
		expect(f.actor.getSnapshot().context.files).toEqual(f.files)
		expect(f.release).toHaveBeenCalledOnce()
	})

	it('retains a new selection rather than committing a stale editor result', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<Blob | null>()
		f.encode.mockReturnValue(pending.promise)
		const editor = await edit(f)
		editor.send({ type: 'APPLY' })
		await waitFor(editor, (snapshot) => snapshot.matches('encoding'))
		const replacement = new File(['replacement'], 'replacement.png', { type: 'image/png' })
		f.actor.send({ type: 'SELECT', files: [replacement] })
		pending.resolve(new Blob(['late'], { type: 'image/png' }))
		await waitFor(f.actor, (snapshot) => snapshot.matches('ready'))
		expect(f.actor.getSnapshot().context.files).toEqual([replacement])
	})

	it('locks editing on permission loss and never revives the cancelled edit after permission returns', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<ImageBitmap>()
		f.decode.mockReturnValue(pending.promise)
		f.actor.send({ type: 'EDIT', file: f.first })
		f.actor.send({ type: 'SET_EDITABLE', editable: false })
		f.actor.send({ type: 'SET_EDITABLE', editable: true })
		pending.resolve(f.bitmap)
		await waitFor(f.actor, (snapshot) => snapshot.matches('ready'))
		expect(f.actor.getSnapshot().context.files).toEqual(f.files)
		expect(f.bitmap.close).toHaveBeenCalledOnce()
		expect(f.read).not.toHaveBeenCalled()
	})

	it('drains a late decoded bitmap on shutdown and ignores later close requests', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<ImageBitmap>()
		f.decode.mockReturnValue(pending.promise)
		f.actor.send({ type: 'EDIT', file: f.first })
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'CLOSE' })
		pending.resolve(f.bitmap)
		await expect(toPromise(f.actor)).resolves.toEqual({ kind: 'closed' })
		expect(f.bitmap.close).toHaveBeenCalledOnce()
	})

	it('does not select or edit files while locked and rejects an unrelated file', () => {
		const f = fixture(false)
		expect(f.actor.getSnapshot().context.files).toEqual([])
		f.actor.send({ type: 'SET_EDITABLE', editable: true })
		f.actor.send({ type: 'EDIT', file: f.first })
		expect(f.actor.getSnapshot().context.error).toBe('invalidSelection')
		expect(f.decode).not.toHaveBeenCalled()
	})
})
