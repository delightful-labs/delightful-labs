/** Native DOM measurement only. Normalization, range capture/resolution and
 * eligibility are worker-owned. Image controls are not part of reader text. */
function textNodes(root: Node) {
	const document = root.ownerDocument
	if (!document) return []
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	const nodes: Text[] = []
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node instanceof Text && !node.parentElement?.closest('[data-reader-image]'))
			nodes.push(node)
	}
	return nodes
}
export function measureReaderText(root: Node) {
	return textNodes(root)
		.map((node) => node.data)
		.join('')
}
export function measureSelection(root: HTMLElement) {
	const selection = root.ownerDocument.getSelection()
	if (!selection?.rangeCount || selection.isCollapsed) return undefined
	const selected = selection.getRangeAt(0)
	if (!root.contains(selected.startContainer) || !root.contains(selected.endContainer))
		return undefined
	const prefix = root.ownerDocument.createRange()
	prefix.selectNodeContents(root)
	prefix.setEnd(selected.startContainer, selected.startOffset)
	const start = measureReaderText(prefix.cloneContents()).length
	prefix.setEnd(selected.endContainer, selected.endOffset)
	const end = measureReaderText(prefix.cloneContents()).length
	return { text: measureReaderText(root), start, end }
}
export function renderHighlights(
	root: HTMLElement,
	spans: { start: number; end: number }[],
	name: string
) {
	const registry = typeof CSS === 'undefined' ? undefined : CSS.highlights
	if (!registry || typeof Highlight === 'undefined') return () => {}
	const nodes = textNodes(root)
	function endpoint(offset: number) {
		let remaining = offset
		for (const node of nodes) {
			if (remaining <= node.length) return { node, offset: remaining }
			remaining -= node.length
		}
		return undefined
	}
	const ranges = spans.flatMap((span) => {
		const start = endpoint(span.start),
			end = endpoint(span.end)
		if (!start || !end) return []
		const range = root.ownerDocument.createRange()
		range.setStart(start.node, start.offset)
		range.setEnd(end.node, end.offset)
		return [range]
	})
	registry.set(name, new Highlight(...ranges))
	return () => registry.delete(name)
}
