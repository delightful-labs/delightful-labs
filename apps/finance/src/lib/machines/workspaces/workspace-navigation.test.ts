import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorkspaceNavigationMachine } from './workspace-navigation.js'
import type {
	NavigationStatusEvent,
	WorkspaceNavigationFacts
} from '../../contracts/workspace-orchestration-contract.js'
import { workspaceReports } from './workspace-reports.fixture.js'
import { scope, records } from './workspace-integrity.fixture.js'
import {
	switchedWorkspaceHref,
	workspaceHref,
	workspaceLabel,
	workspaceRoute
} from '../../domain/workspace-routes.js'
import { createActor, waitFor } from 'xstate'

const actors: { stop: () => void }[] = []
afterEach(() => actors.splice(0).forEach((actor) => actor.stop()))
const facts: WorkspaceNavigationFacts = {
	pathname: '/',
	search: '',
	hash: '',
	generation: 0,
	userId: scope.userId,
	ready: true,
	loading: false,
	error: undefined,
	access: 'ready',
	organizations: records().organizations
}
function fixture(input: WorkspaceNavigationFacts = facts, preferredWorkspaceId?: string) {
	const one = vi
		.fn()
		.mockResolvedValue(
			preferredWorkspaceId
				? { ...records().profiles[0], initialWorkspaceId: preferredWorkspaceId }
				: null
		)
	const navigate = vi.fn(
		async (_url: string, _signal: AbortSignal, _href: string, _replace: boolean) => {}
	)
	const recipient = workspaceReports<NavigationStatusEvent>()
	const actor = createActor(createWorkspaceNavigationMachine({ one }, navigate), {
		input: { facts: input, recipient }
	}).start()
	actors.push(actor, recipient)
	return { actor, one, navigate, reports: () => recipient.getSnapshot().context }
}
describe('workspace navigation public contract', () => {
	it('uses the coordinator access decision even when a workspace row is retained', () => {
		const input = { ...facts, pathname: '/expenses', search: `?workspace=${scope.organizationId}` }
		const f = fixture(input)
		expect(f.actor.getSnapshot().matches('scoped')).toBe(true)
		f.actor.send({ type: 'OBSERVED', facts: { ...input, generation: 1, access: 'denied' } })
		expect(f.reports().at(-1)?.report).toEqual({ generation: 1, status: 'unavailable' })
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it.each(['waiting', 'failed'] satisfies constAccess[])(
		'renders %s access without inventing another authorization policy',
		(access) => {
			const f = fixture({ ...facts, search: `?workspace=${scope.organizationId}`, access })
			expect(f.reports().at(-1)?.report.status).toBe(access)
		}
	)
	it('canonicalizes a sole workspace on the native route and preserves unrelated parameters', async () => {
		const f = fixture({ ...facts, pathname: '/expenses', search: '?page=2', hash: '#row' })
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate).toHaveBeenCalledWith(
			`/expenses?page=2&workspace=${scope.organizationId}#row`,
			expect.any(AbortSignal),
			'/expenses?page=2#row',
			true
		)
	})
	it('automatically scopes multiple-workspace entry using stable workspace IDs', async () => {
		const workspace = records().organizations[0]
		if (!workspace) throw new Error('Missing workspace')
		const f = fixture({
			...facts,
			organizations: [workspace, { ...workspace, id: scope.profileId }]
		})
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls[0]?.[0]).toBe(workspaceHref(scope.profileId))
	})
	it('resolves an automatic empty-catalog chooser when a sole workspace arrives later', async () => {
		const origin = {
			...facts,
			pathname: '/expenses',
			search: '?page=2',
			hash: '#row',
			organizations: []
		}
		const f = fixture(origin)
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls[0]?.[0]).toBe('/settings/workspace')
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...origin, pathname: '/settings/workspace', search: '', hash: '', generation: 1 }
		})
		expect(f.actor.getSnapshot().matches('directory')).toBe(true)
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, pathname: '/settings/workspace', generation: 2 }
		})
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate).toHaveBeenLastCalledWith(
			`/expenses?page=2&workspace=${scope.organizationId}#row`,
			expect.any(AbortSignal),
			'/settings/workspace',
			true
		)
	})
	it('handles the sole workspace arriving before the automatic chooser navigation completes', async () => {
		const pending = Promise.withResolvers<void>()
		const f = fixture({ ...facts, ready: false, organizations: [] })
		f.navigate.mockImplementation(() => pending.promise)
		f.actor.send({ type: 'OBSERVED', facts: { ...facts, organizations: [] } })
		f.actor.send({ type: 'OBSERVED', facts: { ...facts, generation: 1 } })
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, pathname: '/settings/workspace', generation: 2 }
		})
		pending.resolve()
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls.map(([destination]) => destination)).toEqual([
			'/settings/workspace',
			workspaceHref(scope.organizationId)
		])
	})
	it('does not resolve an automatic chooser while the arriving catalog is loading or failed', async () => {
		const f = fixture({ ...facts, organizations: [] })
		await waitFor(f.actor, (s) => s.matches('settled'))
		for (const state of [
			{ loading: true, error: undefined },
			{ loading: false, error: new Error('Catalog failed') }
		]) {
			f.actor.send({
				type: 'OBSERVED',
				facts: { ...facts, ...state, pathname: '/settings/workspace' }
			})
			expect(f.actor.getSnapshot().matches('directory')).toBe(true)
		}
		expect(f.navigate).toHaveBeenCalledTimes(1)
		f.actor.send({ type: 'OBSERVED', facts: { ...facts, pathname: '/settings/workspace' } })
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls.at(-1)?.[0]).toBe(workspaceHref(scope.organizationId))
	})
	it.each(['identity', 'session', 'route', 'selection'])(
		'discards automatic empty-entry intent after a %s change',
		async (change) => {
			const f = fixture({ ...facts, organizations: [] })
			await waitFor(f.actor, (s) => s.matches('settled'))
			const directory = { ...facts, pathname: '/settings/workspace', organizations: [] }
			f.actor.send({ type: 'OBSERVED', facts: directory })
			if (change === 'selection') {
				f.actor.send({ type: 'SELECT', workspaceId: scope.organizationId })
				await waitFor(f.actor, (s) => s.matches('settled'))
			} else {
				const workspace = facts.organizations[0]
				if (!workspace) throw new Error('Missing workspace')
				f.actor.send({
					type: 'OBSERVED',
					facts: {
						...directory,
						userId: change === 'identity' ? scope.profileId : facts.userId,
						ready: change !== 'session',
						pathname: change === 'route' ? '/account' : directory.pathname,
						organizations: []
					}
				})
			}
			f.actor.send({ type: 'OBSERVED', facts: { ...facts, pathname: '/settings/workspace' } })
			await waitFor(f.actor, (s) => s.matches('settled'))
			expect(f.navigate.mock.calls.at(-1)?.[0]).toBe(
				workspaceHref(scope.organizationId, '/settings/workspace')
			)
		}
	)
	it('prefers the accessible initial workspace over the stable fallback', async () => {
		const workspace = records().organizations[0]
		if (!workspace) throw new Error('Missing workspace')
		const f = fixture(
			{
				...facts,
				pathname: '/expenses',
				search: '?page=2',
				organizations: [workspace, { ...workspace, id: scope.profileId }]
			},
			scope.organizationId
		)
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls[0]?.[0]).toBe(`/expenses?page=2&workspace=${scope.organizationId}`)
	})
	it('falls back when the preferred workspace is no longer accessible', async () => {
		const workspace = records().organizations[0]
		if (!workspace) throw new Error('Missing workspace')
		const f = fixture(
			{ ...facts, organizations: [workspace, { ...workspace, id: scope.profileId }] },
			scope.userId
		)
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls[0]?.[0]).toBe(workspaceHref(scope.profileId))
	})
	it('resolves an unscoped chooser automatically', async () => {
		const f = fixture({ ...facts, pathname: '/settings/workspace' })
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls[0]?.[0]).toBe(
			workspaceHref(scope.organizationId, '/settings/workspace')
		)
	})
	it('preserves empty-catalog route intent when several workspaces arrive', async () => {
		const workspace = records().organizations[0]
		if (!workspace) throw new Error('Missing workspace')
		const f = fixture(
			{ ...facts, pathname: '/expenses', search: '?page=2', organizations: [] },
			scope.organizationId
		)
		await waitFor(f.actor, (s) => s.matches('settled'))
		f.actor.send({
			type: 'OBSERVED',
			facts: {
				...facts,
				pathname: '/settings/workspace',
				organizations: [workspace, { ...workspace, id: scope.profileId }]
			}
		})
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls.at(-1)?.[0]).toBe(
			`/expenses?page=2&workspace=${scope.organizationId}`
		)
	})
	it('never redirects a denied explicit scope to another workspace', () => {
		const f = fixture({
			...facts,
			pathname: '/expenses',
			search: `?workspace=${scope.profileId}`,
			access: 'denied'
		})
		expect(f.reports().at(-1)?.report.status).toBe('unavailable')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it.each(['/settings/workspace', '/account', '/login'])(
		'keeps %s independent of ledger selection',
		(pathname) => {
			const f = fixture({
				...facts,
				pathname,
				search: `?workspace=${scope.organizationId}`,
				access: 'denied'
			})
			expect(f.reports().at(-1)?.report.status).toBe(
				pathname === '/settings/workspace' ? 'directory' : 'global'
			)
			expect(f.navigate).not.toHaveBeenCalled()
		}
	)
	it.each(['/settings/workspace', '/account', '/login'])(
		'keeps %s available during catalog loading or failure, but requires identity readiness',
		(pathname) => {
			const f = fixture({ ...facts, pathname, loading: true, organizations: [], access: 'waiting' })
			const status = pathname === '/settings/workspace' ? 'directory' : 'global'
			expect(f.reports().at(-1)?.report.status).toBe(status)
			f.actor.send({
				type: 'OBSERVED',
				facts: {
					...facts,
					pathname,
					generation: 1,
					error: new Error('Catalog failed'),
					access: 'failed'
				}
			})
			expect(f.reports().at(-1)?.report).toEqual({ generation: 1, status })
			f.actor.send({ type: 'OBSERVED', facts: { ...facts, pathname, generation: 2, ready: false } })
			expect(f.reports().at(-1)?.report.status).toBe('waiting')
			expect(f.navigate).not.toHaveBeenCalled()
			expect(f.one).not.toHaveBeenCalled()
		}
	)
	it('keeps ledger routes gated by catalog loading and failure', () => {
		const input = { ...facts, pathname: '/expenses', search: `?workspace=${scope.organizationId}` }
		const f = fixture({ ...input, loading: true })
		expect(f.reports().at(-1)?.report.status).toBe('waiting')
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...input, generation: 1, error: new Error('Catalog failed') }
		})
		expect(f.reports().at(-1)?.report.status).toBe('failed')
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('records manual switches in history and leaves unfinished transaction entry', async () => {
		const f = fixture({
			...facts,
			pathname: '/expenses/new',
			search: `?workspace=${scope.organizationId}&page=4&filter=recent`,
			hash: '#form'
		})
		f.actor.send({ type: 'SELECT', workspaceId: scope.profileId })
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate).toHaveBeenCalledWith(
			`/expenses?workspace=${scope.profileId}&filter=recent`,
			expect.any(AbortSignal),
			`/expenses/new?workspace=${scope.organizationId}&page=4&filter=recent#form`,
			false
		)
	})
	it('resolves a legacy detail through its readable owning workspace', async () => {
		const pending = Promise.withResolvers<{ organizationId: string } | null>()
		const f = fixture({ ...facts, ready: false, pathname: '/income/entry' })
		f.one.mockReturnValue(pending.promise)
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, generation: 1, pathname: '/income/entry' }
		})
		pending.resolve({ organizationId: scope.organizationId })
		await waitFor(f.actor, (s) => s.matches('settled'))
		expect(f.navigate.mock.calls[0]?.[0]).toBe(workspaceHref(scope.organizationId, '/income/entry'))
	})
	it('discards legacy lookup results after a query-only scope change', async () => {
		const pending = Promise.withResolvers<{ organizationId: string } | null>()
		const f = fixture({ ...facts, ready: false, pathname: '/expenses/entry' })
		f.one.mockReturnValue(pending.promise)
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, generation: 1, pathname: '/expenses/entry' }
		})
		f.actor.send({
			type: 'OBSERVED',
			facts: {
				...facts,
				generation: 2,
				pathname: '/expenses/entry',
				search: `?workspace=${scope.profileId}`,
				access: 'denied'
			}
		})
		pending.resolve({ organizationId: scope.organizationId })
		await pending.promise
		await Promise.resolve()
		expect(f.reports().at(-1)?.report).toEqual({ generation: 2, status: 'unavailable' })
		expect(f.navigate).not.toHaveBeenCalled()
	})
	it('refreshes in-flight reports without restarting the same lookup', async () => {
		const pending = Promise.withResolvers<{ organizationId: string } | null>()
		const f = fixture({ ...facts, ready: false, pathname: '/expenses/entry' })
		f.one.mockReturnValue(pending.promise)
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, generation: 1, pathname: '/expenses/entry' }
		})
		f.actor.send({
			type: 'OBSERVED',
			facts: { ...facts, generation: 2, pathname: '/expenses/entry' }
		})
		expect(f.reports().at(-1)?.report).toEqual({ generation: 2, status: 'waiting' })
		expect(f.one).toHaveBeenCalledTimes(1)
		f.actor.send({ type: 'SHUTDOWN' })
		pending.resolve({ organizationId: scope.organizationId })
		await pending.promise
		expect(f.actor.getSnapshot().status).toBe('done')
		expect(f.navigate).not.toHaveBeenCalled()
	})
})
type constAccess = 'waiting' | 'failed'

describe('workspace query URLs', () => {
	it('reads query scope and fails closed for malformed, empty and duplicate parameters', () => {
		expect(workspaceRoute(`?workspace=${scope.organizationId}`)).toMatchObject({
			workspaceId: scope.organizationId,
			scoped: true
		})
		for (const search of [
			'?workspace=not-a-uuid',
			'?workspace=',
			`?workspace=${scope.organizationId}&workspace=${scope.organizationId}`
		]) {
			expect(workspaceRoute(search)).toMatchObject({ workspaceId: null, scoped: true })
		}
		expect(workspaceRoute('?page=2').scoped).toBe(false)
	})
	it('switches detail routes to lists while removing pagination and obsolete fragments', () => {
		expect(
			switchedWorkspaceHref(
				scope.profileId,
				'/income/entry',
				`?workspace=${scope.organizationId}&page=3&tag=food`,
				'#entry'
			)
		).toBe(`/income?workspace=${scope.profileId}&tag=food`)
		expect(switchedWorkspaceHref(scope.profileId, '/expenses/new')).toBe(
			workspaceHref(scope.profileId, '/expenses')
		)
	})
	it.each(['/settings/workspace', '/account', '/login', '/expenses', '/settings/categories'])(
		'preserves %s when switching workspace through the shared URL policy',
		(pathname) => {
			expect(
				switchedWorkspaceHref(
					scope.profileId,
					pathname,
					`?workspace=${scope.organizationId}&page=3&tag=food`,
					'#section'
				)
			).toBe(`${pathname}?workspace=${scope.profileId}&tag=food#section`)
		}
	)
	it('disambiguates duplicate names with their workspace IDs', () => {
		expect(
			workspaceLabel({ id: scope.organizationId, name: 'Same' }, [
				{ name: 'Same' },
				{ name: 'Same' }
			])
		).toContain(scope.organizationId)
	})
})
