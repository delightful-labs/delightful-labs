import { assign, fromPromise, setup } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type { RestorePreparationEvent } from 'delightful-local-first/backup/restore/preparation'
import { createRestoreJournalStepMachine } from 'delightful-local-first/backup/restore/preparation/workflow'
import { notebookProfile } from './profile.js'
import {
	allocateNotebookMappings,
	buildNotebookIntent,
	hashNotebookProjection,
	notebookCanonical,
	notebookPlan,
	projectNotebookControl,
	projectNotebookGraph
} from './restore-plan.js'
import {
	notebookRestoreData as data,
	requiredNotebookRestoreValue as required,
	type NotebookRestoreRequest
} from './restore-request.js'

type Input = { request: NotebookRestoreRequest }
type Result = { outcome: 'planned' | 'unavailable' | 'cancelled' | 'closed' | 'invalidated' }
/** Finite planner; its parent owns the checked archive and all content-bearing capsule references. */
export function createNotebookRestorePlanningMachine() {
	type Context = Input & {
		binding: BackupBinding
		mode: 'new' | 'resume'
		databaseName: string
		index: number
		planSha256: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		outcome: 'planned' | 'unavailable'
	}
	const actors = {
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
		})
	}
	const model = setup<
		Context,
		RestorePreparationEvent,
		typeof actors,
		{},
		{ interrupt: undefined },
		{ interrupted: undefined; currentBinding: undefined },
		never,
		string,
		Input,
		Result
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined,
			currentBinding: ({ context, event }) =>
				event.type === 'INVALIDATE' && sameBackupBinding(context.binding, event.binding)
		},
		actions: {
			interrupt: assign({
				interruption: ({ context, event }) =>
					context.interruption ??
					(event.type === 'SHUTDOWN'
						? 'closed'
						: event.type === 'INVALIDATE'
							? 'invalidated'
							: 'cancelled')
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const failed = '#notebook-restore-plan.complete'
	const interrupted = { guard: 'interrupted', target: failed } satisfies {
		guard: 'interrupted'
		target: string
	}
	return model.createMachine({
		id: 'notebook-restore-plan',
		initial: 'validating',
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
				outcome: 'unavailable'
			}
		},
		output: ({ context }) => ({ outcome: context.interruption ?? context.outcome }),
		on: {
			CANCEL: { actions: 'interrupt' },
			SHUTDOWN: { actions: 'interrupt' },
			INVALIDATE: { guard: 'currentBinding', actions: 'interrupt' }
		},
		states: {
			validating: {
				invoke: {
					src: 'validate',
					input,
					onDone: [
						interrupted,
						{
							guard: ({ context, event }) => event.output && context.mode === 'new',
							target: 'allocating'
						},
						{ guard: ({ event }) => event.output, target: 'discovering' },
						{ target: failed }
					],
					onError: failed
				}
			},
			discovering: {
				invoke: {
					src: 'discover',
					input: ({ context }) => ({
						binding: context.binding,
						databaseName: context.databaseName,
						command: { mode: 'discover' }
					}),
					onDone: [
						interrupted,
						{
							guard: ({ event }) =>
								event.output.outcome === 'loaded' && event.output.record !== undefined,
							target: 'projecting',
							actions: ({ context, event }) => {
								const record = required(event.output.record)
								data(context).mappings = record.intent.plan.mappings
								data(context).observedJournal = record
							}
						},
						{ target: failed }
					],
					onError: failed
				}
			},
			allocating: {
				invoke: {
					src: 'allocate',
					input,
					onDone: [interrupted, { target: 'projecting' }],
					onError: failed
				}
			},
			projecting: {
				invoke: {
					src: 'project',
					input,
					onDone: [interrupted, { target: 'hashingGraph' }],
					onError: failed
				}
			},
			hashingGraph: {
				invoke: {
					src: 'graphHash',
					input,
					onDone: [
						interrupted,
						{
							target: 'projectingControl',
							actions: ({ context, event }) => {
								data(context).graphSha256 = event.output
							}
						}
					],
					onError: failed
				}
			},
			projectingControl: {
				invoke: {
					src: 'control',
					input,
					onDone: [interrupted, { target: 'hashingPreparation' }],
					onError: failed
				}
			},
			hashingPreparation: {
				invoke: {
					src: 'preparationHash',
					input,
					onDone: [
						interrupted,
						{
							target: 'hashingBatch',
							actions: ({ context, event }) => {
								data(context).preparationSha256 = event.output
							}
						}
					],
					onError: failed
				}
			},
			hashingBatch: {
				invoke: {
					src: 'batchHash',
					input: ({ context }) => ({ ...input({ context }), index: context.index }),
					onDone: [
						interrupted,
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
					onError: failed
				}
			},
			hashingActivation: {
				invoke: {
					src: 'activationHash',
					input,
					onDone: [
						interrupted,
						{
							target: 'hashingPlan',
							actions: ({ context, event }) => {
								data(context).activationSha256 = event.output
							}
						}
					],
					onError: failed
				}
			},
			hashingPlan: {
				invoke: {
					src: 'planHash',
					input,
					onDone: [
						interrupted,
						{
							target: 'buildingIntent',
							actions: assign({ planSha256: ({ event }) => event.output })
						}
					],
					onError: failed
				}
			},
			buildingIntent: {
				invoke: {
					src: 'build',
					input: ({ context }) => ({ ...input({ context }), sha256: context.planSha256 }),
					onDone: [interrupted, { target: 'planned' }],
					onError: failed
				}
			},
			planned: { type: 'final', entry: assign({ outcome: 'planned' }) },
			complete: { type: 'final' }
		}
	})
}
