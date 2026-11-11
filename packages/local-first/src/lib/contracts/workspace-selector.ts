/** A directory display model is never authorization evidence or a usable workspace lease. */
export type WorkspaceSelectorView =
	| Readonly<{ kind: 'unavailable' | 'empty' }>
	| Readonly<{
			kind: 'choices'
			entries: readonly Readonly<{ id: string; label: string }>[]
			selectedId: string
			canChoose: boolean
	  }>

/** Complete text supplied from the consumer's Paraglide messages, without a global locale. */
export type WorkspaceSelectorMessages = Readonly<{
	label: string
	placeholder: string
	empty: string
}>
