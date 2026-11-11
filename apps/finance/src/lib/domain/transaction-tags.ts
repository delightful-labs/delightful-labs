/** Preserve link order and display each non-empty tag name once per transaction. */
export function transactionTagNames(
	tags: readonly { id: string; name: string }[],
	links: readonly { transactionId: string; tagId: string }[]
): ReadonlyMap<string, readonly string[]> {
	const names = new Map(tags.map((tag) => [tag.id, tag.name]))
	const grouped = new Map<string, Set<string>>()
	for (const link of links) {
		const name = names.get(link.tagId)
		if (!name) continue
		const transactionNames = grouped.get(link.transactionId) ?? new Set<string>()
		transactionNames.add(name)
		grouped.set(link.transactionId, transactionNames)
	}
	return new Map([...grouped].map(([id, transactionNames]) => [id, [...transactionNames]]))
}
