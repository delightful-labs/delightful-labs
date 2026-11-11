import { createWorkspaceNamingOperation } from 'delightful-local-first/workspace/naming/workflow'
import type { WorkspaceNamingResult } from 'delightful-local-first/workspace/naming/contracts'
import type { AccountCurrency } from '#lib/domain/account-currency.js'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult
} from '#lib/contracts/form-contract.js'
import type {
	WorkspaceRenameObservation,
	WorkspaceRenameReason,
	WorkspaceRenameScope
} from '#lib/contracts/workspace-rename-contract.js'
import { setup, types } from 'xstate'
import type { EventPayload } from '../../contracts/event-payload.js'

type Values = { name: string; defaultCurrency: AccountCurrency }
type Input = FormOperationInput<Values, WorkspaceRenameScope, WorkspaceRenameObservation>
type Scope = { requestId: number; scopeRevision: number; workspace: WorkspaceRenameScope }
type Result = FormOperationResult<void, WorkspaceRenameReason>
export type WorkspaceNamingPersistence<Write> = {
	issueRename: (id: string, values: Values) => { write: Write }
	persistLocal: (write: Write) => Promise<void>
}
function formResult(
	result: WorkspaceNamingResult<Scope, Pick<Values, 'defaultCurrency'>, never>
): Result {
	const settlement = result.settlement.kind
	if (result.outcome === 'succeeded')
		return { outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' }
	if (result.outcome === 'invalid')
		return { outcome: 'failed', code: 'validationFailed', settlement: 'notStarted' }
	if (result.outcome === 'cancelled' || result.outcome === 'closed')
		return { outcome: result.outcome, settlement }
	if (result.outcome === 'invalidated') return { outcome: 'scopeChanged', settlement }
	return { outcome: 'failed', code: 'operationFailed', settlement }
}

/** Existing scoped-form policy authorizes before invoking this fixed-request persistence child. */
export function createWorkspaceNamingPersistence<Write>(
	dependencies: WorkspaceNamingPersistence<Write>
) {
	const naming = createWorkspaceNamingOperation<
		Scope,
		Pick<Values, 'defaultCurrency'>,
		never,
		Write
	>({
		// The parent readiness chart is the sole eligibility owner; this child adds no role policy.
		assess: () => ({ kind: 'allowed' }),
		issue: (request) =>
			dependencies.issueRename(request.workspaceId, {
				name: request.name,
				defaultCurrency: request.settings.defaultCurrency
			}),
		persistLocal: dependencies.persistLocal
	})
	const events0 = {
		INVALIDATE: types<EventPayload<FormChildEvent<WorkspaceRenameObservation>, 'INVALIDATE'>>(),
		CANCEL: types<EventPayload<FormChildEvent<WorkspaceRenameObservation>, 'CANCEL'>>(),
		SHUTDOWN: types<EventPayload<FormChildEvent<WorkspaceRenameObservation>, 'SHUTDOWN'>>(),
		OBSERVE: types<EventPayload<FormChildEvent<WorkspaceRenameObservation>, 'OBSERVE'>>()
	}
	type NativeEvent0 =
		| import('xstate').InferEvents<typeof events0>
		| import('xstate').DoneActorEvent<import('xstate').OutputFrom<typeof naming>>
		| import('xstate').ErrorActorEvent
	return setup({
		schemas: {
			context: types<{ input: Input; result: Result | undefined }>(),
			events: events0,
			input: types<Input>(),
			output: types<Result>(),
			children: {
				naming: types<import('xstate').ActorRefFrom<{ naming: typeof naming }['naming']>>()
			}
		},
		actors: { naming }
	}).createMachine({
		id: 'finance-workspace-naming-persistence',
		initial: 'running',
		context: ({ input }) => ({ input, result: undefined }),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing workspace settings result')
			return context.result
		},
		states: {
			running: {
				on: {
					CANCEL: (args, enq) => {
						enq.sendTo('naming', { type: 'CANCEL' })
					},
					INVALIDATE: (args, enq) => {
						enq.sendTo('naming', { type: 'INVALIDATE' })
					},
					SHUTDOWN: (args, enq) => {
						enq.sendTo('naming', { type: 'SHUTDOWN' })
					}
				},
				invoke: {
					id: 'naming',
					src: 'naming',
					input: ({
						context: {
							input: { request }
						}
					}) => {
						// Boundary invariant only; availability and schema validation already ran upstream.
						if (request.scope.organizationId === null)
							throw new Error('Missing authorized workspace')
						return {
							request: {
								scope: {
									requestId: request.id,
									scopeRevision: request.scopeRevision,
									workspace: request.scope
								},
								workspaceId: request.scope.organizationId,
								name: request.values.name,
								settings: { defaultCurrency: request.values.defaultCurrency }
							}
						}
					},
					onDone: (args) => {
						return { target: 'finished', context: { result: formResult(args.event.output) } }
					},
					onError: () => {
						return {
							target: 'finished',
							context: {
								result: { outcome: 'failed', code: 'operationFailed', settlement: 'unknown' }
							}
						}
					}
				}
			},
			finished: { type: 'final' }
		}
	})
}
