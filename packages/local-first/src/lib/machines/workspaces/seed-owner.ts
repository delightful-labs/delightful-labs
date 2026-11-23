import { setup, types, type ActorLogic, type Snapshot } from 'xstate'

/** Optional work is independent of workspace readiness and retains its own drain. */
export function createWorkspaceSeedOwner<
	Input,
	SeedInput,
	Result extends { settlement: 'notStarted' | 'confirmed' | 'unresolved' },
	S extends Snapshot<Result>
>(options: {
	seed: ActorLogic<S, { type: 'CANCEL' | 'SHUTDOWN' }, SeedInput>
	/** Pure input projection; seed policy and I/O belong to the supplied actor. */
	input: (input: Input, workspaceId: string) => SeedInput
}) {
	type Context = {
		operation: { input: Input; workspaceId: string | undefined }
		outcome: 'closed' | 'unresolved'
	}
	const model = setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<{ outcome: 'closed' | 'unresolved' }>(),
			events: { INITIALIZED: types<{ workspaceId: string }>(), SHUTDOWN: types() }
		},
		actors: { seed: options.seed }
	})
	return model.createMachine({
		id: 'workspace-optional-seed',
		context: ({ input }) => ({
			operation: { input, workspaceId: undefined },
			outcome: 'closed'
		}),
		initial: 'waiting',
		output: ({ context }) => ({ outcome: context.outcome }),
		states: {
			waiting: {
				on: {
					INITIALIZED: ({ context, event }) => ({
						target: 'running',
						context: { operation: { ...context.operation, workspaceId: event.workspaceId } }
					}),
					SHUTDOWN: { target: 'closed' }
				}
			},
			running: {
				initial: 'seeding',
				invoke: model.createInvoke<typeof options.seed, Context>({
					id: 'seed',
					src: options.seed,
					input: ({ context }) => {
						if (context.operation.workspaceId === undefined)
							throw new Error('Missing initialized workspace')
						return options.input(context.operation.input, context.operation.workspaceId)
					},
					onDone: ({ event }) =>
						event.output === undefined || event.output.settlement === 'unresolved'
							? { target: 'closed', context: { outcome: 'unresolved' } }
							: { target: 'closed' },
					onError: { target: 'closed', context: { outcome: 'unresolved' } }
				}),
				on: {
					INITIALIZED: {},
					SHUTDOWN: (_, enq) => {
						enq.sendTo('seed', { type: 'SHUTDOWN' })
						return { target: '.closing' }
					}
				},
				states: { seeding: {}, closing: { on: { SHUTDOWN: {} } } }
			},
			closed: { type: 'final' }
		}
	})
}
