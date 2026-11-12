import { types, setup, createCallbackLogic, matchesState } from 'xstate'
import type { CaptureDocument, LibraryArticle } from '../../contracts/articles.js'
import type { OrganizationOperation } from '../../capture/organization.js'
import type { TagOperation } from '../../capture/tags.js'
import { projectLibraryArticles } from '../../capture/library-articles.js'
import { projectOrganization } from '../../capture/organization.js'
import { projectTags } from '../../capture/tags.js'
import { createArticleTargetLookup } from '../../capture/causal.js'
type Subscribe<T> = (next: (rows: T[]) => void, error: () => void) => () => void
type Input = { next: (rows: LibraryArticle[]) => void; error: () => void }
type Capability = {
	isCurrent: () => boolean
	articles: Subscribe<CaptureDocument>
	organization?: Subscribe<OrganizationOperation>
	tags?: Subscribe<TagOperation>
}
type Context = {
	articles: CaptureDocument[]
	organization: OrganizationOperation[]
	tags: TagOperation[]
	callbacks: Input | undefined
}
const subscription = createCallbackLogic(() => {})
const output = createCallbackLogic<
	{ type: 'ROWS'; rows: LibraryArticle[] } | { type: 'ERROR' },
	Input
>(({ input, receive }) => {
	receive((event) => {
		if (event.type === 'ROWS') input.next(event.rows)
		else input.error()
	})
})
function emptySubscription<T>(next: (rows: T[]) => void, _error: () => void) {
	next([])
	return () => {}
}
const model = setup({
	schemas: {
		context: types<Context>(),
		input: types<Input>(),
		events: {
			ARTICLES: types<{ rows: CaptureDocument[] }>(),
			ORGANIZATION: types<{ rows: OrganizationOperation[] }>(),
			TAGS: types<{ rows: TagOperation[] }>(),
			ERROR: types<{}>(),
			STOP: types<{}>()
		},
		internalEvents: { UPDATED: types<{}>() },
		children: {
			articles: types<import('xstate').ActorRefFrom<typeof subscription>>(),
			organization: types<import('xstate').ActorRefFrom<typeof subscription>>(),
			tags: types<import('xstate').ActorRefFrom<typeof subscription>>(),
			output: types<import('xstate').ActorRefFrom<typeof output>>()
		}
	},
	actors: { articles: subscription, organization: subscription, tags: subscription, output },
	guards: { current: (): boolean => false }
}).createMachine({
	id: 'article-collection',
	initial: 'observing',
	context: ({ input }) => ({ articles: [], organization: [], tags: [], callbacks: input }),
	invoke: {
		id: 'output',
		src: 'output',
		input: ({ context }) => {
			if (!context.callbacks) throw new Error('Missing callbacks')
			return context.callbacks
		}
	},
	states: {
		observing: {
			type: 'parallel',
			invoke: [
				{ id: 'articles', src: 'articles', onError: { target: 'failed' } },
				{ id: 'organization', src: 'organization', onError: { target: 'failed' } },
				{ id: 'tags', src: 'tags', onError: { target: 'failed' } }
			],
			on: { ERROR: { target: 'failed' }, STOP: { target: 'closed' } },
			states: {
				articles: {
					initial: 'pending',
					states: {
						pending: {
							on: { ARTICLES: (args) => (args.guards.current() ? { target: 'ready' } : undefined) }
						},
						ready: {}
					}
				},
				organization: {
					initial: 'pending',
					states: {
						pending: {
							on: {
								ORGANIZATION: (args) => (args.guards.current() ? { target: 'ready' } : undefined)
							}
						},
						ready: {}
					}
				},
				tags: {
					initial: 'pending',
					states: {
						pending: {
							on: { TAGS: (args) => (args.guards.current() ? { target: 'ready' } : undefined) }
						},
						ready: {}
					}
				},
				data: {
					on: {
						ARTICLES: (args, enq) => {
							if (!args.guards.current()) return
							enq.raise({ type: 'UPDATED' })
							return { context: { articles: args.event.rows } }
						},
						ORGANIZATION: (args, enq) => {
							if (!args.guards.current()) return
							enq.raise({ type: 'UPDATED' })
							return { context: { organization: args.event.rows } }
						},
						TAGS: (args, enq) => {
							if (!args.guards.current()) return
							enq.raise({ type: 'UPDATED' })
							return { context: { tags: args.event.rows } }
						}
					}
				},
				publication: {
					initial: 'idle',
					states: {
						idle: {
							on: {
								UPDATED: (args) => {
									if (
										!matchesState({ observing: { articles: 'ready' } }, args.value) ||
										!matchesState({ observing: { organization: 'ready' } }, args.value) ||
										!matchesState({ observing: { tags: 'ready' } }, args.value)
									)
										return
									return { target: 'coalescing' }
								}
							}
						},
						coalescing: {
							after: {
								0: (args, enq) => {
									if (args.guards.current()) {
										const { context } = args
										const targets = createArticleTargetLookup(context.articles)
										const rows = projectLibraryArticles(context.articles)
										const organized = projectOrganization(
											rows,
											context.organization,
											context.articles,
											targets
										)
										enq.sendTo('output', {
											type: 'ROWS',
											rows: projectTags(organized, context.tags, context.articles, targets)
										})
									}
									return { target: 'idle' }
								}
							}
						}
					}
				}
			}
		},
		failed: {
			type: 'final',
			entry: (args, enq) => {
				if (args.guards.current()) enq.sendTo('output', { type: 'ERROR' })
				return { context: { articles: [], organization: [], tags: [], callbacks: undefined } }
			}
		},
		closed: {
			type: 'final',
			entry: () => ({ context: { articles: [], organization: [], tags: [], callbacks: undefined } })
		}
	}
})
export function createArticleCollectionMachine(cap: Capability) {
	return model.provide({
		guards: { current: cap.isCurrent },
		actors: {
			articles: createCallbackLogic(({ sendBack }) =>
				cap.articles(
					(rows) => sendBack({ type: 'ARTICLES', rows }),
					() => sendBack({ type: 'ERROR' })
				)
			),
			organization: createCallbackLogic(({ sendBack }) =>
				(cap.organization ?? emptySubscription<OrganizationOperation>)(
					(rows) => sendBack({ type: 'ORGANIZATION', rows }),
					() => sendBack({ type: 'ERROR' })
				)
			),
			tags: createCallbackLogic(({ sendBack }) =>
				(cap.tags ?? emptySubscription<TagOperation>)(
					(rows) => sendBack({ type: 'TAGS', rows }),
					() => sendBack({ type: 'ERROR' })
				)
			)
		}
	})
}
