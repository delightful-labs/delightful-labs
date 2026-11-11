import { setup, types } from 'xstate'
import type { ActorRef, Snapshot } from 'xstate'
import type {
	OwnedOperationChild,
	OwnedOperationInput,
	OwnedOperationResult
} from '../../contracts/owned-operation.js'

function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing owned operation resource')
	return value
}

/** A private controller owns the capability-spawned child and its subscription.
 * Domain interpretation and native write custody remain with their existing owners. */
function createOperationController<Input, Output, Command extends { type: string }>() {
	type Operation = OwnedOperationInput<Input, Output, Command>
	type Result = OwnedOperationResult<Output>
	type ChildReport =
		| { type: 'CHILD_DONE'; actorId: string; output: Output }
		| { type: 'CHILD_ERROR'; actorId: string; error: unknown }
	type Context = {
		record: {
			operation: Operation
			result: Result | undefined
		}
		ownership: {
			child: OwnedOperationChild<Output, Command> | undefined
			// Subscription actors have no application command protocol or output.
			subscription: ActorRef<Snapshot<unknown>, never> | undefined
		}
	}
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<Operation>(),
			output: types<Result>(),
			events: {
				DRAIN: types(),
				INTERRUPT: types<{ command: Command }>(),
				CHILD_DONE: types<{ actorId: string; output: Output }>(),
				CHILD_ERROR: types<{ actorId: string; error: unknown }>()
			}
		},
		guards: {
			ownChild: ({ context }: { context: Context }, report: ChildReport) =>
				report.actorId === context.ownership.child?.id
		},
		actions: {
			interrupt: ({ context }: { context: Context }, event: { command: Command }) =>
				required(context.ownership.child).send(event.command),
			completed: ({ context }: { context: Context }, report: { output: Output }) => ({
				context: {
					record: {
						...context.record,
						result: {
							kind: 'completed',
							operationId: context.record.operation.operationId,
							output: report.output
						} satisfies Result
					}
				}
			}),
			failed: ({ context }: { context: Context }, report: { error: unknown }) => ({
				context: {
					record: {
						...context.record,
						result: {
							kind: 'failed',
							operationId: context.record.operation.operationId,
							error: report.error
						} satisfies Result
					}
				}
			})
		}
	}).createMachine({
		id: 'owned-operation-controller',
		context: ({ input }) => ({
			record: { operation: input, result: undefined },
			ownership: { child: undefined, subscription: undefined }
		}),
		initial: 'owning',
		output: ({ context }) => required(context.record.result),
		states: {
			owning: {
				entry: ({ context }, enq) => {
					const operation = context.record.operation
					const child = operation.spawn(enq.spawn, operation.input)
					const subscription = enq.subscribeTo(child, {
						done: (output): ChildReport => ({ type: 'CHILD_DONE', actorId: child.id, output }),
						error: (error): ChildReport => ({ type: 'CHILD_ERROR', actorId: child.id, error })
					})
					return { context: { ownership: { child, subscription } } }
				},
				exit: ({ context }, enq) => {
					enq.stop(context.ownership.subscription)
					enq.stop(context.ownership.child)
					return {
						context: { ownership: { child: undefined, subscription: undefined } }
					}
				},
				onError: (args) => ({
					target: 'settled',
					context: args.actions.failed(args, args.event).context
				}),
				on: {
					CHILD_DONE: (args) => {
						if (!args.guards.ownChild(args, args.event)) return
						return {
							target: 'settled',
							context: args.actions.completed(args, args.event).context
						}
					},
					CHILD_ERROR: (args) => {
						if (!args.guards.ownChild(args, args.event)) return
						return {
							target: 'settled',
							context: args.actions.failed(args, args.event).context
						}
					}
				},
				initial: 'active',
				states: {
					active: {
						on: {
							DRAIN: { target: 'draining' },
							INTERRUPT: (args, enq) => {
								enq(args.actions.interrupt, args, args.event)
								return { target: 'draining' }
							}
						}
					},
					draining: { on: { DRAIN: {}, INTERRUPT: {} } }
				}
			},
			settled: { type: 'final' }
		}
	})
}

/** Invoke this owner around a dynamic spawn capability. Only drain/interruption
 * commands are public; child reports stay behind the controller boundary. */
export function createOwnedOperation<Input, Output, Command extends { type: string } = never>() {
	type Operation = OwnedOperationInput<Input, Output, Command>
	type Result = OwnedOperationResult<Output>
	type Context = { record: { operation: Operation; result: Result | undefined } }
	const actors = { controller: createOperationController<Input, Output, Command>() }
	return setup({
		schemas: {
			context: types<Context>(),
			input: types<Operation>(),
			output: types<Result>(),
			events: { DRAIN: types(), INTERRUPT: types<{ command: Command }>() },
			children: { controller: types<import('xstate').ActorRefFrom<typeof actors.controller>>() }
		},
		actors,
		actions: {
			finish: ({ context }: { context: Context }, result: Result) => ({
				context: { record: { ...context.record, result } }
			})
		}
	}).createMachine({
		id: 'owned-operation',
		context: ({ input }) => ({ record: { operation: input, result: undefined } }),
		initial: 'running',
		output: ({ context }) => required(context.record.result),
		states: {
			running: {
				invoke: {
					id: 'controller',
					src: 'controller',
					input: ({ context }) => context.record.operation,
					onDone: (args) => ({
						target: 'completed',
						context: args.actions.finish(args, args.event.output).context
					}),
					onError: (args) => ({
						target: 'completed',
						context: args.actions.finish(args, {
							kind: 'failed',
							operationId: args.context.record.operation.operationId,
							error: args.event.error
						}).context
					})
				},
				on: {
					DRAIN: (_, enq) => {
						enq.sendTo('controller', { type: 'DRAIN' })
					},
					INTERRUPT: ({ event }, enq) => {
						enq.sendTo('controller', event)
					}
				}
			},
			completed: { type: 'final' }
		}
	})
}
