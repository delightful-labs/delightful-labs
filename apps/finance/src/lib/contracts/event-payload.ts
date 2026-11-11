/** Payload for one event type, including union members that share several type
 * names. Distribute before omitting the discriminator so variant fields survive. */
export type EventPayload<
	Event extends { type: string },
	Type extends Event['type']
> = Event extends unknown ? (Type extends Event['type'] ? Omit<Event, 'type'> : never) : never
