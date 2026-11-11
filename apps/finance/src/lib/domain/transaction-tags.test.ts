import { describe, expect, it } from 'vitest'
import { transactionTagNames } from './transaction-tags.js'

describe('transaction tag labels', () => {
	it('omits empty results and links with missing or empty names', () => {
		expect([...transactionTagNames([], [])]).toEqual([])
		expect([
			...transactionTagNames(
				[{ id: 'empty', name: '' }],
				[
					{ transactionId: 'one', tagId: 'missing' },
					{ transactionId: 'one', tagId: 'empty' }
				]
			)
		]).toEqual([])
	})

	it('deduplicates labels in link order independently for each transaction', () => {
		const tags = [
			{ id: 'a', name: 'Alpha' },
			{ id: 'b', name: 'Beta' },
			{ id: 'c', name: 'Alpha' },
			{ id: 'archived', name: 'Historical', archivedAt: new Date() }
		]
		const links = [
			{ transactionId: 'one', tagId: 'b' },
			{ transactionId: 'one', tagId: 'a' },
			{ transactionId: 'two', tagId: 'a' },
			{ transactionId: 'one', tagId: 'b' },
			{ transactionId: 'one', tagId: 'c' },
			{ transactionId: 'one', tagId: 'archived' }
		]
		expect([...transactionTagNames(tags, links)]).toEqual([
			['one', ['Beta', 'Alpha', 'Historical']],
			['two', ['Alpha']]
		])
		expect(links.map((link) => link.tagId)).toEqual(['b', 'a', 'a', 'b', 'c', 'archived'])
	})

	it('uses current names without retaining labels from earlier observations', () => {
		const links = [{ transactionId: 'one', tagId: 'a' }]
		expect(transactionTagNames([{ id: 'a', name: 'Original' }], links).get('one')).toEqual([
			'Original'
		])
		expect(transactionTagNames([{ id: 'a', name: 'Renamed' }], links).get('one')).toEqual([
			'Renamed'
		])
		expect(transactionTagNames([], links).has('one')).toBe(false)
	})
})
