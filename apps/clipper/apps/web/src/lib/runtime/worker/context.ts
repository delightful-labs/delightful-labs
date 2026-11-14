import { createContext } from 'svelte'
import type { LibraryClient } from './client.js'
export type WorkerLibraryContext = { readonly actor: LibraryClient | undefined }
export const [useWorkerLibrary, provideWorkerLibrary] = createContext<WorkerLibraryContext>()
