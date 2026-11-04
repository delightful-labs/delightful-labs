import { assign, setup } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type { ArchivePayload, PayloadLimits } from 'delightful-local-first/backup/archive'
import {
	validateNotebookWrite,
	captureNotebookData,
	type NotebookTransformResult,
	notebookPayload,
	type NotebookData,
	type NotebookWrite
} from '../source-data.js'

export type NotebookReply<T> = (
	result: { ok: true; value: T } | { ok: false; error: unknown }
) => void
export interface NotebookLeaseToken {
	toJSON(): { kind: 'notebookLease' }
}
type Bound = { binding: BackupBinding; signal: AbortSignal }
type Owned = Bound & { owner: NotebookLeaseToken }
export type NotebookSourceEvent =
	| { type: 'STARTED' }
	| { type: 'OBSERVE_BINDING'; binding: BackupBinding; reply: NotebookReply<void> }
	| { type: 'REPLACE'; write: NotebookWrite; reply: NotebookReply<void> }
	| ({ type: 'AUTHORITY'; reply: NotebookReply<boolean> } & Bound)
	| ({ type: 'ACQUIRE'; reply: NotebookReply<void> } & Owned)
	| ({ type: 'DRAIN'; reply: NotebookReply<void> } & Owned)
	| ({ type: 'READ'; limits: PayloadLimits; reply: NotebookReply<ArchivePayload> } & Owned)
	| ({ type: 'CONSISTENCY'; reply: NotebookReply<boolean> } & Owned)
	| { type: 'RELEASE'; owner: NotebookLeaseToken; reply: NotebookReply<void> }
type Input = { data: NotebookData; binding: BackupBinding }
type Context = Input & {
	owner: NotebookLeaseToken | undefined
	write: Extract<NotebookSourceEvent, { type: 'REPLACE' }> | undefined
	writeResult: NotebookTransformResult | undefined
	read: Extract<NotebookSourceEvent, { type: 'READ' }> | undefined
	readResult: NotebookTransformResult | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing notebook operation')
	return value
}
function successful(result: NotebookTransformResult | undefined): NotebookData {
	if (!result?.ok) throw new Error('Expected successful notebook transform')
	return result.data
}
function failed(result: NotebookTransformResult | undefined): unknown {
	if (result === undefined || result.ok) throw new Error('Expected failed notebook transform')
	return result.error
}
function allowed(context: Context, event: Bound) {
	const payload = notebookPayload(context.data)
	return (
		!event.signal.aborted &&
		sameBackupBinding(context.binding, event.binding) &&
		payload.source.applicationId === event.binding.applicationId &&
		payload.source.workspaceId === event.binding.workspaceId
	)
}
export function createNotebookSourceMachine() {
	return setup<
		Context,
		NotebookSourceEvent,
		{},
		{},
		{
			validateWrite: undefined
			commitWrite: undefined
			acceptWrite: undefined
			rejectWrite: undefined
			clearWrite: undefined
			captureRead: undefined
			returnRead: undefined
			rejectRead: undefined
			clearRead: undefined
		},
		{
			authorized: undefined
			current: undefined
			owns: undefined
			validWrite: undefined
			capturedRead: undefined
		},
		never,
		string,
		Input
	>({
		actions: {
			validateWrite: assign(({ context }) => ({
				writeResult: validateNotebookWrite(required(context.write).write)
			})),
			commitWrite: assign(({ context }) => ({ data: successful(context.writeResult) })),
			acceptWrite: ({ context }) => required(context.write).reply({ ok: true, value: undefined }),
			rejectWrite: ({ context }) =>
				required(context.write).reply({ ok: false, error: failed(context.writeResult) }),
			clearWrite: assign({ write: undefined, writeResult: undefined }),
			captureRead: assign(({ context }) => ({
				readResult: captureNotebookData(context.data, required(context.read).limits)
			})),
			returnRead: ({ context }) =>
				required(context.read).reply({
					ok: true,
					value: notebookPayload(successful(context.readResult))
				}),
			rejectRead: ({ context }) =>
				required(context.read).reply({ ok: false, error: failed(context.readResult) }),
			clearRead: assign({ read: undefined, readResult: undefined })
		},
		guards: {
			validWrite: ({ context }) => context.writeResult?.ok === true,
			capturedRead: ({ context }) => context.readResult?.ok === true,
			authorized: ({ context, event }) => 'signal' in event && allowed(context, event),
			current: ({ context, event }) =>
				'signal' in event &&
				'owner' in event &&
				context.owner === event.owner &&
				allowed(context, event),
			owns: ({ context, event }) => 'owner' in event && context.owner === event.owner
		}
	}).createMachine({
		id: 'notebook-source',
		initial: 'initializing',
		context: ({ input }) => ({
			...input,
			binding: Object.freeze({ ...input.binding }),
			owner: undefined,
			write: undefined,
			writeResult: undefined,
			read: undefined,
			readResult: undefined
		}),
		on: {
			OBSERVE_BINDING: {
				actions: [
					assign({ binding: ({ event }) => Object.freeze({ ...event.binding }) }),
					({ event }) => event.reply({ ok: true, value: undefined })
				]
			},
			AUTHORITY: [
				{ guard: 'authorized', actions: ({ event }) => event.reply({ ok: true, value: true }) },
				{ actions: ({ event }) => event.reply({ ok: true, value: false }) }
			]
		},
		states: {
			initializing: {
				entry: ({ self }) => self.send({ type: 'STARTED' }),
				on: { STARTED: 'available' }
			},
			available: {
				tags: 'acceptingCommands',
				initial: 'idle',
				states: {
					idle: {},
					validatingWrite: {
						entry: 'validateWrite',
						always: [
							{ guard: 'validWrite', target: 'committingWrite' },
							{ target: 'rejectingWrite' }
						]
					},
					committingWrite: {
						entry: ['commitWrite', 'acceptWrite'],
						always: { target: 'idle', actions: 'clearWrite' }
					},
					rejectingWrite: {
						entry: 'rejectWrite',
						always: { target: 'idle', actions: 'clearWrite' }
					}
				},
				on: {
					DRAIN: {
						actions: ({ event }) =>
							event.reply({ ok: false, error: new Error('Notebook capture invalidated') })
					},
					READ: {
						actions: ({ event }) =>
							event.reply({ ok: false, error: new Error('Notebook capture invalidated') })
					},
					CONSISTENCY: { actions: ({ event }) => event.reply({ ok: true, value: false }) },
					RELEASE: { actions: ({ event }) => event.reply({ ok: true, value: undefined }) },
					ACQUIRE: [
						{
							guard: 'authorized',
							target: 'leased',
							actions: [
								assign({ owner: ({ event }) => event.owner }),
								({ event }) => event.reply({ ok: true, value: undefined })
							]
						},
						{
							actions: ({ event }) =>
								event.reply({ ok: false, error: new Error('Notebook capture unavailable') })
						}
					],
					REPLACE: { target: '.validatingWrite', actions: assign({ write: ({ event }) => event }) }
				}
			},
			leased: {
				tags: 'acceptingCommands',
				initial: 'current',
				on: {
					ACQUIRE: {
						actions: ({ event }) =>
							event.reply({ ok: false, error: new Error('Notebook capture unavailable') })
					},
					REPLACE: {
						actions: ({ event }) =>
							event.reply({ ok: false, error: new Error('Notebook capture owns the source') })
					},
					DRAIN: {
						actions: ({ event }) =>
							event.reply({ ok: false, error: new Error('Notebook capture invalidated') })
					},
					READ: {
						actions: ({ event }) =>
							event.reply({ ok: false, error: new Error('Notebook capture invalidated') })
					},
					CONSISTENCY: { actions: ({ event }) => event.reply({ ok: true, value: false }) },
					RELEASE: [
						{
							guard: 'owns',
							target: 'available',
							actions: [
								assign({ owner: undefined }),
								({ event }) => event.reply({ ok: true, value: undefined })
							]
						},
						{ actions: ({ event }) => event.reply({ ok: true, value: undefined }) }
					],
					OBSERVE_BINDING: [
						{
							guard: ({ context, event }) => sameBackupBinding(context.binding, event.binding),
							actions: ({ event }) => event.reply({ ok: true, value: undefined })
						},
						{
							target: '.invalidated',
							actions: [
								assign({ binding: ({ event }) => Object.freeze({ ...event.binding }) }),
								({ event }) => event.reply({ ok: true, value: undefined })
							]
						}
					]
				},
				states: {
					current: {
						initial: 'idle',
						states: {
							idle: {},
							capturingRead: {
								entry: 'captureRead',
								always: [
									{ guard: 'capturedRead', target: 'returningRead' },
									{ target: 'rejectingRead' }
								]
							},
							returningRead: {
								entry: 'returnRead',
								always: { target: 'idle', actions: 'clearRead' }
							},
							rejectingRead: {
								entry: 'rejectRead',
								always: { target: 'idle', actions: 'clearRead' }
							}
						},
						on: {
							DRAIN: [
								{
									guard: 'current',
									actions: ({ event }) => event.reply({ ok: true, value: undefined })
								},
								{
									actions: ({ event }) =>
										event.reply({ ok: false, error: new Error('Notebook capture invalidated') })
								}
							],
							CONSISTENCY: [
								{
									guard: 'current',
									actions: ({ event }) => event.reply({ ok: true, value: true })
								},
								{ actions: ({ event }) => event.reply({ ok: true, value: false }) }
							],
							READ: [
								{
									guard: 'current',
									target: '.capturingRead',
									actions: assign({ read: ({ event }) => event })
								},
								{
									actions: ({ event }) =>
										event.reply({ ok: false, error: new Error('Notebook capture invalidated') })
								}
							]
						}
					},
					invalidated: {}
				}
			}
		}
	})
}
