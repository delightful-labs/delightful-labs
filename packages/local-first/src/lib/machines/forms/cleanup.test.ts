import type { EventPayload } from '../../contracts/machine-events.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createActor, setup, toPromise, type SnapshotFrom, types } from 'xstate'
import { deferred } from '../../../../tests/helpers/deferred.js'
import { createSingleWriteFormOptions } from './policy.js'
import {
	createProfileAvailability,
	selectProfileAvailability,
	profileScope,
	sameProfileScope,
	createProfileFormOptions
} from '../identity/profile.js'
import type { ProfileObservation, ProfileReason, ProfileScope } from '../../contracts/profile.js'
import type {
	ProfileAvatarDraft,
	ProfileAvatarValues,
	ProfileImageResult
} from '../identity/profile-avatar.js'
import { persistLocal } from '../../backend/jazz/data.svelte.js'
import { zodFormIssues } from '../../validation/form-issues.js'

const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function tracked<T extends { stop(): void }>(actor: T): T {
	actors.add(actor)
	return actor
}
function observation(): ProfileObservation {
	return {
		identityId: 'member',
		binding: {},
		sessionReady: true,
		loading: false,
		failed: false,
		profile: { id: 'profile', userId: 'member', displayName: 'before' }
	}
}

describe('explicit single-write guarantees', () => {
	it.each(['locallyPersisted', 'confirmed'])(
		'keeps the declared %s result behind the host persistence promise',
		async (guarantee) => {
			const facts = observation(),
				availability = createProfileAvailability(facts.binding ?? {})
			const local = deferred<void>(),
				wait = vi.fn(() => local.promise)
			const write = vi.fn(() =>
				(guarantee === 'locallyPersisted' ? persistLocal({ wait }) : local.promise).then(
					() => 'note'
				)
			)
			const settlement = guarantee === 'confirmed' ? 'confirmed' : 'locallyPersisted'
			const options = createSingleWriteFormOptions<
				{ name: string },
				string,
				ProfileReason,
				ProfileScope,
				ProfileObservation,
				SnapshotFrom<typeof availability>
			>({
				schema: z.object({ name: z.string() }),
				settlement,
				availability,
				selectAvailability: selectProfileAvailability,
				scopeOf: profileScope,
				sameScope: sameProfileScope,
				observe: () => facts,
				classifyBlocked: () => 'unavailable',
				write
			})
			const actor = tracked(
				createActor(options.operation, {
					input: {
						request: {
							id: 1,
							scope: profileScope(facts),
							scopeRevision: 1,
							values: { name: 'notes' }
						},
						observation: { revision: 1, facts }
					}
				})
			).start()
			await vi.waitFor(() => expect(write).toHaveBeenCalledOnce())
			if (guarantee === 'locallyPersisted') expect(wait).toHaveBeenCalledWith({ tier: 'local' })
			else expect(wait).not.toHaveBeenCalled()
			expect(actor.getSnapshot().status).toBe('active')
			local.resolve()
			expect(await toPromise(actor)).toEqual({ outcome: 'succeeded', value: 'note', settlement })
		}
	)
})

describe('profile save guarantees', () => {
	it.each(['locallyPersisted', 'confirmed'])(
		'preserves %s for name and avatar saves',
		async (guarantee) => {
			const facts = observation(),
				nameSaved = deferred<void>(),
				avatarSaved = deferred<void>()
			const saveName = vi.fn(
				(_id: string, _user: string, _name: string | null) => nameSaved.promise
			)
			const saveAvatar = vi.fn(
				(_id: string, _user: string, _values: ProfileAvatarValues) => avatarSaved.promise
			)
			const imageStarted = vi.fn()
			const processImage = setup({
				schemas: {
					context: types<{}>(),
					events: {
						CANCEL: types<EventPayload<{ type: 'CANCEL' | 'SHUTDOWN' }, 'CANCEL'>>(),
						SHUTDOWN: types<EventPayload<{ type: 'CANCEL' | 'SHUTDOWN' }, 'SHUTDOWN'>>()
					},
					input: types<{
						file: File
						options: {
							maxWidth: number
							maxHeight: number
							mimeType: 'image/webp'
							quality: number
						}
					}>()
				}
			}).createMachine({
				initial: 'done',
				context: {},
				states: {
					done: {
						type: 'final',
						entry: (_args, enq) => {
							enq(() => imageStarted())
						}
					}
				},
				output: (): ProfileImageResult => ({ outcome: 'failed' })
			})
			const saveSettlement = guarantee === 'confirmed' ? 'confirmed' : 'locallyPersisted'
			const options = createProfileFormOptions({
				binding: facts.binding ?? {},
				observe: () => facts,
				saveSettlement,
				saveName,
				saveAvatar,
				nameSchema: z.object({ displayName: z.string().nullable() }),
				avatarSchema: {
					parseAsync: (): Promise<ProfileAvatarDraft> => Promise.resolve({ action: 'remove' })
				},
				avatarValuesSchema: {
					parseAsync: (): Promise<ProfileAvatarValues> =>
						Promise.resolve({ avatarData: null, avatarMimeType: null })
				},
				processImage,
				mimeType: () => 'image/png',
				validateBytes: () => ({ success: false })
			})
			const scope = profileScope(facts),
				observed = { revision: 1, facts }
			const name = tracked(
				createActor(options.name.operation, {
					input: {
						request: { id: 1, scope, scopeRevision: 1, values: { displayName: 'after' } },
						observation: observed
					}
				})
			).start()
			const avatar = tracked(
				createActor(options.avatar.operation, {
					input: {
						request: { id: 2, scope, scopeRevision: 1, values: { action: 'remove' } },
						observation: observed
					}
				})
			).start()
			await vi.waitFor(() => {
				expect(saveName).toHaveBeenCalledOnce()
				expect(saveAvatar).toHaveBeenCalledOnce()
			})
			expect(saveName).toHaveBeenCalledWith('profile', 'member', 'after')
			expect(saveAvatar).toHaveBeenCalledWith('profile', 'member', {
				avatarData: null,
				avatarMimeType: null
			})
			expect(name.getSnapshot().status).toBe('active')
			expect(avatar.getSnapshot().status).toBe('active')
			nameSaved.resolve()
			avatarSaved.resolve()
			expect(await toPromise(name)).toEqual({
				outcome: 'succeeded',
				value: undefined,
				settlement: saveSettlement
			})
			expect(await toPromise(avatar)).toEqual({
				outcome: 'succeeded',
				value: undefined,
				settlement: saveSettlement
			})
			expect(imageStarted).not.toHaveBeenCalled()
		}
	)
})

describe('optional Zod form issue adapter', () => {
	it('maps actual nested field/array paths and codes without input values or messages', () => {
		const result = z
			.object({ lines: z.array(z.object({ amount: z.number() })) })
			.safeParse({ lines: [{ amount: 'private-value' }] })
		if (result.success) throw new Error('Expected invalid field')
		const mapped = zodFormIssues(result.error)
		expect(mapped).toEqual([{ path: ['lines', 0, 'amount'], code: 'invalid_type' }])
		expect(mapped?.[0]?.path).not.toBe(result.error.issues[0]?.path)
		expect(JSON.stringify(mapped)).not.toContain('private-value')
		expect(mapped?.[0]).not.toHaveProperty('message')
	})
	it('does not copy custom messages or issue metadata', () => {
		const error = new z.ZodError([
			{
				code: 'custom',
				path: ['name'],
				message: 'private-message',
				params: { value: 'private-value' }
			}
		])
		expect(zodFormIssues(error)).toEqual([{ path: ['name'], code: 'custom' }])
	})
	it('leaves unrelated validation errors for the host adapter', () => {
		expect(zodFormIssues(new Error('other validator'))).toBeUndefined()
		expect(zodFormIssues({ issues: [] })).toBeUndefined()
	})
})
