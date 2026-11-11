import { takeBackupProtection, type BackupSubmission } from '../../backup/submission.js'
import { z } from 'zod'
import {
	prepareJazzArchiveExport,
	classifyJazzArchiveFailure,
	type JazzArchiveReaderInput,
	type JazzArchiveReaderResult,
	type JazzArchiveExportRequest,
	type JazzArchiveExportResult
} from 'delightful-local-first/backend/jazz/backup'
import { createJazzArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import {
	beginFinanceRead,
	clearFinanceRead,
	readFinanceAuthority,
	financeOwner,
	readFinanceMetadata,
	readFinanceRelations,
	readFinanceSources,
	readFinanceFiles,
	readFinanceParts,
	prepareFinanceFiles,
	hasFinanceFile,
	allocateFinanceFile,
	hasFinancePart,
	readFinancePart,
	hashFinanceFile,
	depositFinanceBackup,
	financeBackupProfile
} from '../../backup/workspace.js'
import { createCallbackLogic, setup, types, createAsyncLogic, matchesState } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type ReaderContext = { read: JazzArchiveReaderInput; result: JazzArchiveReaderResult }
const fileCompletion = (args: { context: ReaderContext }) => {
	const { context } = args
	if (hasFinanceFile(context.read)) {
		return { target: 'allocating' }
	}
	if (context.read.mode === 'capture') {
		return { target: 'depositing' }
	}
	return { target: 'ready' }
}
const partCompletion = (args: { context: ReaderContext }) => {
	if (hasFinancePart(args.context.read)) {
		return { target: 'readingPart', reenter: true }
	}
	return { target: 'hashing' }
}
const leaf = (run: (input: JazzArchiveReaderInput) => void | Promise<void>) =>
	createAsyncLogic<void, JazzArchiveReaderInput>({
		run: ({ input }) => Promise.resolve().then(() => run(input))
	})
const readerActors = {
	resources: createCallbackLogic<{ type: string }, JazzArchiveReaderInput>(({ input }) => {
		beginFinanceRead(input)
		const clear = () => clearFinanceRead(input)
		input.signal.addEventListener('abort', clear, { once: true })
		return () => {
			input.signal.removeEventListener('abort', clear)
			clear()
		}
	}),
	authority: leaf(readFinanceAuthority),
	metadata: leaf(readFinanceMetadata),
	relations: leaf((input) =>
		Promise.all([readFinanceRelations(input), readFinanceSources(input)]).then(() => {})
	),
	files: leaf(readFinanceFiles),
	parts: leaf(readFinanceParts),
	validate: leaf(prepareFinanceFiles),
	allocate: leaf(allocateFinanceFile),
	readPart: leaf(readFinancePart),
	hash: leaf(hashFinanceFile),
	deposit: leaf(depositFinanceBackup)
}
const patchFail = ({
	event
}: {
	event: import('xstate').ErrorActorEvent
}): Partial<ReaderContext> => ({
	result: {
		outcome: 'failed',
		code:
			'error' in event && event.error instanceof z.ZodError
				? 'invalidData'
				: classifyJazzArchiveFailure('error' in event ? event.error : undefined)
	}
})
const events1 = {
	CANCEL: types<EventPayload<{ type: 'CANCEL' | 'SHUTDOWN' }, 'CANCEL'>>(),
	SHUTDOWN: types<EventPayload<{ type: 'CANCEL' | 'SHUTDOWN' }, 'SHUTDOWN'>>()
}
type NativeEvent1 =
	| import('xstate').InferEvents<typeof events1>
	| import('xstate').DoneActorEvent<
			| import('xstate').OutputFrom<(typeof readerActors)['resources']>
			| import('xstate').OutputFrom<(typeof readerActors)['authority']>
			| import('xstate').OutputFrom<(typeof readerActors)['metadata']>
			| import('xstate').OutputFrom<(typeof readerActors)['relations']>
			| import('xstate').OutputFrom<(typeof readerActors)['files']>
			| import('xstate').OutputFrom<(typeof readerActors)['parts']>
			| import('xstate').OutputFrom<(typeof readerActors)['validate']>
			| import('xstate').OutputFrom<(typeof readerActors)['allocate']>
			| import('xstate').OutputFrom<(typeof readerActors)['readPart']>
			| import('xstate').OutputFrom<(typeof readerActors)['hash']>
			| import('xstate').OutputFrom<(typeof readerActors)['deposit']>
	  >
	| import('xstate').ErrorActorEvent
	| import('xstate').AfterEvent
	| import('xstate').DoneStateEvent
	| import('xstate').SnapshotEvent
	| import('xstate').TimeoutEvent
	| import('xstate').ActorTimeoutEvent
	| import('xstate').ErrorPlatformEvent
/** One finite domain reader, invoked separately for hydration and exclusive capture. */
export const financeBackupReader = setup({
	schemas: {
		context: types<ReaderContext>(),
		events: events1,
		input: types<JazzArchiveReaderInput>(),
		output: types<JazzArchiveReaderResult>(),
		children: {
			resources: types<import('xstate').ActorRefFrom<(typeof readerActors)['resources']>>(),
			authority: types<import('xstate').ActorRefFrom<(typeof readerActors)['authority']>>(),
			metadata: types<import('xstate').ActorRefFrom<(typeof readerActors)['metadata']>>(),
			relations: types<import('xstate').ActorRefFrom<(typeof readerActors)['relations']>>(),
			files: types<import('xstate').ActorRefFrom<(typeof readerActors)['files']>>(),
			parts: types<import('xstate').ActorRefFrom<(typeof readerActors)['parts']>>(),
			validate: types<import('xstate').ActorRefFrom<(typeof readerActors)['validate']>>(),
			allocate: types<import('xstate').ActorRefFrom<(typeof readerActors)['allocate']>>(),
			readPart: types<import('xstate').ActorRefFrom<(typeof readerActors)['readPart']>>(),
			hash: types<import('xstate').ActorRefFrom<(typeof readerActors)['hash']>>(),
			deposit: types<import('xstate').ActorRefFrom<(typeof readerActors)['deposit']>>()
		}
	},
	actors: readerActors,
	actions: {}
}).createMachine({
	initial: 'authorizing',
	context: ({ input }) => ({ read: input, result: { outcome: 'ready' } }),
	output: ({ context }) => context.result,
	invoke: {
		src: 'resources',
		input: ({ context }) => context.read,
		onError: (args) => {
			return { target: '.failed', context: patchFail(args) }
		}
	},
	on: { CANCEL: { target: '.cancelled' }, SHUTDOWN: { target: '.cancelled' } },
	states: {
		authorizing: {
			invoke: {
				src: 'authority',
				input: ({ context }) => context.read,
				onDone: (args) => {
					if (financeOwner(args.context.read)) {
						return { target: 'metadata' }
					}
					return { target: 'denied' }
				},
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		metadata: {
			invoke: {
				src: 'metadata',
				input: ({ context }) => context.read,
				onDone: { target: 'relations' },
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		relations: {
			invoke: {
				src: 'relations',
				input: ({ context }) => context.read,
				onDone: { target: 'files' },
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		files: {
			invoke: {
				src: 'files',
				input: ({ context }) => context.read,
				onDone: { target: 'parts' },
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		parts: {
			invoke: {
				src: 'parts',
				input: ({ context }) => context.read,
				onDone: { target: 'validating' },
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		validating: {
			invoke: {
				src: 'validate',
				input: ({ context }) => context.read,
				onDone: fileCompletion,
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		allocating: {
			invoke: {
				src: 'allocate',
				input: ({ context }) => context.read,
				onDone: partCompletion,
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		readingPart: {
			invoke: {
				src: 'readPart',
				input: ({ context }) => context.read,
				onDone: partCompletion,
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		hashing: {
			invoke: {
				src: 'hash',
				input: ({ context }) => context.read,
				onDone: fileCompletion,
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		depositing: {
			invoke: {
				src: 'deposit',
				input: ({ context }) => context.read,
				onDone: { target: 'ready' },
				onError: (args) => {
					return { target: 'failed', context: patchFail(args) }
				}
			}
		},
		ready: { type: 'final' },
		failed: { type: 'final' },
		denied: {
			type: 'final',
			entry: () => {
				return { context: { result: { outcome: 'failed', code: 'permissionDenied' } } }
			}
		},
		cancelled: {
			type: 'final',
			entry: () => {
				return { context: { result: { outcome: 'cancelled' } } }
			}
		}
	}
})

export type BackupObservation = {
	identityId: string | null
	workspaceId: string | null
	membershipId: string | null
	memberUserId: string | null
	ownerId: string | null
	role: string | null
	access: string | null
	sessionReady: boolean
	attached: boolean
	loading: boolean
	failed: boolean
}
function sameObservation(a: BackupObservation, b: BackupObservation) {
	return Object.entries(a).every(([key, value]) =>
		Object.entries(b).some(([other, item]) => key === other && value === item)
	)
}
function eligible(f: BackupObservation) {
	return (
		f.sessionReady &&
		f.attached &&
		!f.loading &&
		!f.failed &&
		Boolean(
			f.identityId &&
			f.workspaceId &&
			f.membershipId &&
			f.identityId === f.ownerId &&
			f.identityId === f.memberUserId &&
			f.role === 'owner'
		)
	)
}
type Options = Omit<
	Parameters<typeof prepareJazzArchiveExport>[0],
	'binding' | 'profile' | 'protection' | 'isCurrent'
> & { environment: string; observe(): BackupObservation }
type Event =
	| { type: 'OBSERVE'; facts: BackupObservation }
	| { type: 'SUBMIT'; submission: BackupSubmission }
	| { type: 'CANCEL' | 'SHUTDOWN' }
type BackupPreparation = {
	submission: BackupSubmission
	facts: BackupObservation
	generation: number
	isCurrent(): boolean
}
type Context = {
	facts: BackupObservation
	generation: number
	request: JazzArchiveExportRequest | undefined
	result: JazzArchiveExportResult | undefined
}
/** Settings owns eligibility and the invoked export lifetime; DLF owns the native resources. */
export function createWorkspaceBackupMachine(options: Options) {
	const actors = {
		prepare: createAsyncLogic<JazzArchiveExportRequest, BackupPreparation>({
			run: async ({ input }) => {
				const protection = takeBackupProtection(input.submission)
				const { identityId, workspaceId } = input.facts
				if (!identityId || !workspaceId) throw new Error('Backup scope unavailable')
				return prepareJazzArchiveExport({
					db: options.db,
					handoff: options.handoff,
					...(options.limits ? { limits: options.limits } : {}),
					profile: financeBackupProfile,
					protection,
					binding: {
						applicationId: 'delightful-finances',
						environment: options.environment,
						workspaceId,
						identityId,
						operationId: crypto.randomUUID(),
						generation: input.generation
					},
					isCurrent: input.isCurrent
				})
			}
		}),
		export: createJazzArchiveExportMachine(financeBackupReader),
		release: createAsyncLogic<void, { request: JazzArchiveExportRequest | undefined }>({
			run: ({ input }) => input.request?.release() ?? Promise.resolve()
		})
	}
	const patchObserve = ({
		context,
		event
	}: {
		context: Context
		event: Event
	}): Partial<Context> =>
		event.type === 'OBSERVE' ? { facts: event.facts, generation: context.generation + 1 } : {}
	const events0 = {
		OBSERVE: types<EventPayload<Event, 'OBSERVE'>>(),
		SUBMIT: types<EventPayload<Event, 'SUBMIT'>>(),
		CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<
				| import('xstate').OutputFrom<(typeof actors)['export']>
				| import('xstate').OutputFrom<(typeof actors)['release']>
		  >
		| import('xstate').ErrorActorEvent
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: events0,
			input: types<{}>(),
			children: {
				export: types<import('xstate').ActorRefFrom<(typeof actors)['export']>>(),
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				release: types<import('xstate').ActorRefFrom<(typeof actors)['release']>>()
			}
		},
		actors,
		guards: {
			closing: (args: { value: import('xstate').StateValue }) =>
				matchesState({ exporting: 'closing' }, args.value),
			invalidating: (args: { value: import('xstate').StateValue }) =>
				matchesState({ exporting: 'invalidating' }, args.value),
			changed: ({ context, event }: { context: Context; event: NativeEvent0 }) =>
				event.type === 'OBSERVE' && !sameObservation(context.facts, event.facts)
		},
		actions: {}
	})
	return model.createMachine({
		id: 'finance-workspace-backup',
		initial: 'checking',
		context: () => ({
			facts: options.observe(),
			generation: 0,
			request: undefined,
			result: undefined
		}),
		on: {
			SUBMIT: ({ event }, enq) => {
				enq(() => event.submission.release())
			},
			OBSERVE: (args) => {
				if (!args.guards.changed(args)) return
				return { target: '.checking', context: { ...patchObserve(args), result: undefined } }
			},
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			checking: {
				always: (args) => {
					if (eligible(args.context.facts)) {
						return { target: 'editing' }
					}
					return { target: 'unavailable' }
				}
			},
			unavailable: {},
			editing: {
				initial: 'ready',
				on: {
					SUBMIT: ({ event }, enq) => {
						if (!event.submission.validPassword) {
							enq(() => event.submission.release())
							return { target: '.invalidPassword' }
						}
						return { target: 'preparing' }
					}
				},
				states: { ready: {}, invalidPassword: {}, downloaded: {}, failed: {}, cancelled: {} }
			},
			preparing: {
				initial: 'working',
				invoke: {
					id: 'prepare',
					src: 'prepare',
					input: ({ context, event, self }) => {
						if (event.type !== 'SUBMIT') throw new Error('Backup submission required')
						const { facts, generation } = context
						return {
							submission: event.submission,
							facts,
							generation,
							isCurrent: () =>
								self.getSnapshot().context.generation === generation &&
								sameObservation(facts, options.observe())
						}
					},
					onDone: (args) => {
						const context = { request: args.event.output, result: undefined }
						if (matchesState({ preparing: 'closing' }, args.value))
							return { target: 'releasing.closing', context }
						if (matchesState({ preparing: 'invalidating' }, args.value))
							return { target: 'releasing.changing', context }
						if (matchesState({ preparing: 'cancelling' }, args.value))
							return { target: 'releasing.cancelled', context }
						return { target: 'exporting', context }
					},
					onError: (args) => {
						if (matchesState({ preparing: 'closing' }, args.value)) return { target: 'closed' }
						if (matchesState({ preparing: 'invalidating' }, args.value))
							return { target: 'checking' }
						if (matchesState({ preparing: 'cancelling' }, args.value))
							return { target: 'editing.cancelled' }
						return { target: 'editing.failed' }
					}
				},
				on: {
					CANCEL: { target: '.cancelling' },
					SHUTDOWN: { target: '.closing' },
					OBSERVE: (args) => {
						if (!args.guards.changed(args)) return
						return { target: '.invalidating', context: patchObserve(args) }
					}
				},
				states: {
					working: {},
					cancelling: { on: { CANCEL: {} } },
					invalidating: { on: { CANCEL: {} } },
					closing: {
						on: { SHUTDOWN: {}, CANCEL: {}, OBSERVE: (args) => ({ context: patchObserve(args) }) }
					}
				}
			},
			exporting: {
				initial: 'working',
				invoke: {
					id: 'export',
					src: 'export',
					input: ({ context }) => {
						if (!context.request) throw new Error('Missing backup request')
						return { request: context.request }
					},
					onDone: (args) => {
						const { event } = args
						if (event.output.outcome === 'failed' && event.output.code === 'cleanupFailed') {
							return { target: 'releaseBlocked' }
						}
						if (matchesState({ exporting: 'closing' }, args.value)) {
							return { target: 'closed', context: { request: undefined, result: undefined } }
						}
						if (matchesState({ exporting: 'invalidating' }, args.value)) {
							return { target: 'checking', context: { request: undefined, result: undefined } }
						}
						if (event.output.outcome === 'exported') {
							return {
								target: 'editing.downloaded',
								context: { request: undefined, result: event.output }
							}
						}
						if (event.output.outcome === 'cancelled') {
							return {
								target: 'editing.cancelled',
								context: { request: undefined, result: event.output }
							}
						}
						return {
							target: 'editing.failed',
							context: { request: undefined, result: event.output }
						}
					},
					onError: (args) => {
						if (matchesState({ exporting: 'closing' }, args.value)) {
							return { target: 'releasing.closing' }
						}
						if (matchesState({ exporting: 'invalidating' }, args.value)) {
							return { target: 'releasing.changing' }
						}
						return { target: 'releasing.working' }
					}
				},
				on: {
					OBSERVE: (args, enq) => {
						if (!args.guards.changed(args)) return
						enq.sendTo('export', { type: 'INVALIDATE' })
						return { target: '.invalidating', context: patchObserve(args) }
					},
					CANCEL: (args, enq) => {
						enq.sendTo('export', { type: 'CANCEL' })
						return { target: '.cancelling' }
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('export', { type: 'SHUTDOWN' })
						return { target: '.closing' }
					}
				},
				states: {
					working: {},
					cancelling: { on: { CANCEL: {} } },
					invalidating: { on: { CANCEL: {} } },
					closing: {
						on: {
							OBSERVE: (args) => {
								return { context: patchObserve(args) }
							},
							CANCEL: {},
							SHUTDOWN: {}
						}
					}
				}
			},
			releasing: {
				initial: 'working',
				invoke: {
					src: 'release',
					input: ({ context }) => ({ request: context.request }),
					onDone: (args) => {
						if (matchesState({ releasing: 'closing' }, args.value)) {
							return { target: 'closed', context: { request: undefined, result: undefined } }
						}
						if (matchesState({ releasing: 'changing' }, args.value)) {
							return { target: 'checking', context: { request: undefined, result: undefined } }
						}
						if (matchesState({ releasing: 'cancelled' }, args.value)) {
							return {
								target: 'editing.cancelled',
								context: { request: undefined, result: undefined }
							}
						}
						if (eligible(args.context.facts)) {
							return { target: 'editing.failed', context: { request: undefined } }
						}
						return { target: 'checking', context: { request: undefined } }
					},
					onError: { target: 'releaseBlocked' }
				},
				on: {
					OBSERVE: (args) => {
						if (!args.guards.changed(args)) return
						return { target: '.changing', context: patchObserve(args) }
					},
					SHUTDOWN: { target: '.closing' }
				},
				states: {
					working: {},
					cancelled: {},
					changing: {},
					closing: {
						on: {
							OBSERVE: (args) => {
								return { context: patchObserve(args) }
							},
							SHUTDOWN: {}
						}
					}
				}
			},
			releaseBlocked: {
				on: {
					OBSERVE: (args) => {
						return { context: patchObserve(args) }
					},
					SHUTDOWN: {}
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return { context: { request: undefined, result: undefined } }
				}
			}
		}
	})
}
export type WorkspaceBackupSnapshot = SnapshotFrom<ReturnType<typeof createWorkspaceBackupMachine>>
export type BackupMessage =
	| 'preparing'
	| 'downloaded'
	| 'cancelled'
	| 'permissionDenied'
	| 'dataChanged'
	| 'failed'
	| 'password'
	| undefined
export function selectWorkspaceBackup(snapshot: WorkspaceBackupSnapshot): {
	editable: boolean
	canDownload: boolean
	canCancel: boolean
	canReload: boolean
	message: BackupMessage
	alert: boolean
} {
	const busy =
			snapshot.matches('preparing') ||
			snapshot.matches('exporting') ||
			snapshot.matches('releasing'),
		editing = snapshot.matches('editing'),
		result = snapshot.context.result
	const message: BackupMessage = snapshot.matches('releaseBlocked')
		? 'failed'
		: busy
			? 'preparing'
			: snapshot.matches({ editing: 'downloaded' })
				? 'downloaded'
				: snapshot.matches({ editing: 'cancelled' })
					? 'cancelled'
					: snapshot.matches({ editing: 'invalidPassword' })
						? 'password'
						: snapshot.matches({ editing: 'failed' })
							? result?.outcome === 'failed' && result.code === 'permissionDenied'
								? 'permissionDenied'
								: result?.outcome === 'failed' && result.code === 'sourceChanged'
									? 'dataChanged'
									: 'failed'
							: snapshot.matches('unavailable') && !snapshot.context.facts.loading
								? 'permissionDenied'
								: undefined
	return {
		editable: editing,
		canDownload: editing,
		canCancel:
			snapshot.matches({ preparing: 'working' }) || snapshot.matches({ exporting: 'working' }),
		canReload: snapshot.matches('releaseBlocked'),
		message,
		alert:
			message === 'failed' ||
			message === 'permissionDenied' ||
			message === 'dataChanged' ||
			message === 'password'
	}
}
