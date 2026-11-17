import { createAsyncLogic, createCallbackLogic, setup, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { connectivityEvents } from '../offline/connectivity.js'
import { publicationBaseSchema, publicationSchema } from './publication.js'
import type { Publication } from './publication.js'
import type { PublicationCleanupCapability } from '../backend/jazz/publication-cleanup.js'

type Context = {
	capability: PublicationCleanupCapability | undefined
	publications: Publication[]
	deletedNoteIds: string[]
	deletedHighlightIds: string[]
	completed: string[]
}
function key(value: Publication) {
	return JSON.stringify(
		publicationBaseSchema.parse({
			libraryId: value.libraryId,
			source: value.source,
			publishingDid: value.publishingDid
		})
	)
}
function candidates(context: Context) {
	return context.publications.filter(
		(value) =>
			('noteId' in value.source
				? context.deletedNoteIds.includes(value.source.noteId)
				: context.deletedHighlightIds.includes(value.source.highlightId)) &&
			(value.state === 'published' || value.state === 'issued' || value.state === 'unpublishing')
	)
}
function observations(
	context: Context,
	patch: { publications?: Publication[]; deletedNoteIds?: string[]; deletedHighlightIds?: string[] }
) {
	const facts = { ...context, ...patch }
	return {
		...patch,
		completed: context.completed.filter((done) =>
			candidates(facts).some((value) => key(value) === done)
		)
	}
}
const observe = createCallbackLogic<
	| { type: 'PUBLICATIONS'; values: Publication[] }
	| { type: 'DELETIONS'; ids: string[] }
	| { type: 'HIGHLIGHT_DELETIONS'; ids: string[] }
	| { type: 'FAILED' },
	PublicationCleanupCapability
>(({ input, sendBack }) => {
	try {
		return input.observe(
			(values) => sendBack({ type: 'PUBLICATIONS', values }),
			(ids) => sendBack({ type: 'DELETIONS', ids }),
			() => sendBack({ type: 'FAILED' }),
			(ids) => sendBack({ type: 'HIGHLIGHT_DELETIONS', ids })
		)
	} catch {
		sendBack({ type: 'FAILED' })
		return
	}
})
const connectivity = createCallbackLogic<{ type: 'ONLINE' }>(({ sendBack }) => {
	const events = connectivityEvents()
	const online = () => sendBack({ type: 'ONLINE' })
	events.addEventListener('online', online)
	return () => events.removeEventListener('online', online)
})
const remove = createAsyncLogic({
	run: async ({ input, signal }: { input: Publication; signal: AbortSignal }) => {
		const response = await fetch('/api/publication/cleanup', {
			method: 'POST',
			credentials: 'same-origin',
			cache: 'no-store',
			redirect: 'error',
			signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(
				publicationBaseSchema.parse({
					libraryId: input.libraryId,
					source: input.source,
					publishingDid: input.publishingDid
				})
			)
		})
		if (!response.ok) {
			void response.body?.cancel().catch(() => {})
			return undefined
		}
		const value: unknown = await response.json()
		signal.throwIfAborted()
		return publicationSchema.parse(value)
	}
})
/** Library lifetime, one deletion at a time. The queue is a native projection,
 * never a journal. A failed request retries later; stopping aborts HTTP, while
 * retained server-side URI/CID evidence owns any uncertain remote outcome. */
export const publicationCleanupMachine = setup({
	schemas: {
		input: types<{ capability: PublicationCleanupCapability | undefined }>(),
		context: types<Context>(),
		events: {
			PUBLICATIONS: types<{ values: Publication[] }>(),
			DELETIONS: types<{ ids: string[] }>(),
			HIGHLIGHT_DELETIONS: types<{ ids: string[] }>(),
			FAILED: types(),
			ONLINE: types(),
			SHUTDOWN: types()
		},
		children: {
			observe: types<ActorRefFrom<typeof observe>>(),
			remove: types<ActorRefFrom<typeof remove>>(),
			connectivity: types<ActorRefFrom<typeof connectivity>>()
		}
	},
	actors: { observe, remove, connectivity },
	states: {
		admitting: {},
		active: {
			id: 'publication-cleanup-active',
			schemas: { context: types<{ capability: PublicationCleanupCapability }>() },
			states: {
				choosing: {},
				idle: {},
				removing: { schemas: { context: types<{ selected: Publication }>() } },
				waiting: {}
			}
		},
		stopped: { id: 'publication-cleanup-stopped' }
	}
}).createMachine({
	id: 'publication-cleanup',
	initial: 'admitting',
	context: ({ input }) => ({
		...input,
		publications: [],
		deletedNoteIds: [],
		deletedHighlightIds: [],
		completed: []
	}),
	on: {
		SHUTDOWN: {
			target: '.stopped',
			context: {
				capability: undefined,
				publications: [],
				deletedNoteIds: [],
				deletedHighlightIds: [],
				completed: []
			}
		}
	},
	states: {
		admitting: {
			type: 'choice',
			choice: ({ context }) =>
				context.capability?.isCurrent()
					? { target: 'active', context: { capability: context.capability } }
					: { target: 'stopped' }
		},
		active: {
			id: 'publication-cleanup-active',
			initial: 'choosing',
			invoke: [
				{ id: 'connectivity', src: 'connectivity', onError: { target: '.waiting' } },
				{
					id: 'observe',
					src: 'observe',
					input: ({ context }) => context.capability,
					onError: { target: '.waiting' }
				}
			],
			on: {
				PUBLICATIONS: ({ context, event }) =>
					context.capability.isCurrent()
						? {
								context: observations(context, {
									publications: event.values.filter(
										(value) => value.libraryId === context.capability.libraryId
									)
								})
							}
						: { target: 'stopped' },
				DELETIONS: ({ context, event }) =>
					context.capability.isCurrent()
						? { context: observations(context, { deletedNoteIds: event.ids }) }
						: { target: 'stopped' },
				HIGHLIGHT_DELETIONS: ({ context, event }) =>
					context.capability.isCurrent()
						? { context: observations(context, { deletedHighlightIds: event.ids }) }
						: { target: 'stopped' },
				FAILED: { target: '.waiting' }
			},
			states: {
				choosing: {
					type: 'choice',
					choice: ({ context }) => {
						const publication = candidates(context).find(
							(value) => !context.completed.includes(key(value))
						)
						return publication && context.capability.isCurrent()
							? { target: 'removing', context: { selected: publication } }
							: { target: 'idle' }
					}
				},
				idle: {
					on: {
						ONLINE: { target: 'choosing', context: { completed: [] } },
						PUBLICATIONS: ({ context, event }) =>
							context.capability.isCurrent()
								? {
										target: 'choosing',
										context: observations(context, {
											publications: event.values.filter(
												(value) => value.libraryId === context.capability.libraryId
											)
										})
									}
								: { target: '#publication-cleanup-stopped' },
						HIGHLIGHT_DELETIONS: ({ context, event }) =>
							context.capability.isCurrent()
								? {
										target: 'choosing',
										context: observations(context, { deletedHighlightIds: event.ids })
									}
								: { target: '#publication-cleanup-stopped' },
						DELETIONS: ({ context, event }) =>
							context.capability.isCurrent()
								? {
										target: 'choosing',
										context: observations(context, { deletedNoteIds: event.ids })
									}
								: { target: '#publication-cleanup-stopped' }
					}
				},
				removing: {
					invoke: {
						id: 'remove',
						src: 'remove',
						input: ({ context }) => context.selected,
						timeout: 125_000,
						onTimeout: { target: 'waiting' },
						onError: { target: 'waiting' },
						onDone: ({ context, event }) => {
							const value = event.output
							return value?.state === 'unpublished' &&
								key(value) === key(context.selected) &&
								context.capability.isCurrent()
								? { target: 'choosing', context: { completed: [...context.completed, key(value)] } }
								: { target: 'waiting' }
						}
					}
				},
				waiting: {
					timeout: 30_000,
					onTimeout: {
						target: '#publication-cleanup-active',
						reenter: true,
						context: { completed: [] }
					},
					on: {
						FAILED: {},
						ONLINE: {
							target: '#publication-cleanup-active',
							reenter: true,
							context: { completed: [] }
						}
					}
				}
			}
		},
		stopped: { id: 'publication-cleanup-stopped', type: 'final' }
	}
})
