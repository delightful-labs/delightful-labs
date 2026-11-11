import { describe, expect, it } from 'vitest'
import { observeRow, observeRows } from './observations.js'
describe('subscription observation snapshots', () => {
	it('reads row fields and isolates a revision from in-place row/array deltas', () => {
		const member = { id: 'membership', role: 'owner' }
		const rows = [{ id: 'one', archivedAt: null }]
		const oldMember = observeRow(member)
		const oldRows = observeRows(rows)
		member.role = 'viewer'
		rows.push({ id: 'two', archivedAt: null })
		rows[0]!.id = 'changed'
		expect(oldMember?.role).toBe('owner')
		expect(oldRows).toEqual([{ id: 'one', archivedAt: null }])
		expect(observeRow(member)?.role).toBe('viewer')
		expect(observeRows(rows)).toHaveLength(2)
	})
	it('preserves absent row/loading distinctions and opaque resource identities', () => {
		expect(observeRow(null)).toBeNull()
		expect(observeRow(undefined)).toBeUndefined()
		expect(observeRows(undefined)).toEqual([])
		const resource = {}
		expect(observeRow({ resource })?.resource).toBe(resource)
	})
})
