/** Select a payload even when a protocol groups several event names in one union member. */
export type EventPayload<Event, Type extends string> = Event extends { type: infer Name }
	? Type extends Name
		? Omit<Event, 'type'>
		: never
	: never
