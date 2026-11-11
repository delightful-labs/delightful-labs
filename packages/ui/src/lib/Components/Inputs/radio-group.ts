import { createContext } from 'svelte'
import type { HTMLFieldsetAttributes } from 'svelte/elements'

export type RadioChangeEvent = Event & { currentTarget: HTMLInputElement }

type RadioGroupContext = {
	readonly name: string
	readonly value: string | undefined
	readonly defaultValue: string | undefined
	readonly required: boolean
	readonly disabled: boolean
	readonly form: HTMLFieldsetAttributes['form']
	change: (event: RadioChangeEvent) => void
}

export const [getRadioGroup, setRadioGroup] = createContext<RadioGroupContext>()
