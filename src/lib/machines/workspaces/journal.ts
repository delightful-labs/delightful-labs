export type WorkspaceJournalEvent =
	| { type: 'SHUTDOWN' | 'CANCEL' | 'TX_COMPLETE' | 'TX_ABORTED' }
	| { type: 'RECORD'; value: unknown }
	| { type: 'TX_FAILED'; error: unknown }
import { assign, fromCallback, fromPromise, sendTo, setup, stateIn } from 'xstate'
export type WorkspaceJournalResult<Record> =
	| { outcome: 'succeeded'; record: Record | undefined }
	| { outcome: 'conflict' | 'cancelled' }
	| { outcome: 'failed'; error: unknown }
export type WorkspaceJournalInput<Record> = { key: string } & (
	| { mode: 'read' }
	| { mode: 'write'; record: Record }
	| { mode: 'clear'; attemptId: string }
)
export function createWorkspaceJournal<Record extends { key: string }>(options: {
	databaseName: string
	attemptId: (record: Record) => string
	schema: { safeParse: (value: unknown) => { success: boolean }; parse: (value: unknown) => Record }
}) {
	type WorkspaceJournalRecord = Record
	type Input = WorkspaceJournalInput<Record>
	type JournalResult = WorkspaceJournalResult<Record>
	type Command =
		| { type: 'READ'; key: string }
		| { type: 'INSERT'; record: WorkspaceJournalRecord }
		| { type: 'REMOVE'; key: string }
		| { type: 'ABORT' }
	type Event = WorkspaceJournalEvent
	function required<T>(value: T | undefined): T {
		if (value === undefined) throw new Error('Missing journal resource')
		return value
	}
	const open = fromPromise(
		() =>
			new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(options.databaseName, 1)
				request.onupgradeneeded = () => {
					request.result.createObjectStore('attempts', { keyPath: 'key' })
				}
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject(request.error)
			})
	)
	const acquire = fromPromise(({ input }: { input: IDBDatabase }) =>
		Promise.resolve(input.transaction('attempts', 'readwrite'))
	)
	// Native resource adapter: commands each perform one operation; the chart chooses policy/staging.
	const resource = fromCallback<Command, IDBTransaction>(({ input: tx, receive, sendBack }) => {
		tx.oncomplete = () => sendBack({ type: 'TX_COMPLETE' })
		tx.onabort = () => sendBack({ type: 'TX_ABORTED' })
		tx.onerror = (event) => {
			const requestError = event.target instanceof IDBRequest ? event.target.error : undefined
			// Explicit abort rejects pending requests with AbortError but leaves tx.error null.
			// Its native abort event supplies settlement; those request errors are not new failures.
			if (requestError?.name === 'AbortError' && tx.error === null) return
			sendBack({ type: 'TX_FAILED', error: tx.error ?? requestError })
		}
		receive((command) => {
			try {
				if (command.type === 'READ') {
					const request = tx.objectStore('attempts').get(command.key)
					request.onsuccess = () => sendBack({ type: 'RECORD', value: request.result })
					return
				}
				if (command.type === 'INSERT') {
					tx.objectStore('attempts').add(command.record)
					return
				}
				if (command.type === 'REMOVE') {
					tx.objectStore('attempts').delete(command.key)
					return
				}
				tx.abort()
			} catch (error) {
				sendBack({ type: 'TX_FAILED', error })
				if (command.type === 'ABORT') return
				try {
					tx.abort()
				} catch (abortError) {
					sendBack({ type: 'TX_FAILED', error: abortError })
				}
			}
		})
		return () => {
			tx.oncomplete = null
			tx.onabort = null
			tx.onerror = null
		}
	})
	const close = fromPromise(({ input }: { input: IDBDatabase }) => Promise.resolve(input.close()))
	type Context = {
		request: Input
		database: IDBDatabase | undefined
		tx: IDBTransaction | undefined
		raw: unknown
		record: WorkspaceJournalRecord | undefined
		result: JournalResult | undefined
	}
	const machine = setup<
		Context,
		Event,
		{ open: typeof open; acquire: typeof acquire; resource: typeof resource; close: typeof close },
		{},
		{},
		{ closing: undefined },
		never,
		string,
		Input,
		JournalResult
	>({
		actors: { open, acquire, resource, close },
		guards: { closing: stateIn({ running: { control: 'closing' } }) }
	}).createMachine({
		id: 'workspace-creation-journal',
		initial: 'running',
		context: ({ input }) => ({
			request: input,
			database: undefined,
			tx: undefined,
			raw: undefined,
			record: undefined,
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: { on: { SHUTDOWN: 'closing', CANCEL: 'closing' } },
							closing: { on: { SHUTDOWN: {}, CANCEL: {} } }
						}
					},
					work: {
						initial: 'opening',
						states: {
							opening: {
								invoke: {
									src: 'open',
									onDone: {
										target: 'checkingOpen',
										actions: assign({ database: ({ event }) => event.output })
									},
									onError: {
										target: 'finishing',
										actions: assign({
											result: ({ event }): JournalResult => ({
												outcome: 'failed',
												error: event.error
											})
										})
									}
								}
							},
							checkingOpen: {
								always: [{ guard: 'closing', target: 'closingDatabase' }, { target: 'acquiring' }]
							},
							acquiring: {
								invoke: {
									src: 'acquire',
									input: ({ context }) => required(context.database),
									onDone: { target: 'using', actions: assign({ tx: ({ event }) => event.output }) },
									onError: {
										target: 'closingDatabase',
										actions: assign({
											result: ({ event }): JournalResult => ({
												outcome: 'failed',
												error: event.error
											})
										})
									}
								}
							},
							using: {
								invoke: {
									id: 'resource',
									src: 'resource',
									input: ({ context }) => required(context.tx),
									onError: {
										target: 'closingDatabase',
										actions: assign({
											result: ({ event }): JournalResult => ({
												outcome: 'failed',
												error: event.error
											})
										})
									}
								},
								on: {
									SHUTDOWN: { target: '.aborting', actions: sendTo('resource', { type: 'ABORT' }) },
									CANCEL: { target: '.aborting', actions: sendTo('resource', { type: 'ABORT' }) },
									TX_FAILED: {
										actions: assign({
											result: ({ event }): JournalResult => ({
												outcome: 'failed',
												error: event.error
											})
										})
									},
									TX_ABORTED: [
										{
											guard: 'closing',
											target: 'closingDatabase',
											actions: assign({
												result: ({ context }): JournalResult =>
													context.result?.outcome === 'failed'
														? context.result
														: { outcome: 'cancelled' }
											})
										},
										{
											target: 'closingDatabase',
											actions: assign({
												result: ({ context }): JournalResult =>
													context.result?.outcome === 'conflict' ||
													context.result?.outcome === 'failed'
														? context.result
														: { outcome: 'failed', error: new Error('Journal transaction aborted') }
											})
										}
									],
									TX_COMPLETE: { target: 'closingDatabase' }
								},
								initial: 'checking',
								states: {
									checking: {
										always: [
											{
												guard: 'closing',
												target: 'aborting',
												actions: sendTo('resource', { type: 'ABORT' })
											},
											{ target: 'reading' }
										]
									},
									reading: {
										entry: sendTo('resource', ({ context }) => ({
											type: 'READ',
											key: context.request.key
										})),
										on: {
											RECORD: {
												target: 'validating',
												actions: assign({ raw: ({ event }) => event.value })
											}
										}
									},
									validating: {
										always: [
											{ guard: ({ context }) => context.raw === undefined, target: 'choosing' },
											{
												guard: ({ context }) => options.schema.safeParse(context.raw).success,
												target: 'choosing',
												actions: assign({
													record: ({ context }) => options.schema.parse(context.raw)
												})
											},
											{ target: 'conflicting' }
										]
									},
									choosing: {
										always: [
											{
												guard: ({ context }) =>
													context.record !== undefined &&
													context.record.key !== context.request.key,
												target: 'conflicting'
											},
											{
												guard: ({ context }) => context.request.mode === 'read',
												target: 'waiting',
												actions: assign({
													result: ({ context }): JournalResult => ({
														outcome: 'succeeded',
														record: context.record
													})
												})
											},
											{
												guard: ({ context }) =>
													context.request.mode === 'write' &&
													context.record === undefined &&
													context.request.record.key === context.request.key,
												target: 'inserting'
											},
											{
												guard: ({ context }) =>
													context.request.mode === 'write' &&
													JSON.stringify(context.record) === JSON.stringify(context.request.record),
												target: 'waiting',
												actions: assign({
													result: ({ context }): JournalResult => ({
														outcome: 'succeeded',
														record: context.record
													})
												})
											},
											{
												guard: ({ context }) =>
													context.request.mode === 'clear' && context.record === undefined,
												target: 'waiting',
												actions: assign({ result: { outcome: 'succeeded', record: undefined } })
											},
											{
												guard: ({ context }) =>
													context.request.mode === 'clear' &&
													context.record !== undefined &&
													options.attemptId(context.record) === context.request.attemptId,
												target: 'removing'
											},
											{ target: 'conflicting' }
										]
									},
									inserting: {
										entry: [
											sendTo('resource', ({ context }) => {
												if (context.request.mode !== 'write')
													throw new Error('Expected journal write')
												return { type: 'INSERT', record: context.request.record }
											}),
											assign({
												result: ({ context }): JournalResult => {
													if (context.request.mode !== 'write')
														throw new Error('Expected journal write')
													return { outcome: 'succeeded', record: context.request.record }
												}
											})
										],
										always: 'waiting'
									},
									removing: {
										entry: [
											sendTo('resource', ({ context }) => ({
												type: 'REMOVE',
												key: context.request.key
											})),
											assign({ result: { outcome: 'succeeded', record: undefined } })
										],
										always: 'waiting'
									},
									conflicting: {
										entry: [
											assign({ result: { outcome: 'conflict' } }),
											sendTo('resource', { type: 'ABORT' })
										],
										always: 'aborting'
									},
									aborting: {},
									waiting: {}
								}
							},
							closingDatabase: {
								invoke: {
									src: 'close',
									input: ({ context }) => required(context.database),
									onDone: 'finishing',
									onError: {
										target: 'finishing',
										actions: assign({
											result: ({ event }): JournalResult => ({
												outcome: 'failed',
												error: event.error
											})
										})
									}
								}
							},
							finishing: {
								always: [
									{
										guard: ({ context }) => context.result?.outcome === 'failed',
										target: '#workspace-creation-journal.failed'
									},
									{ guard: 'closing', target: '#workspace-creation-journal.cancelled' },
									{
										guard: ({ context }) => context.result?.outcome === 'succeeded',
										target: '#workspace-creation-journal.succeeded'
									},
									{
										guard: ({ context }) => context.result?.outcome === 'conflict',
										target: '#workspace-creation-journal.conflict'
									},
									{ target: '#workspace-creation-journal.failed' }
								]
							}
						}
					}
				}
			},
			succeeded: { type: 'final' },
			conflict: { type: 'final' },
			cancelled: { type: 'final', entry: assign({ result: { outcome: 'cancelled' } }) },
			failed: {
				type: 'final',
				entry: assign({
					result: ({ context }): JournalResult =>
						context.result ?? { outcome: 'failed', error: new Error('Journal transaction aborted') }
				})
			}
		}
	})

	return machine
}
