import { createActor, createAsyncLogic, setup, toPromise, types } from 'xstate'
import type { Db } from 'jazz-tools'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from '../../backend/jazz/jazz.generated.js'
import { newDocumentValues } from '../../backend/jazz/document-values.js'

type Input = {
	fixture: PolicyTestApp
	name: string
	publishingDid: string
	noteText: string
	withHighlight: boolean
}
type Prepared = {
	db: Db
	libraryId: string
	documentId: string
	highlightId: string
	noteId: string
}
type WriteInput = { backend: Db; prepared: Prepared }
type Context = Input & {
	prepared: Prepared | undefined
	backend: Db | undefined
	error: unknown
}
type Owner = Prepared & {
	backend: Db
	scope: { libraryId: string; accountId: string; publishingDid: string; isCurrent: () => boolean }
}

const actors = {
	prepare: createAsyncLogic({
		run: async ({ input }: { input: Input }): Promise<Prepared> => {
			const session = {
				user_id: input.name,
				authMode: 'device-account',
				claims: {}
			} satisfies PolicyTestSession
			const libraryId = input.fixture.accountFor(session)
			return {
				db: input.fixture.as(session),
				libraryId,
				documentId: crypto.randomUUID(),
				highlightId: crypto.randomUUID(),
				noteId: crypto.randomUUID()
			}
		}
	}),
	seedLibrary: createAsyncLogic({
		run: ({ input }: { input: { fixture: PolicyTestApp; prepared: Prepared } }) =>
			input.fixture.seed<Db>((server) => {
				const write = server.upsert(app.libraries, input.prepared.libraryId, {
					ownerId: input.prepared.libraryId,
					bootstrapVersion: '1'
				})
				return {
					value: server,
					wait: async (options) => {
						await write.wait(options)
						return server
					}
				}
			})
	}),
	createDocument: createAsyncLogic({
		run: ({ input: { backend, prepared } }: { input: WriteInput }) =>
			backend
				.insert(
					app.libraryDocuments,
					newDocumentValues(prepared.documentId, prepared.libraryId, 'https://example.org/article'),
					{ id: prepared.documentId }
				)
				.wait({ tier: 'global' })
	}),
	createHighlight: createAsyncLogic({
		run: ({ input: { backend, prepared } }: { input: WriteInput }) =>
			backend
				.insert(
					app.highlights,
					{
						libraryId: prepared.libraryId,
						documentId: prepared.documentId,
						source: 'https://example.org/article'
					},
					{ id: prepared.highlightId }
				)
				.wait({ tier: 'global' })
	}),
	createNote: createAsyncLogic({
		run: ({ input: { backend, prepared, text } }: { input: WriteInput & { text: string } }) =>
			backend
				.insert(
					app.notes,
					{
						libraryId: prepared.libraryId,
						documentId: prepared.documentId,
						highlightId: null,
						source: 'https://example.org/article',
						text
					},
					{ id: prepared.noteId }
				)
				.wait({ tier: 'global' })
	})
}

/** The suite's PolicyTestApp owns native clients, outstanding receipt settlement
 * and teardown. This finite chart owns setup order; failed writes never admit the
 * next stage. Accepted fixture rows are disposed by suite shutdown, not rolled back. */
export const publicationOwnerFixture = setup({
	schemas: {
		input: types<Input>(),
		context: types<Context>(),
		output: types<Owner>()
	},
	actors,
	states: {
		preparing: {},
		seedingLibrary: { schemas: { context: types<{ prepared: Prepared }>() } },
		creatingDocument: { schemas: { context: types<WriteInput>() } },
		creatingHighlight: { schemas: { context: types<WriteInput>() } },
		creatingNote: { schemas: { context: types<WriteInput>() } },
		ready: { schemas: { context: types<WriteInput>() } },
		failed: {}
	}
}).createMachine({
	id: 'publication-owner-fixture',
	initial: 'preparing',
	context: ({ input }) => ({ ...input, prepared: undefined, backend: undefined, error: undefined }),
	states: {
		preparing: {
			invoke: {
				src: 'prepare',
				input: ({ context }) => context,
				onDone: ({ event }) => ({ target: 'seedingLibrary', context: { prepared: event.output } }),
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		seedingLibrary: {
			invoke: {
				src: 'seedLibrary',
				input: ({ context }) => ({ fixture: context.fixture, prepared: context.prepared }),
				onDone: ({ event }) => ({ target: 'creatingDocument', context: { backend: event.output } }),
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		creatingDocument: {
			invoke: {
				src: 'createDocument',
				input: ({ context }) => ({ backend: context.backend, prepared: context.prepared }),
				onDone: ({ context }) =>
					context.withHighlight ? { target: 'creatingHighlight' } : { target: 'creatingNote' },
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		creatingHighlight: {
			invoke: {
				src: 'createHighlight',
				input: ({ context }) => ({ backend: context.backend, prepared: context.prepared }),
				onDone: { target: 'creatingNote' },
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		creatingNote: {
			invoke: {
				src: 'createNote',
				input: ({ context }) => ({
					backend: context.backend,
					prepared: context.prepared,
					text: context.noteText
				}),
				onDone: { target: 'ready' },
				onError: ({ event }) => ({ target: 'failed', context: { error: event.error } })
			}
		},
		ready: {
			type: 'final',
			output: ({ context }) => ({
				...context.prepared,
				backend: context.backend,
				scope: {
					libraryId: context.prepared.libraryId,
					accountId: context.prepared.libraryId,
					publishingDid: context.publishingDid,
					isCurrent: () => true
				}
			})
		},
		failed: {
			type: 'final',
			output: ({ context }) => {
				throw context.error
			}
		}
	}
})

/** Test-host boundary: subscribe before starting, propagate setup failure and
 * release the finite root after settlement. No setup workflow lives in this bridge. */
export function createPublicationOwner(input: Input) {
	const actor = createActor(publicationOwnerFixture, { input })
	const result = toPromise(actor)
	actor.start()
	return result.finally(() => actor.stop())
}
