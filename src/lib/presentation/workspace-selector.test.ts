import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import WorkspaceSelector from '../components/workspaces/WorkspaceSelector.svelte'
import { createWorkspaceSelectorView } from './workspace-selector.js'
import type { WorkspaceDirectory } from '../contracts/workspace-selection.js'

const first = { id: 'first', name: 'Personal' }
const second = { id: 'second', name: 'Shared' }
const duplicateName = (name: string, id: string) => `${name} [${id}]`
function view(
	entries: readonly { id: string; name: string }[],
	workspaceId: string | null = null,
	disabled = false
) {
	return createWorkspaceSelectorView({
		directory: { status: 'available', entries },
		workspaceId,
		disabled,
		duplicateName
	})
}
describe('local workspace selector projection', () => {
	it.each(['loading', 'unavailable', 'failed'] satisfies WorkspaceDirectory['status'][])(
		'does not call an unknown %s directory empty',
		(status) => {
			const format = vi.fn(duplicateName)
			expect(
				createWorkspaceSelectorView({
					directory: { status },
					workspaceId: first.id,
					duplicateName: format
				})
			).toEqual({ kind: 'unavailable' })
			expect(format).not.toHaveBeenCalled()
		}
	)
	it('renders confirmed local emptiness separately from missing observations', () => {
		expect(view([])).toEqual({ kind: 'empty' })
	})
	it('allows explicit selection of a sole unselected workspace', () => {
		expect(view([first])).toMatchObject({ kind: 'choices', selectedId: '', canChoose: true })
	})
	it('does not imply a useful switch when the sole workspace is already selected', () => {
		expect(view([first], first.id)).toMatchObject({
			kind: 'choices',
			selectedId: first.id,
			canChoose: false
		})
	})
	it('does not display an inaccessible or stale requested ID as selected', () => {
		expect(view([first], 'missing')).toMatchObject({
			kind: 'choices',
			selectedId: '',
			canChoose: true
		})
	})
	it('keeps multiple local choices operable with a selected workspace', () => {
		expect(view([first, second], first.id)).toMatchObject({
			kind: 'choices',
			selectedId: first.id,
			canChoose: true
		})
	})
	it.each([[first], [first, second]])('honors an explicit interaction block', (...entries) => {
		expect(view(entries, null, true)).toMatchObject({ kind: 'choices', canChoose: false })
	})
	it('disambiguates only repeated names and preserves directory order and identity', () => {
		const entries = [first, { ...second, name: first.name }, { id: 'third', name: 'Other' }]
		const original = structuredClone(entries)
		const format = vi.fn(duplicateName)
		expect(
			createWorkspaceSelectorView({
				directory: { status: 'available', entries },
				workspaceId: second.id,
				duplicateName: format
			})
		).toMatchObject({
			entries: [
				{ id: first.id, label: 'Personal [first]' },
				{ id: second.id, label: 'Personal [second]' },
				{ id: 'third', label: 'Other' }
			],
			selectedId: second.id
		})
		expect(format).toHaveBeenCalledTimes(2)
		expect(entries).toEqual(original)
	})
	it('updates duplicate-name wording without changing directory or selection', () => {
		const input = {
			directory: { status: 'available', entries: [first, { ...second, name: first.name }] },
			workspaceId: second.id
		} satisfies { directory: WorkspaceDirectory; workspaceId: string }
		const before = createWorkspaceSelectorView({ ...input, duplicateName })
		const after = createWorkspaceSelectorView({
			...input,
			duplicateName: (name, id) => `${id} — ${name}`
		})
		expect(before).toMatchObject({
			entries: [{ label: 'Personal [first]' }, { label: 'Personal [second]' }]
		})
		expect(after).toMatchObject({
			entries: [{ label: 'first — Personal' }, { label: 'second — Personal' }],
			selectedId: second.id
		})
	})
})

describe('workspace selector server rendering', () => {
	const messages = {
		label: 'Workspace',
		placeholder: 'Select workspace',
		empty: 'No workspaces yet'
	}
	it('renders native names and caller attributes without invoking selection', () => {
		const onSelect = vi.fn()
		const { body } = render(WorkspaceSelector, {
			props: {
				view: view([first]),
				messages,
				onSelect,
				id: 'workspace-field',
				name: 'workspace',
				required: true
			}
		})
		expect(body).toContain('for="workspace-field"')
		expect(body).toContain('id="workspace-field"')
		expect(body).toContain('name="workspace"')
		expect(body).toContain('value="first"')
		expect(body).toContain('Personal')
		expect(onSelect).not.toHaveBeenCalled()
	})
	it('associates the confirmed empty explanation while preserving caller descriptions', () => {
		const { body } = render(WorkspaceSelector, {
			props: { view: view([]), messages, onSelect: () => {}, 'aria-describedby': 'caller-hint' }
		})
		const description = body.match(/aria-describedby="caller-hint ([^"]+)"/)?.[1]
		expect(description).toBeTruthy()
		expect(body).toContain(`id="${description}"`)
		expect(body).toContain(messages.empty)
	})
	it('keeps supplied localization isolated between server requests', () => {
		const props = { view: view([]), onSelect: () => {} }
		const firstRender = render(WorkspaceSelector, { props: { ...props, messages } }).body
		const secondRender = render(WorkspaceSelector, {
			props: {
				...props,
				messages: { label: 'Espace', placeholder: 'Choisir', empty: 'Aucun espace' }
			}
		}).body
		expect(firstRender).toContain('No workspaces yet')
		expect(firstRender).not.toContain('Aucun espace')
		expect(secondRender).toContain('Aucun espace')
		expect(secondRender).not.toContain('No workspaces yet')
	})
})
