import { createActor, createStepLogic, type EventObject } from 'xstate'

/** A native mailbox collector; startup is an interpreter event, not a domain report. */
export function collectEvents<Event extends EventObject>() {
	const logic = createStepLogic<Event[], never, Event, undefined>({
		context: [],
		run: ({ context, event }) =>
			event.type === 'xstate.init' ? undefined : { context: [...context, event] }
	})
	return createActor(logic, { input: undefined }).start()
}
