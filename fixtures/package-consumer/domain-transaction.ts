import { createActor, setup, toPromise, types } from 'xstate'
import { createDomainTransaction } from 'delightful-local-first/transactions/workflow'
import type { TransactionDomainInput } from 'delightful-local-first/transactions/contracts'

type Draft = { name: string }
type Resource = { writes: string[] }
type Receipt = { id: string }
type Input = TransactionDomainInput<Draft, Resource>
const resource: Resource = { writes: [] }
const receipt: Receipt = { id: 'receipt' }
const domain = setup({
	schemas: {
		context: types<Input>(),
		input: types<Input>(),
		output: types<Receipt>(),
		events: { STAGE: types(), STAGED: types() }
	}
}).createMachine({
	context: ({ input }) => input,
	initial: 'ready',
	output: () => receipt,
	states: {
		ready: {
			entry: ({ context }, enq) =>
				enq.sendTo(context.owner, { type: 'PREPARED', assessment: { outcome: 'eligible' } }),
			on: { STAGE: { target: 'staging' } }
		},
		staging: {
			entry: ({ context, self }, enq) => {
				enq(() => {
					context.resource.writes.push(context.attempt.draft.name)
					self.send({ type: 'STAGED' })
				})
			},
			on: { STAGED: { target: 'done' } }
		},
		done: { type: 'final' }
	}
})
const actor = createActor(
	createDomainTransaction<Draft, Resource, object, Receipt>(
		(spawn, input) => spawn(domain, { input }),
		{
			open: () => resource,
			commit: () => ({}),
			persistLocal: () => {},
			rollback: () => true,
			retainDetached: () => {
				throw new Error('Unexpected custody')
			}
		}
	),
	{
		input: {
			attempt: {
				operationId: 'operation',
				workspaceId: 'workspace',
				membershipId: 'membership',
				draft: { name: 'consumer' }
			}
		}
	}
)
function checkPublicProtocol() {
	// @ts-expect-error Read/stage bridge requests are not public lifecycle commands.
	actor.send({ type: 'READ' })
	// @ts-expect-error Native mutation staging cannot bypass the domain controller.
	actor.send({ type: 'STAGE' })
}
void checkPublicProtocol
actor.start()
const result = await toPromise(actor)
if (
	result.outcome !== 'succeeded' ||
	result.settlement.kind !== 'locallyPersisted' ||
	result.settlement.workspace !== receipt ||
	resource.writes.join() !== 'consumer'
)
	throw new Error('Public domain transaction failed')
