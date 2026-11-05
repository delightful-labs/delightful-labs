import { afterEach, expect, it } from 'vitest'
import {
	assign,
	createActor,
	fromPromise,
	setup,
	toPromise,
	waitFor,
	type InputFrom,
	type Snapshot
} from 'xstate'
import { deferred } from '../../../../tests/helpers/deferred.js'
import {
	createProfileAvatarMachine,
	type ProfileAvatarDraft,
	type ProfileAvatarValues,
	type ProfileImageLogic,
	type ProfileImageResult
} from './profile-avatar.js'
import { profileScope, sameProfileScope } from './profile.js'
import type { ProfileObservation, ProfileReason, ProfileScope } from '../../contracts/profile.js'
import type {
	FormChildEvent,
	FormOperationInput,
	FormOperationResult
} from '../../contracts/scoped-form.js'

type ImageInput = InputFrom<ProfileImageLogic<Snapshot<ProfileImageResult>>>
type WriteInput = FormOperationInput<ProfileAvatarValues, ProfileScope, ProfileObservation>
type WriteResult = FormOperationResult<void, ProfileReason>
const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function controlled<Output, Input, Event extends { type: string }>(promise: Promise<Output>) {
	const settle = fromPromise<Output>(() => promise)
	return setup<
		{ result: Output | undefined },
		Event,
		{ settle: typeof settle },
		{},
		{},
		{},
		never,
		string,
		Input,
		Output
	>({ actors: { settle } }).createMachine({
		initial: 'pending',
		context: { result: undefined },
		output: ({ context }) => {
			if (context.result === undefined) throw new Error('Missing test result')
			return context.result
		},
		states: {
			pending: {
				invoke: {
					src: 'settle',
					onDone: { target: 'done', actions: assign({ result: ({ event }) => event.output }) },
					onError: 'failed'
				}
			},
			done: { type: 'final' },
			failed: { type: 'final' }
		}
	})
}
function fixture(draft: ProfileAvatarDraft) {
	const image = deferred<ProfileImageResult>(),
		write = deferred<WriteResult>()
	const imageCommands: string[] = [],
		writeCommands: string[] = []
	const processImage = controlled<ProfileImageResult, ImageInput, { type: 'CANCEL' | 'SHUTDOWN' }>(
		image.promise
	)
	const persistence = controlled<WriteResult, WriteInput, FormChildEvent<ProfileObservation>>(
		write.promise
	)
	const facts: ProfileObservation = {
		identityId: 'member',
		binding: {},
		sessionReady: true,
		loading: false,
		failed: false,
		profile: { id: 'profile', userId: 'member', displayName: 'before' }
	}
	const actor = createActor(
		createProfileAvatarMachine({
			processImage,
			write: persistence,
			validateBytes: () => ({ success: false }),
			scopeOf: profileScope,
			sameScope: sameProfileScope
		}),
		{
			inspect(event) {
				if (
					event.type !== '@xstate.event' ||
					!('id' in event.actorRef) ||
					!['CANCEL', 'INVALIDATE', 'SHUTDOWN'].includes(event.event.type)
				)
					return
				if (event.actorRef.id === 'processImage') imageCommands.push(event.event.type)
				if (event.actorRef.id === 'write') writeCommands.push(event.event.type)
			},
			input: {
				request: { id: 1, scope: profileScope(facts), scopeRevision: 1, values: draft },
				observation: { revision: 1, facts }
			}
		}
	)
	actors.add(actor)
	actor.start()
	return { actor, image, write, imageCommands, writeCommands, facts }
}
it('keeps the processor while cancel upgrades to shutdown, without repeating ignored commands', async () => {
	const f = fixture({
		action: 'upload',
		file: new File(['fixture'], 'avatar.png', { type: 'image/png' })
	})
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.imageCommands).toEqual(['CANCEL', 'SHUTDOWN'])
	expect(f.writeCommands).toEqual([])
	expect(f.actor.getSnapshot().status).toBe('active')
	f.image.resolve({ outcome: 'failed' })
	expect(await toPromise(f.actor)).toEqual({ outcome: 'closed', settlement: 'notStarted' })
	expect(f.actor.getSnapshot().context).toMatchObject({
		request: undefined,
		draft: undefined,
		bytes: undefined
	})
})
it('drains image processing after scope replacement without starting a write', async () => {
	const f = fixture({
		action: 'upload',
		file: new File(['fixture'], 'avatar.png', { type: 'image/png' })
	})
	f.actor.send({
		type: 'OBSERVE',
		observation: { revision: 2, facts: { ...f.facts, binding: {} } }
	})
	expect(f.imageCommands).toEqual([])
	expect(f.actor.getSnapshot().status).toBe('active')
	f.image.resolve({ outcome: 'failed' })
	expect(await toPromise(f.actor)).toEqual({ outcome: 'scopeChanged', settlement: 'notStarted' })
	expect(f.writeCommands).toEqual([])
})
it('sends scope loss and shutdown to the active write while retaining its settlement', async () => {
	const f = fixture({ action: 'remove' })
	await waitFor(f.actor, (snapshot) => snapshot.matches({ running: { flow: 'saving' } }))
	f.actor.send({
		type: 'OBSERVE',
		observation: { revision: 2, facts: { ...f.facts, binding: {} } }
	})
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.writeCommands).toEqual(['INVALIDATE', 'SHUTDOWN'])
	expect(f.actor.getSnapshot().status).toBe('active')
	f.write.resolve({ outcome: 'succeeded', value: undefined, settlement: 'locallyPersisted' })
	expect(await toPromise(f.actor)).toEqual({ outcome: 'closed', settlement: 'locallyPersisted' })
	expect(f.imageCommands).toEqual([])
})
