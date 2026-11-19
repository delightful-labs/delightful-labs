import { setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import { noteDraftMachine, selectNoteDraftState } from '../notes/draft-machine.js'
import { noteDraftRecordSchema } from '../notes/schema.js'
import type { NoteDraftRecord } from '../notes/schema.js'
import type { AnnotationCapability } from '../backend/jazz/annotations.js'

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Draft recovery unavailable')
	return value
}
type Input = { capability: AnnotationCapability | undefined }
type Target = { id: string; text: string }
type Context = Input & {
	documentId: string
	generation: number
	draft: ReturnType<typeof selectNoteDraftState>
	sequence: number
	targets: Target[]
	recovered: NoteDraftRecord[]
	latest: Record<string, NoteDraftRecord>
	removals: NoteDraftRecord[]
	inputError: string | undefined
}
const actors = {
	drafts: noteDraftMachine,
	targets: createAsyncLogic({
		run: ({ input }: { input: { capability: AnnotationCapability; documentId: string } }) =>
			input.capability.recoveryTargets(input.documentId)
	}),
	read: createAsyncLogic({
		run: async ({ input }: { input: { capability: AnnotationCapability; targets: Target[] } }) => {
			const recovery = required(input.capability.recovery)
			const results = await Promise.allSettled(
				input.targets.map((target) =>
					recovery.store.read({ libraryId: recovery.libraryId, noteId: target.id })
				)
			)
			const records: NoteDraftRecord[] = []
			for (const result of results) {
				if (result.status === 'rejected') throw result.reason
				records.push(...result.value)
			}
			return records.filter((record) =>
				input.targets.some(
					(target) => target.id === record.draft.noteId && target.text !== record.draft.text
				)
			)
		}
	}),
	remove: createAsyncLogic({
		run: async ({
			input
		}: {
			input: { capability: AnnotationCapability; records: NoteDraftRecord[] }
		}) => {
			const store = required(input.capability.recovery).store
			const results = await Promise.allSettled(input.records.map((record) => store.remove(record)))
			for (const result of results) if (result.status === 'rejected') throw result.reason
		}
	})
}
export const annotationRecoveryMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<Input>(),
		output: types<undefined>(),
		events: {
			OPEN: types<{ documentId: string; generation: number }>(),
			CLOSE: types(),
			RETAIN: types<{ noteId: string; text: string }>(),
			FORGET: types<{ noteId: string; writerId: string | undefined; text: string }>(),
			SHUTDOWN: types()
		},
		children: {
			drafts: types<import('xstate').ActorRefFrom<typeof actors.drafts>>(),
			targets: types<import('xstate').ActorRefFrom<typeof actors.targets>>(),
			read: types<import('xstate').ActorRefFrom<typeof actors.read>>(),
			remove: types<import('xstate').ActorRefFrom<typeof actors.remove>>()
		}
	},
	actors
}).createMachine({
	id: 'annotation-input-recovery',
	initial: 'checking',
	context: ({ input }) => ({
		...input,
		documentId: '',
		generation: 0,
		draft: selectNoteDraftState(undefined),
		sequence: 0,
		targets: [],
		recovered: [],
		latest: {},
		removals: [],
		inputError: undefined
	}),
	states: {
		checking: {
			type: 'choice',
			choice: ({ context }) =>
				context.capability?.recovery ? { target: 'active' } : { target: 'closed' }
		},
		active: {
			type: 'parallel',
			always: ({ context, value }) =>
				(!context.removals.length &&
					matchesState(
						{ active: { control: 'closing', drafts: 'closed', reading: 'idle', clearing: 'idle' } },
						value
					)) ||
				matchesState(
					{ active: { control: 'closing', drafts: 'closed', reading: 'idle', clearing: 'failed' } },
					value
				)
					? { target: 'closed' }
					: undefined,
			on: {
				RETAIN: ({ context, event }, enq) => {
					if (!context.capability?.isCurrent() || !context.capability.recovery) return
					const recovery = context.capability.recovery,
						sequence = context.sequence + 1
					const record: NoteDraftRecord = {
						writerId: recovery.writerId,
						draft: {
							libraryId: recovery.libraryId,
							noteId: event.noteId,
							sequence,
							text: event.text,
							baseRevisionIds: []
						}
					}
					if (!noteDraftRecordSchema.safeParse(record).success)
						return { context: { inputError: 'draft-limit' } }
					enq.sendTo('drafts', { type: 'EDIT', record })
					return {
						context: {
							sequence,
							inputError: undefined,
							latest: { ...context.latest, [event.noteId]: record }
						}
					}
				},
				FORGET: ({ context, event }) => {
					const candidate = context.latest[event.noteId]
					const current = candidate?.draft.text === event.text ? candidate : undefined
					const selected = context.recovered.filter(
						(record) => record.draft.noteId === event.noteId && record.writerId === event.writerId
					)
					const latest = { ...context.latest }
					if (current) delete latest[event.noteId]
					return {
						context: {
							latest,
							removals: [...context.removals, ...(current ? [current] : []), ...selected]
						}
					}
				}
			},
			states: {
				control: {
					initial: 'accepting',
					states: { accepting: { on: { SHUTDOWN: { target: 'closing' } } }, closing: {} }
				},
				drafts: {
					initial: 'running',
					invoke: {
						id: 'drafts',
						src: 'drafts',
						input: ({ context }) => ({
							store: required(context.capability?.recovery).store,
							libraryId: required(context.capability?.recovery).libraryId,
							isCurrent: required(context.capability).isCurrent
						}),
						onSnapshot: ({ event }) => ({
							context: { draft: selectNoteDraftState(event.snapshot) }
						}),
						onDone: ({ context, event }) => ({
							target: event.output.unsaved.length ? '.failed' : '.closed',
							context: {
								draft: {
									...context.draft,
									pending: event.output.unsaved.length > 0,
									failed: event.output.unsaved.length > 0
								}
							}
						}),
						onError: ({ context }) => ({
							target: '.failed',
							context: { draft: { ...context.draft, failed: true } }
						})
					},
					states: {
						running: {
							on: {
								SHUTDOWN: (_args, enq) => {
									enq.sendTo('drafts', { type: 'SHUTDOWN' })
								}
							}
						},
						closed: {},
						failed: {}
					}
				},
				reading: {
					initial: 'idle',
					on: {
						OPEN: ({ context, event, value }) =>
							context.capability?.isCurrent() &&
							matchesState({ active: { control: 'accepting' } }, value)
								? {
										target: '.targets',
										reenter: true,
										context: {
											documentId: event.documentId,
											generation: event.generation,
											recovered: []
										}
									}
								: undefined,
						CLOSE: { target: '.idle', context: { documentId: '', recovered: [] } }
					},
					states: {
						idle: {},
						targets: {
							invoke: {
								id: 'targets',
								src: 'targets',
								input: ({ context }) => ({
									capability: required(context.capability),
									documentId: context.documentId
								}),
								onDone: ({ event, value }) =>
									matchesState({ active: { control: 'closing' } }, value)
										? { target: 'idle' }
										: { target: 'reading', context: { targets: event.output } },
								onError: { target: 'failed' }
							}
						},
						reading: {
							invoke: {
								id: 'read',
								src: 'read',
								input: ({ context }) => ({
									capability: required(context.capability),
									targets: context.targets
								}),
								onDone: ({ event, value }) =>
									matchesState({ active: { control: 'closing' } }, value)
										? { target: 'idle' }
										: { target: 'ready', context: { recovered: event.output } },
								onError: { target: 'failed' }
							}
						},
						ready: { on: { SHUTDOWN: { target: 'idle' } } },
						failed: {
							always: ({ value }) =>
								matchesState({ active: { control: 'closing' } }, value)
									? { target: 'idle' }
									: undefined,
							on: { SHUTDOWN: { target: 'idle' } }
						}
					}
				},
				clearing: {
					initial: 'idle',
					states: {
						idle: {
							always: ({ context }) =>
								context.removals.length &&
								context.draft.sequence >= context.sequence &&
								!context.draft.pending
									? { target: 'removing' }
									: undefined
						},
						removing: {
							invoke: {
								id: 'remove',
								src: 'remove',
								input: ({ context }) => ({
									capability: required(context.capability),
									records: [required(context.removals[0])]
								}),
								onDone: ({ context }) => ({
									target: 'idle',
									context: {
										recovered: context.recovered.filter((record) => record !== context.removals[0]),
										removals: context.removals.slice(1)
									}
								}),
								onError: { target: 'failed' }
							}
						},
						failed: {}
					}
				}
			}
		},
		closed: { type: 'final' }
	}
})
export function selectAnnotationRecovery(
	snapshot: SnapshotFrom<typeof annotationRecoveryMachine> | undefined
) {
	const draft = snapshot?.context.draft ?? selectNoteDraftState(undefined)
	return {
		documentId: snapshot?.context.documentId ?? '',
		generation: snapshot?.context.generation ?? 0,
		records: snapshot?.context.recovered ?? [],
		pending:
			draft.pending ||
			(!!snapshot && draft.sequence < snapshot.context.sequence) ||
			snapshot?.matches({ active: { clearing: 'removing' } }) === true ||
			(!!snapshot?.context.removals.length &&
				!snapshot.matches({ active: { clearing: 'failed' } })),
		failed:
			!!snapshot?.context.inputError ||
			draft.failed ||
			snapshot?.matches({ active: { reading: 'failed' } }) === true,
		ready:
			!snapshot || snapshot.status === 'done' || snapshot.matches({ active: { reading: 'ready' } })
	}
}
