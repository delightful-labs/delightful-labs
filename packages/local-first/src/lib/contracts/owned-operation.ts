import type { ActorInstance, EnqueueObject, Snapshot, SystemRegistry } from 'xstate'

/** A concrete capability keeps the child's full input and sendable commands. */
export type OperationChildSpawner = EnqueueObject<never, never, SystemRegistry, {}>['spawn']
export type OwnedOperationChild<Output, Command extends { type: string }> = ActorInstance<
	Snapshot<Output>,
	Command
>
export type OwnedOperationSpawner<Input, Output, Command extends { type: string }> = (
	spawn: OperationChildSpawner,
	input: Input
) => OwnedOperationChild<Output, Command>

export type OwnedOperationInput<
	Input,
	Output,
	Command extends { type: string } = never
> = Readonly<{
	operationId: string
	input: Input
	spawn: OwnedOperationSpawner<Input, Output, Command>
}>

/** DRAIN waits without a child command; INTERRUPT forwards one supported command. */
export type OwnedOperationCommand<Command extends { type: string }> =
	| { type: 'DRAIN' }
	| { type: 'INTERRUPT'; command: Command }

/** Completion preserves the child's output verbatim, including unknown settlement. */
export type OwnedOperationResult<Output> =
	| { kind: 'completed'; operationId: string; output: Output }
	| { kind: 'failed'; operationId: string; error: unknown }
