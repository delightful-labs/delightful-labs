import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { ComponentProps } from 'svelte'
import WorkspaceSelector from './WorkspaceSelector.svelte'
import { m } from '#lib/paraglide/messages.js'

const id = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const entry = { id, name: 'Personal' }
function html(
	organizations: ComponentProps<typeof WorkspaceSelector>['organizations'],
	organizationId: string | null = null,
	label?: string
) {
	const onchange = vi.fn()
	const result = render(WorkspaceSelector, {
		props: { organizations, organizationId, onchange, ...(label === undefined ? {} : { label }) }
	})
	return { body: result.body, onchange }
}
describe('Finance shared workspace selector adapter', () => {
	it('preserves unknown local data without announcing an empty directory or issuing intent', () => {
		const { body, onchange } = html(undefined)
		expect(body).not.toContain(m['workspace.empty']())
		expect(body).toMatch(/<select\b[^>]*\sdisabled(?:\s|>|=)/)
		expect(onchange).not.toHaveBeenCalled()
	})
	it('renders the existing localized empty explanation for a confirmed empty list', () => {
		const { body } = html([])
		expect(body).toContain(m['workspace.empty']())
		expect(body).toMatch(/<select\b[^>]*\sdisabled(?:\s|>|=)/)
	})
	it('keeps a sole unselected workspace operable without selecting it during rendering', () => {
		const { body, onchange } = html([entry])
		expect(body).not.toMatch(/<select\b[^>]*\sdisabled(?:\s|>|=)/)
		expect(body).toContain(`value="${id}"`)
		expect(onchange).not.toHaveBeenCalled()
	})
	it('disables switching when the sole workspace is already selected', () => {
		const { body } = html([entry], id)
		expect(body).toMatch(/<select\b[^>]*\sdisabled(?:\s|>|=)/)
	})
	it('preserves the host label and Finance duplicate-name format', () => {
		const { body } = html([entry, { id: otherId, name: entry.name }], id, 'Choose ledger')
		expect(body).toContain('Choose ledger')
		expect(body).toContain(`Personal · ${id}`)
		expect(body).toContain(`Personal · ${otherId}`)
		expect(body).not.toMatch(/<select\b[^>]*\sdisabled(?:\s|>|=)/)
	})
})
