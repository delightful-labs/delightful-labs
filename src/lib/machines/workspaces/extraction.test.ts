import { describe, it, expect, vi } from 'vitest'
import { createActor, setup, toPromise } from 'xstate'
import { createWorkspaceInitialization } from './initialization.js'
import { observeRow, observeRows } from '../../contracts/observation.js'
import { profileScope, sameProfileScope } from '../identity/profile.js'

const transaction = setup<
	{},
	{ type: 'CANCEL' } | { type: 'SHUTDOWN' },
	{},
	{},
	{},
	{},
	never,
	string,
	{
		db: unknown
		attempt: { profileId: string; organizationId: string }
		purpose?: 'additional' | 'bootstrap'
	},
	{ outcome: string }
>({}).createMachine({
	initial: 'done',
	states: { done: { type: 'final' } },
	output: () => ({ outcome: 'committed' })
})
describe('domain-free extracted boundaries', () => {
	it('uses initialized local provenance without requesting authority or preparing writes', async () => {
		const discover = vi.fn(async () => ({
			profiles: [{ id: 'person', initialWorkspaceId: 'notebook' }],
			organizations: [],
			serverConfigured: true
		}))
		const prepareInitial = vi.fn(async () => ({ profileId: 'person', organizationId: 'notebook' }))
		const actor = createActor(
			createWorkspaceInitialization({
				tiers: { local: 'local', authority: 'authority' },
				discover,
				prepareInitial,
				transaction
			}),
			{ input: { db: {}, userId: 'reader' } }
		).start()
		expect(await toPromise(actor)).toEqual({
			outcome: 'ready',
			profileId: 'person',
			organizationId: 'notebook'
		})
		expect(discover).toHaveBeenCalledExactlyOnceWith({ db: {}, userId: 'reader', tier: 'local' })
		expect(prepareInitial).not.toHaveBeenCalled()
	})
	it('does not bootstrap an empty offline replica', async () => {
		const prepareInitial = vi.fn(async () => ({ profileId: 'person', organizationId: 'notebook' }))
		const actor = createActor(
			createWorkspaceInitialization({
				tiers: { local: 'local', authority: 'authority' },
				discover: async () => ({ profiles: [], organizations: [], serverConfigured: false }),
				prepareInitial,
				transaction
			}),
			{ input: { db: {}, userId: 'reader' } }
		).start()
		expect(await toPromise(actor)).toEqual({
			outcome: 'unavailable',
			reason: 'authorityUnavailable'
		})
		expect(prepareInitial).not.toHaveBeenCalled()
	})
	it('keeps revisioned row fields separate from native in-place mutations', () => {
		const native = { id: 'note', title: 'before' }
		const single = observeRow(native),
			many = observeRows([native])
		native.title = 'after'
		expect(single?.title).toBe('before')
		expect(many[0]?.title).toBe('before')
		expect(observeRow(undefined)).toBeUndefined()
		expect(observeRow(null)).toBeNull()
	})
	it('treats replaced profile bindings as different scopes', () => {
		const binding = {}
		const scope = { identityId: 'reader', profileId: 'person', binding }
		expect(sameProfileScope(scope, { ...scope })).toBe(true)
		expect(sameProfileScope(scope, { ...scope, binding: {} })).toBe(false)
		expect(
			profileScope({
				binding,
				identityId: 'reader',
				sessionReady: true,
				loading: false,
				failed: false,
				profile: null
			})
		).toEqual({ ...scope, profileId: null })
	})
})
