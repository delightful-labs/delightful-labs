import { assign, fromCallback, fromPromise, setup } from 'xstate'
import { z } from 'zod'
import type { IntegrityCheckedArchive } from 'delightful-local-first/backup/envelope'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type { RestoreJournalIntent } from 'delightful-local-first/backup/restore/journal'
import type {
	RestorePreparationEvent,
	RestorePreparationResult,
	RestorePreparationWriter
} from 'delightful-local-first/backup/restore/preparation'
import {
	createRestorePreparationMachine,
	createRestoreJournalStepMachine
} from 'delightful-local-first/backup/restore/preparation/workflow'
import { notebookProfile } from './profile.js'
import {
	allocateNotebookMappings,
	buildNotebookIntent,
	hashNotebookProjection,
	notebookCanonical,
	notebookPlan,
	projectNotebookControl,
	projectNotebookGraph,
	type NotebookRestorePlanData
} from './restore-plan.js'

export interface NotebookRestoreRequest {
	release(): void
	toJSON(): { kind: 'notebookRestoreRequest' }
}
type Options = {
	mode: 'new' | 'resume'
	binding: BackupBinding
	databaseName: string
	archive: IntegrityCheckedArchive
}
type Data = NotebookRestorePlanData & {
	options: Options | undefined
	intent: RestoreJournalIntent | undefined
	releaseControl: (() => void) | undefined
}
const requests = new WeakMap<NotebookRestoreRequest, { data: Data; claim(): void }>()
function prepared(request: NotebookRestoreRequest) {
	const value = requests.get(request)
	if (!value) throw new Error('Invalid notebook restore request')
	return value
}
/** Transfers checked-archive ownership. Resume requires the same operation binding and file. */
export function prepareNotebookRestore(options: Options): NotebookRestoreRequest {
	const binding = z
		.strictObject({
			applicationId: z.string().min(1).max(256),
			environment: z.string().min(1).max(256),
			identityId: z.uuid(),
			workspaceId: z.uuid(),
			generation: z.int().nonnegative(),
			operationId: z.string().min(1).max(256)
		})
		.readonly()
		.safeParse(options.binding)
	if (!binding.success) throw new Error('Invalid notebook restore binding')
	const captured = Object.freeze({ ...options, binding: binding.data })
	const data: Data = {
		options: captured,
		archive: captured.archive,
		binding: captured.binding,
		mappings: [],
		graph: '',
		graphSha256: '',
		preparation: '',
		preparationSha256: '',
		batches: [],
		activation: '',
		activationSha256: '',
		intent: undefined,
		releaseControl: undefined
	}
	let available: Data | undefined = data
	const request: NotebookRestoreRequest = {
		release() {
			data.releaseControl?.()
			clear(data)
		},
		toJSON: () => ({ kind: 'notebookRestoreRequest' })
	}
	requests.set(request, {
		data,
		claim() {
			if (!available || !data.options) throw new Error('Notebook restore request unavailable')
			available = undefined
		}
	})
	return request
}
function clear(data: Data) {
	data.archive.release()
	data.options = undefined
	data.graph = ''
	data.preparation = ''
	data.activation = ''
	data.batches = []
	data.mappings = []
	data.intent = undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing notebook restore resource')
	return value
}

/** One application-owned root. Runtime tests follow implementation review. */
export function createNotebookRestorePreparationMachine<Transaction, Write>(
	writer: RestorePreparationWriter<Transaction, Write>
) {
	type Input = { request: NotebookRestoreRequest }
	type Context = Input & {
		binding: BackupBinding
		mode: Options['mode']
		databaseName: string
		index: number
		planSha256: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		result: RestorePreparationResult
	}
	const data = (input: Input) => prepared(input.request).data
	const actors = {
		claim: fromPromise<void, Input>(({ input }) => {
			prepared(input.request).claim()
			return Promise.resolve()
		}),
		resources: fromCallback<{ type: string }, Input>(({ input, sendBack }) => {
			const value = data(input)
			value.releaseControl = () => sendBack({ type: 'RELEASE' })
			return () => {
				value.releaseControl = undefined
				clear(value)
			}
		}),
		validate: fromPromise<boolean, Input>(({ input }) =>
			Promise.resolve(notebookProfile.validate(data(input).archive.readPayload()))
		),
		discover: createRestoreJournalStepMachine(),
		allocate: fromPromise<void, Input>(({ input }) => {
			const value = data(input)
			value.mappings = allocateNotebookMappings(value.archive.readPayload())
			return Promise.resolve()
		}),
		project: fromPromise<void, Input>(({ input }) => {
			projectNotebookGraph(data(input))
			return Promise.resolve()
		}),
		graphHash: fromPromise<string, Input>(({ input }) => hashNotebookProjection(data(input).graph)),
		control: fromPromise<void, Input>(({ input }) => {
			projectNotebookControl(data(input))
			return Promise.resolve()
		}),
		preparationHash: fromPromise<string, Input>(({ input }) =>
			hashNotebookProjection(data(input).preparation)
		),
		batchHash: fromPromise<string, Input & { index: number }>(({ input }) =>
			hashNotebookProjection(required(data(input).batches[input.index]).contents)
		),
		activationHash: fromPromise<string, Input>(({ input }) =>
			hashNotebookProjection(data(input).activation)
		),
		planHash: fromPromise<string, Input>(({ input }) =>
			hashNotebookProjection(notebookCanonical(notebookPlan(data(input))))
		),
		build: fromPromise<void, Input & { sha256: string }>(({ input }) => {
			const value = data(input)
			value.intent = buildNotebookIntent(value, input.sha256)
			return Promise.resolve()
		}),
		prepare: createRestorePreparationMachine(writer)
	}
	const model = setup<
		Context,
		RestorePreparationEvent | { type: 'RELEASE' },
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		Input,
		RestorePreparationResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {
			interrupt: assign({
				interruption: ({ event }) =>
					event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled'
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const forward = model.enqueueActions(({ self, event, enqueue }) => {
		const child = self.getSnapshot().children.prepare
		if (child?.getSnapshot().status === 'active')
			enqueue.sendTo(child, event.type === 'RELEASE' ? { type: 'CANCEL' } : event)
	})
	return model.createMachine({
		id: 'notebook-restore-preparation',
		initial: 'claiming',
		context: ({ input }) => {
			const options = required(data(input).options)
			return {
				request: input.request,
				binding: options.binding,
				mode: options.mode,
				databaseName: options.databaseName,
				index: 0,
				planSha256: '',
				interruption: undefined,
				result: { binding: options.binding, outcome: 'unavailable', record: undefined }
			}
		},
		output: ({ context }) => ({
			...context.result,
			outcome: context.interruption ?? context.result.outcome
		}),
		on: {
			CANCEL: { actions: ['interrupt', forward] },
			SHUTDOWN: { actions: ['interrupt', forward] },
			INVALIDATE: { guard: 'currentBinding', actions: ['interrupt', forward] },
			RELEASE: { actions: ['interrupt', forward] }
		},
		states: {
			claiming: { invoke: { src: 'claim', input, onDone: 'working', onError: 'complete' } },
			working: {
				initial: 'validating',
				invoke: { src: 'resources', input, onError: 'complete' },
				states: {
					validating: {
						always: { guard: 'interrupted', target: '#notebook-restore-preparation.complete' },
						invoke: {
							src: 'validate',
							input,
							onDone: [
								{
									guard: ({ context, event }) => event.output && context.mode === 'new',
									target: 'allocating'
								},
								{ guard: ({ event }) => event.output, target: 'discovering' },
								{ target: '#notebook-restore-preparation.complete' }
							],
							onError: '#notebook-restore-preparation.complete'
						}
					},
					discovering: {
						always: { guard: 'interrupted', target: '#notebook-restore-preparation.complete' },
						invoke: {
							src: 'discover',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								command: { mode: 'discover' }
							}),
							onDone: [
								{
									guard: ({ event }) =>
										event.output.outcome === 'loaded' && event.output.record !== undefined,
									target: 'projecting',
									actions: ({ context, event }) => {
										data(context).mappings = required(event.output.record).intent.plan.mappings
									}
								},
								{ target: '#notebook-restore-preparation.complete' }
							],
							onError: '#notebook-restore-preparation.complete'
						}
					},
					allocating: {
						invoke: {
							src: 'allocate',
							input,
							onDone: 'projecting',
							onError: '#notebook-restore-preparation.complete'
						}
					},
					projecting: {
						invoke: {
							src: 'project',
							input,
							onDone: 'hashingGraph',
							onError: '#notebook-restore-preparation.complete'
						}
					},
					hashingGraph: {
						always: { guard: 'interrupted', target: '#notebook-restore-preparation.complete' },
						invoke: {
							src: 'graphHash',
							input,
							onDone: {
								target: 'projectingControl',
								actions: ({ context, event }) => {
									data(context).graphSha256 = event.output
								}
							},
							onError: '#notebook-restore-preparation.complete'
						}
					},
					projectingControl: {
						invoke: {
							src: 'control',
							input,
							onDone: 'hashingPreparation',
							onError: '#notebook-restore-preparation.complete'
						}
					},
					hashingPreparation: {
						invoke: {
							src: 'preparationHash',
							input,
							onDone: {
								target: 'hashingBatch',
								actions: ({ context, event }) => {
									data(context).preparationSha256 = event.output
								}
							},
							onError: '#notebook-restore-preparation.complete'
						}
					},
					hashingBatch: {
						always: { guard: 'interrupted', target: '#notebook-restore-preparation.complete' },
						invoke: {
							src: 'batchHash',
							input: ({ context }) => ({ ...input({ context }), index: context.index }),
							onDone: [
								{
									guard: ({ context }) => context.index + 1 < data(context).batches.length,
									target: 'hashingBatch',
									reenter: true,
									actions: [
										({ context, event }) => {
											required(data(context).batches[context.index]).sha256 = event.output
										},
										assign({ index: ({ context }) => context.index + 1 })
									]
								},
								{
									target: 'hashingActivation',
									actions: ({ context, event }) => {
										required(data(context).batches[context.index]).sha256 = event.output
									}
								}
							],
							onError: '#notebook-restore-preparation.complete'
						}
					},
					hashingActivation: {
						invoke: {
							src: 'activationHash',
							input,
							onDone: {
								target: 'hashingPlan',
								actions: ({ context, event }) => {
									data(context).activationSha256 = event.output
								}
							},
							onError: '#notebook-restore-preparation.complete'
						}
					},
					hashingPlan: {
						invoke: {
							src: 'planHash',
							input,
							onDone: {
								target: 'buildingIntent',
								actions: assign({ planSha256: ({ event }) => event.output })
							},
							onError: '#notebook-restore-preparation.complete'
						}
					},
					buildingIntent: {
						invoke: {
							src: 'build',
							input: ({ context }) => ({ ...input({ context }), sha256: context.planSha256 }),
							onDone: [
								{ guard: 'interrupted', target: '#notebook-restore-preparation.complete' },
								{ target: 'preparingDestination' }
							],
							onError: '#notebook-restore-preparation.complete'
						}
					},
					preparingDestination: {
						invoke: {
							id: 'prepare',
							src: 'prepare',
							input: ({ context }) => ({
								binding: context.binding,
								databaseName: context.databaseName,
								intent: required(data(context).intent)
							}),
							onDone: {
								target: '#notebook-restore-preparation.complete',
								actions: assign({ result: ({ event }) => event.output })
							},
							onError: '#notebook-restore-preparation.complete'
						}
					}
				}
			},
			complete: { type: 'final' }
		}
	})
}
