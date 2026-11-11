import { createContext, type Snippet } from 'svelte'

export const [getPageNavigation, setPageNavigation] = createContext<Snippet>()
