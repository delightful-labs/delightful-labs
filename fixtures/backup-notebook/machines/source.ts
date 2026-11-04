import { assign, setup } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type { ArchivePayload, PayloadLimits } from 'delightful-local-first/backup/archive'
import {
	applyNotebookWrite,
	detachNotebookPayload,
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
type Context = Input & { owner: NotebookLeaseToken | undefined }
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
		{},
		{ authorized: undefined; current: undefined; owns: undefined },
		never,
		string,
		Input
	>({
		guards: {
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
			owner: undefined
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
			],
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
			RELEASE: { actions: ({ event }) => event.reply({ ok: true, value: undefined }) }
		},
		states: {
			initializing: {
				entry: ({ self }) => self.send({ type: 'STARTED' }),
				on: { STARTED: 'available' }
			},
			available: {
				on: {
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
					REPLACE: {
						actions: assign(({ event }) => {
							try {
								const data = applyNotebookWrite(event.write)
								event.reply({ ok: true, value: undefined })
								return { data }
							} catch (error) {
								event.reply({ ok: false, error })
								return {}
							}
						})
					}
				}
			},
			leased: {
				initial: 'current',
				on: {
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
									actions: ({ context, event }) => {
										try {
											const payload = detachNotebookPayload(
												{
													...notebookPayload(context.data),
													archiveId: crypto.randomUUID(),
													capturedAt: new Date().toISOString()
												},
												event.limits
											)
											event.reply({ ok: true, value: payload })
										} catch (error) {
											event.reply({ ok: false, error })
										}
									}
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
