/** Apply terminal cleanup before entering an inert final state. Effects remain queued by its owner. */
export function finalizeContext<Context>(
	context: Context,
	patch: Partial<Context> | undefined,
	finalize: (context: Context) => void | {
		context?: Partial<Context>
	}
): Context {
	const updated = { ...context, ...patch }
	const result = finalize(updated)
	return { ...updated, ...result?.context }
}

/** Keep terminal effects explicit in transitions without repeating their merge/queue wiring. */
export function createFinalTransitions<
	Context,
	Args extends { context: Context },
	Queue,
	Name extends string
>(finalizers: Record<Name, (args: Args, queue: Queue) => void | { context?: Partial<Context> }>) {
	return <Transition extends { target: string; context?: Partial<Context> }>(
		name: Name,
		args: Args,
		queue: Queue,
		transition: Transition
	) => ({
		...transition,
		context: finalizeContext(args.context, transition.context, (context) =>
			finalizers[name]({ ...args, context }, queue)
		)
	})
}
