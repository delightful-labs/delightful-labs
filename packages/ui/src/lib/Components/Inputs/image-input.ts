import type { Snippet } from 'svelte'
import type { HTMLInputAttributes } from 'svelte/elements'

export type ImageInputProps = Omit<
	HTMLInputAttributes,
	| 'multiple'
	| 'type'
	| 'value'
	| 'files'
	| 'defaultValue'
	| 'defaultvalue'
	| 'children'
	| 'readonly'
> & {
	/** Close the preview before opening a consumer-owned editor. */
	imageActions?: Snippet<[File, () => void]>
	label: string
	uploadLabel?: string
	removeLabel?: string
	closeLabel?: string
	infoLabel?: string
	shape?: 'square' | 'circle'
	imageState?: (file: File) => {
		status: 'ready' | 'uploading' | 'error'
		label?: string
	}
}
