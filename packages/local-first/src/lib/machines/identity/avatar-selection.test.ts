import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { createAvatarSelectionMachine, selectAvatarSelection } from './avatar-selection.js'

const actors = new Set<
	ReturnType<typeof createActor<ReturnType<typeof createAvatarSelectionMachine>>>
>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
const file = (name: string) => new File(['image'], name, { type: 'image/png' })
function fixture(saved: File | null = file('saved')) {
	const validateFile = vi.fn((_file: File) => true)
	const onSelectionChange = vi.fn<(_file: File | null) => void>()
	const onRemove = vi.fn<() => void>()
	const observation = { profileId: 'one', resetRevision: 0, saved }
	const actor = createActor(
		createAvatarSelectionMachine({ validateFile, onSelectionChange, onRemove }),
		{ input: observation }
	).start()
	actors.add(actor)
	const view = () => selectAvatarSelection(actor.getSnapshot())
	function crop() {
		const value = view().crop
		if (!value) throw new Error('Expected crop')
		return value
	}
	return { actor, observation, validateFile, onSelectionChange, onRemove, view, crop }
}
describe('avatar selection', () => {
	it('accepts a crop only after validation, then clears its working references', () => {
		const f = fixture(),
			original = file('input'),
			cropped = file('cropped')
		f.actor.send({ type: 'SELECT', file: original })
		expect(f.validateFile).toHaveBeenCalledExactlyOnceWith(original)
		expect(f.view().selected).toBe(f.observation.saved)
		expect(f.onSelectionChange).not.toHaveBeenCalled()
		f.actor.send({ type: 'ACCEPT', crop: f.crop(), file: cropped })
		expect(f.view()).toMatchObject({
			selected: cropped,
			crop: undefined,
			dirty: true,
			invalid: false
		})
		expect(f.onSelectionChange).toHaveBeenCalledExactlyOnceWith(cropped)
		expect(f.actor.getSnapshot().context.candidate).toBeUndefined()
	})
	it.each(['false', 'throw'])('rejects %s validation without losing the saved image', (mode) => {
		const f = fixture()
		f.validateFile.mockImplementation(() => {
			if (mode === 'throw') throw new Error('validator')
			return false
		})
		f.actor.send({ type: 'SELECT', file: file('bad') })
		expect(f.view()).toMatchObject({
			selected: f.observation.saved,
			invalid: true,
			crop: undefined,
			dirty: false
		})
		expect(f.onSelectionChange).toHaveBeenCalledExactlyOnceWith(f.observation.saved)
	})
	it('dismisses editing without changing the selected draft or revalidating', () => {
		const f = fixture(),
			draft = file('draft')
		f.actor.send({ type: 'EDIT', file: draft })
		f.actor.send({ type: 'ACCEPT', crop: f.crop(), file: draft })
		f.onSelectionChange.mockClear()
		f.actor.send({ type: 'EDIT', file: draft })
		f.actor.send({ type: 'DISMISS', crop: f.crop() })
		expect(f.view().selected).toBe(draft)
		expect(f.onSelectionChange).not.toHaveBeenCalled()
		expect(f.validateFile).not.toHaveBeenCalled()
	})
	it.each(['profile', 'revision'])(
		'discards a crop on %s reset and ignores its late result',
		(kind) => {
			const f = fixture()
			f.actor.send({ type: 'SELECT', file: file('input') })
			const old = f.crop(),
				saved = file('new saved')
			f.actor.send({
				type: 'OBSERVE',
				observation: {
					...f.observation,
					saved,
					profileId: kind === 'profile' ? 'two' : 'one',
					resetRevision: kind === 'revision' ? 1 : 0
				}
			})
			f.actor.send({ type: 'ACCEPT', crop: old, file: file('late') })
			expect(f.view()).toMatchObject({ selected: saved, crop: undefined, dirty: false })
			expect(f.onSelectionChange).not.toHaveBeenCalled()
		}
	)
	it('rejects old crop callbacks after another selection', () => {
		const f = fixture()
		f.actor.send({ type: 'SELECT', file: file('first') })
		const old = f.crop()
		f.actor.send({ type: 'SELECT', file: file('second') })
		const current = f.crop()
		f.actor.send({ type: 'ACCEPT', crop: old, file: file('late') })
		f.actor.send({ type: 'DISMISS', crop: old })
		expect(f.crop()).toBe(current)
		expect(f.onSelectionChange).not.toHaveBeenCalled()
	})
	it('follows refreshed saved images while preserving an active crop and accepted draft', () => {
		const f = fixture(),
			refreshed = file('refreshed'),
			draft = file('draft')
		f.actor.send({ type: 'SELECT', file: file('input') })
		const crop = f.crop()
		f.actor.send({ type: 'OBSERVE', observation: { ...f.observation, saved: refreshed } })
		expect(f.view().selected).toBe(refreshed)
		expect(f.crop()).toBe(crop)
		f.actor.send({ type: 'ACCEPT', crop, file: draft })
		f.actor.send({ type: 'OBSERVE', observation: { ...f.observation, saved: file('again') } })
		expect(f.view().selected).toBe(draft)
	})
	it('clears an accepted draft to saved, then requests saved removal separately', () => {
		const f = fixture()
		f.actor.send({ type: 'EDIT', file: file('draft') })
		f.actor.send({ type: 'ACCEPT', crop: f.crop(), file: file('cropped') })
		f.onSelectionChange.mockClear()
		f.actor.send({ type: 'SELECT', file: null })
		expect(f.onSelectionChange).toHaveBeenCalledExactlyOnceWith(f.observation.saved)
		expect(f.onRemove).not.toHaveBeenCalled()
		f.actor.send({ type: 'SELECT', file: null })
		expect(f.onRemove).toHaveBeenCalledOnce()
	})
	it('clears files on shutdown and ignores old crop callbacks', () => {
		const f = fixture(null)
		f.actor.send({ type: 'SELECT', file: file('input') })
		const crop = f.crop()
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'ACCEPT', crop, file: file('late') })
		expect(f.actor.getSnapshot().status).toBe('done')
		expect(f.view()).toEqual({ selected: null, crop: undefined, dirty: false, invalid: false })
		expect(f.actor.getSnapshot().context.candidate).toBeUndefined()
		expect(f.onSelectionChange).not.toHaveBeenCalled()
	})
})
