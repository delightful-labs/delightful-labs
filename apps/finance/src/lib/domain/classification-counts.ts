/** Counts use all readable history, independent of sidebar selection and archive filters. */
export function classificationCounts(
	categories: readonly { id: string }[],
	transactions: readonly { categoryId: string }[],
	tags: readonly { categoryId: string | null }[]
) {
	const counts = new Map<string, { transactions: number; tags: number }>(
		categories.map((category) => [category.id, { transactions: 0, tags: 0 }])
	)
	for (const transaction of transactions) {
		const count = counts.get(transaction.categoryId)
		if (count) count.transactions += 1
	}
	for (const tag of tags) {
		const count = tag.categoryId ? counts.get(tag.categoryId) : undefined
		if (count) count.tags += 1
	}
	return counts
}
