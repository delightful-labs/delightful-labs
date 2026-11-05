import { assign, fromPromise, setup } from 'xstate'
import { sameBackupBinding, type BackupBinding } from 'delightful-local-first/backup/export'
import type { RestoreEvent } from 'delightful-local-first/backup/restore'
import { createRestoreJournalStepMachine } from 'delightful-local-first/backup/restore/workflow'
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

// One synchronous pure operation per boundary; routing and failures remain visible in the chart.
function planningSucceeded(operation: () => boolean | void): boolean {
	try {
		return operation() !== false
	} catch {
		return false
	}
}
type Input = { request: NotebookRestoreRequest }
type Result = { outcome: 'planned' | 'unavailable' | 'cancelled' | 'closed' | 'invalidated' }
/** Finite planner; its parent owns the checked archive and all content-bearing capsule references. */
export function createNotebookRestorePlanningMachine() {
	type Context = Input & {
		binding: BackupBinding
		mode: 'new' | 'resume'
		databaseName: string
		index: number
		planningSucceeded: boolean
		planSha256: string
		interruption: 'cancelled' | 'closed' | 'invalidated' | undefined
		outcome: 'planned' | 'unavailable'
	}
	const actors = {
		discover: createRestoreJournalStepMachine(),
		graphHash: fromPromise<string, Input>(({ input }) => hashNotebookProjection(data(input).graph)),
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
		)
	}
	const model = setup<
		Context,
		RestoreEvent,
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
				planningSucceeded: false,
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
				entry: assign({
					planningSucceeded: ({ context }) =>
						planningSucceeded(() => notebookProfile.validate(data(context).archive.readPayload()))
				}),
				always: [
					interrupted,
					{
						guard: ({ context }) => context.planningSucceeded && context.mode === 'new',
						target: 'allocating'
					},
					{ guard: ({ context }) => context.planningSucceeded, target: 'discovering' },
					{ target: failed }
				]
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
				entry: assign({
					planningSucceeded: ({ context }) =>
						planningSucceeded(() => {
							const value = data(context)
							value.mappings = allocateNotebookMappings(value.archive.readPayload())
						})
				}),
				always: [
					interrupted,
					{ guard: ({ context }) => context.planningSucceeded, target: 'projecting' },
					{ target: failed }
				]
			},
			projecting: {
				entry: assign({
					planningSucceeded: ({ context }) =>
						planningSucceeded(() => {
							projectNotebookGraph(data(context))
						})
				}),
				always: [
					interrupted,
					{ guard: ({ context }) => context.planningSucceeded, target: 'hashingGraph' },
					{ target: failed }
				]
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
				entry: assign({
					planningSucceeded: ({ context }) =>
						planningSucceeded(() => {
							projectNotebookControl(data(context))
						})
				}),
				always: [
					interrupted,
					{ guard: ({ context }) => context.planningSucceeded, target: 'hashingPreparation' },
					{ target: failed }
				]
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
				entry: assign({
					planningSucceeded: ({ context }) =>
						planningSucceeded(() => {
							const value = data(context)
							value.intent = buildNotebookIntent(value, context.planSha256)
						})
				}),
				always: [
					interrupted,
					{ guard: ({ context }) => context.planningSucceeded, target: 'planned' },
					{ target: failed }
				]
			},
			planned: { type: 'final', entry: assign({ outcome: 'planned' }) },
			complete: { type: 'final' }
		}
	})
}
