import type { AccountStoreStorage } from './account-store-contracts.js'
import {
	earlierSelection,
	parseAccountSelection,
	type AccountStorageBinding,
	type EarlierSelection
} from '../../runtime/worker/account-selection.js'
import { setup, types, createAsyncLogic } from 'xstate'

type Input = { binding: AccountStorageBinding; storage: AccountStoreStorage }
type Context = Input & { value: string | null }
const actors = {
	snapshot: createAsyncLogic({
		run: ({ input }: { input: AccountStoreStorage }) => input.readSnapshot()
	})
}
/** Select existing identity facts only: primary, one readable earlier store, or
 * no selection. Initialization/identity creation remains the SDK owner's decision. */
export const accountStoreReadMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<Input>(),
		output: types<{ value: string | null }>(),
		children: { snapshot: types<import('xstate').ActorRefFrom<typeof actors.snapshot>>() }
	},
	actors,
	guards: {
		hasPrimarySelection: (_, params: { value: string | null }) => params.value !== null,
		hasReadableEarlierSelection: (_, params: { entry: EarlierSelection | undefined }) =>
			!!params.entry && !!parseAccountSelection(params.entry.value)
	}
}).createMachine({
	id: 'finance-account-store-read',
	initial: 'reading',
	context: ({ input }) => ({ ...input, value: null }),
	output: ({ context }) => ({ value: context.value }),
	states: {
		reading: {
			invoke: {
				id: 'snapshot',
				src: 'snapshot',
				input: ({ context }) => context.storage,
				onDone: (args) => {
					const facts = args.event.output
					if (args.guards.hasPrimarySelection(args, { value: facts.current }))
						return { target: 'done', context: { value: facts.current } }
					const entry = earlierSelection(args.context.binding, facts.earlier)
					if (args.guards.hasReadableEarlierSelection(args, { entry }))
						return { target: 'done', context: { value: entry?.value ?? null } }
					return { target: 'done', context: { value: null } }
				}
			}
		},
		done: { type: 'final' }
	}
})
