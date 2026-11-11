/** Payload projection for the fixture-owned event protocols, including grouped names. */
export type EventPayload<Event, Type extends string> = Event extends { type: infer Name }
	? Type extends Name
		? Omit<Event, 'type'>
		: never
	: never
