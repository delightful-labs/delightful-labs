import type { WorkflowMessage } from '../contracts/feedback.js'
import { createContext, type Snippet } from 'svelte'

export const [getAccountSettings, setAccountSettings] = createContext<{
	readonly controls: Snippet
	readonly connectionMessage: WorkflowMessage | undefined
	readonly accountMessage: WorkflowMessage | undefined
}>()
