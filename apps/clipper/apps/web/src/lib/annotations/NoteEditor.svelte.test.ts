import { afterEach, expect, it, vi } from 'vitest'
import { flushSync, mount, unmount } from 'svelte'
import { fromStore, writable } from 'svelte/store'
import type { ComponentProps } from 'svelte'
import NoteEditor from './NoteEditor.svelte'
import type { AnnotationCommand } from './schema.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

it('preserves local typing when unrelated worker views repeat unchanged saved text', async () => {
	const original: ComponentProps<typeof NoteEditor>['note'] = { id: crypto.randomUUID(), text: '' }
	const notes = writable(original)
	const current = fromStore(notes)
	const send = vi.fn<(command: AnnotationCommand) => void>()
	const documentId = crypto.randomUUID()
	const target = document.createElement('div')
	document.body.append(target)
	const component = mount(NoteEditor, {
		target,
		props: {
			get note() {
				return current.current
			},
			documentId,
			enabled: true,
			send
		}
	})
	cleanups.push(async () => {
		await unmount(component)
		target.remove()
	})
	flushSync()
	const field = target.querySelector('textarea')
	if (!field) throw new Error('Missing note editor')
	field.value = 'A local edit still traveling to the worker.'
	field.dispatchEvent(new Event('input', { bubbles: true }))
	flushSync()
	expect(send).toHaveBeenLastCalledWith({
		type: 'EDIT_NOTE',
		documentId,
		id: original.id,
		text: field.value,
		editedFrom: ''
	})
	const typed = field.value
	notes.set({ ...original })
	flushSync()
	expect(field.value).toBe(typed)
	// The actual local echo still settles through Jazz's native text adapter.
	notes.set({ ...original, text: typed })
	flushSync()
	expect(field.value).toBe(typed)
	// A genuine accepted change from another device must still reach the field.
	notes.set({ ...original, text: 'Changed on another device.' })
	flushSync()
	expect(field.value).toBe('Changed on another device.')
})
