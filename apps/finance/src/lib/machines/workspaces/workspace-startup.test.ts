import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Transaction, type schema } from 'jazz-tools'
import { app } from '../../schema.js'
import { createWorkspaceStartupMachine } from './workspace-startup.js'
import { workspaceReports } from './workspace-reports.fixture.js'
import type { InitializationStatusEvent } from '../../contracts/workspace-orchestration-contract.js'
import { creationFixture, profileId, userId, workspace } from './workspace-creation.fixture.js'

const environment = vi.hoisted(() => ({ PUBLIC_FAKE_DATA: 'false' }))
vi.mock('$app/env/public', () => environment)
beforeEach(() => {
	environment.PUBLIC_FAKE_DATA = 'false'
})

import { seedFixture } from '../samples/fake-data.fixture.js'
import { createActor, waitFor } from 'xstate'

const secondUser = '77777777-7777-4777-8777-777777777777'
const thirdUser = '88888888-8888-4888-8888-888888888888'
const profile: schema.RowOf<typeof app.profiles> = {
	id: profileId,
	userId,
	initialWorkspaceId: workspace.id,
	displayName: null,
	avatarData: null,
	avatarMimeType: null
}
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const stop of cleanups.splice(0)) stop()
})
function fixture(initial: 'ready' | 'transitioning' = 'ready') {
	const f = creationFixture()
	const discover = vi.fn().mockResolvedValue([])
	function queue() {
		const pending = Promise.withResolvers<(typeof profile)[]>()
		discover.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([])
		return pending
	}
	const first = queue()
	const recipient = workspaceReports<InitializationStatusEvent>()
	cleanups.push(() => recipient.stop())
	const actor = createActor(
		createWorkspaceStartupMachine({
			...f.db,
			all: discover,
			getConfig: vi.fn().mockReturnValue({ serverUrl: 'https://unused.invalid' })
		}),
		{ input: { request: { generation: 0, userId, status: initial }, recipient } }
	).start()
	cleanups.push(() => actor.stop())
	return { ...f, actor, discover, first, queue, reports: () => recipient.getSnapshot().context }
}

describe('startup session ownership', () => {
	it('waits for a ready session before starting initialization', () => {
		const f = fixture('transitioning')
		expect(f.discover).not.toHaveBeenCalled()
		f.actor.send({ type: 'OBSERVED', request: { generation: 1, userId, status: 'ready' } })
		expect(f.discover).toHaveBeenCalledTimes(2)
	})
	it('does not restart initialization for ordinary observations of the same identity', async () => {
		const f = fixture()
		f.first.resolve([profile])
		await waitFor(f.actor, (s) => s.matches('ready'))
		f.actor.send({ type: 'OBSERVED', request: { generation: 0, userId, status: 'ready' } })
		expect(f.discover).toHaveBeenCalledTimes(2)
		expect(f.actor.getSnapshot().hasTag('workspace-ready')).toBe(true)
	})
	it('drains old initialization writes before using the latest replacement identity', async () => {
		const f = fixture('ready')
		f.one.mockReset().mockResolvedValue(null)
		const pendingWrite = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => {
			started.resolve()
			return pendingWrite.promise
		})
		f.first.resolve([])
		await started.promise
		const next = f.queue()
		f.actor.send({
			type: 'OBSERVED',
			request: { generation: 1, userId: secondUser, status: 'ready' }
		})
		f.actor.send({
			type: 'OBSERVED',
			request: { generation: 2, userId: thirdUser, status: 'ready' }
		})
		expect(f.actor.getSnapshot().matches({ initializing: 'replacing' })).toBe(true)
		expect(f.discover).toHaveBeenCalledTimes(4)
		pendingWrite.resolve()
		await vi.waitFor(() => expect(f.discover).toHaveBeenCalledTimes(6))
		expect(f.actor.getSnapshot().context.operation?.userId).toBe(thirdUser)
		expect(f.actor.getSnapshot().hasTag('workspace-ready')).toBe(false)
		next.resolve([{ ...profile, userId: thirdUser }])
		await waitFor(f.actor, (s) => s.matches('ready'))
		expect(f.reports().at(-1)?.report).toEqual({
			request: { generation: 2, userId: thirdUser, status: 'ready' },
			status: { kind: 'ready', profileId }
		})
		expect(
			f
				.reports()
				.some(
					(event) => event.report.request.generation === 0 && event.report.status.kind === 'ready'
				)
		).toBe(false)
	})
	it('preserves shutdown over replacement, observations, retries, and late completion', async () => {
		const f = fixture('ready')
		f.one.mockReset().mockResolvedValue(null)
		const pendingWrite = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		f.wait.mockImplementation(() => {
			started.resolve()
			return pendingWrite.promise
		})
		f.first.resolve([])
		await started.promise
		f.actor.send({
			type: 'OBSERVED',
			request: { generation: 1, userId: secondUser, status: 'ready' }
		})
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({
			type: 'OBSERVED',
			request: { generation: 2, userId: thirdUser, status: 'ready' }
		})
		f.actor.send({ type: 'OBSERVED', request: { generation: 3, userId, status: 'ready' } })
		expect(f.actor.getSnapshot().status).toBe('active')
		pendingWrite.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.discover).toHaveBeenCalledTimes(4)
	})
	it('requires explicit retry after an initialization failure', async () => {
		const f = fixture()
		f.first.reject(new Error('read failed'))
		await waitFor(f.actor, (s) => s.hasTag('workspace-error'))
		f.actor.send({ type: 'OBSERVED', request: { generation: 0, userId, status: 'ready' } })
		expect(f.discover).toHaveBeenCalledTimes(2)
		const retry = f.queue()
		f.actor.send({ type: 'OBSERVED', request: { generation: 3, userId, status: 'ready' } })
		retry.resolve([profile])
		await waitFor(f.actor, (s) => s.hasTag('workspace-ready'))
		expect(f.discover).toHaveBeenCalledTimes(4)
	})
	it('cancels an outstanding read without starting a transaction', async () => {
		const f = fixture()
		f.actor.send({ type: 'SHUTDOWN' })
		f.first.resolve([profile])
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.beginTransaction).not.toHaveBeenCalled()
	})
})

function seededStartup() {
	environment.PUBLIC_FAKE_DATA = 'true'
	const seed = seedFixture()
	const creation = creationFixture()
	const reads = new Transaction('mergeable', () => {
		throw new Error('Unit fixture must not open a Jazz runtime')
	})
	const discover = vi.spyOn(reads, 'all').mockImplementation(seed.input.db.all)
	discover.mockResolvedValueOnce([profile]).mockResolvedValueOnce([])
	const recipient = workspaceReports<InitializationStatusEvent>()
	const actor = createActor(
		createWorkspaceStartupMachine({
			...seed.input.db,
			all: reads.all.bind(reads),
			beginTransaction: creation.beginTransaction,
			getConfig: () => ({ appId: userId, serverUrl: 'https://unused.invalid' })
		}),
		{ input: { request: { generation: 0, userId, status: 'ready' }, recipient } }
	)
	cleanups.push(
		() => actor.stop(),
		() => recipient.stop()
	)
	return { ...seed, actor, discover, reports: () => recipient.getSnapshot().context }
}

describe('optional seed ownership', () => {
	it('publishes readiness while authoritative seed discovery never responds', async () => {
		const f = seededStartup()
		const remote = Promise.withResolvers<never[]>()
		f.all
			.mockReset()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([])
			.mockReturnValue(remote.promise)
		f.actor.start()
		await vi.waitFor(() => expect(f.all).toHaveBeenCalledTimes(6))
		expect(f.actor.getSnapshot().hasTag('workspace-ready')).toBe(true)
		expect(f.reports().at(-1)?.report.status).toEqual({ kind: 'ready', profileId })
		expect(f.beginSerializableTransaction).not.toHaveBeenCalled()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (s) => s.status === 'done')
	})
	it('retains initialized readiness after seed failure and shuts down without waiting for a completed child', async () => {
		const f = seededStartup()
		const failure = new Error('Seed read failed')
		f.all.mockReset().mockRejectedValue(failure)
		f.actor.start()
		await waitFor(f.actor, (s) => s.matches({ ready: 'settled' }))
		expect(f.actor.getSnapshot().hasTag('workspace-ready')).toBe(true)
		expect(f.actor.getSnapshot().context.results.seedResult).toEqual({
			outcome: 'failed',
			settlement: 'notStarted',
			error: failure
		})
		expect(f.reports().at(-1)?.report.status).toEqual({ kind: 'ready', profileId })
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('done')
	})
	it('drains confirmed seed writes before initializing only the latest replacement identity', async () => {
		const f = seededStartup()
		const confirmation = Promise.withResolvers<void>()
		f.wait.mockReturnValue(confirmation.promise)
		f.actor.start()
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
		f.discover.mockResolvedValueOnce([{ ...profile, userId: thirdUser }]).mockResolvedValueOnce([])
		f.actor.send({
			type: 'OBSERVED',
			request: { generation: 1, userId: secondUser, status: 'ready' }
		})
		f.actor.send({
			type: 'OBSERVED',
			request: { generation: 2, userId: thirdUser, status: 'ready' }
		})
		expect(f.actor.getSnapshot().matches({ ready: 'replacing' })).toBe(true)
		expect(f.actor.getSnapshot().hasTag('workspace-ready')).toBe(false)
		const calls = f.discover.mock.calls.length
		expect(f.actor.getSnapshot().context.operation?.userId).toBe(userId)
		confirmation.resolve()
		await waitFor(
			f.actor,
			(s) => s.context.operation?.userId === thirdUser && s.hasTag('workspace-ready')
		)
		expect(f.discover.mock.calls.length).toBeGreaterThan(calls)
		expect(
			f
				.reports()
				.some((e) => e.report.request.userId === secondUser && e.report.status.kind === 'ready')
		).toBe(false)
		expect(f.rollback).not.toHaveBeenCalled()
	})
	it('preserves shutdown over seed replacement and late confirmation', async () => {
		const f = seededStartup()
		const confirmation = Promise.withResolvers<void>()
		f.wait.mockReturnValue(confirmation.promise)
		f.actor.start()
		await vi.waitFor(() => expect(f.wait).toHaveBeenCalledOnce())
		const calls = f.discover.mock.calls.length
		f.actor.send({
			type: 'OBSERVED',
			request: { generation: 1, userId: secondUser, status: 'ready' }
		})
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({
			type: 'OBSERVED',
			request: { generation: 2, userId: thirdUser, status: 'ready' }
		})
		expect(f.actor.getSnapshot().matches({ ready: 'closing' })).toBe(true)
		expect(f.actor.getSnapshot().hasTag('workspace-ready')).toBe(false)
		confirmation.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.discover).toHaveBeenCalledTimes(calls)
		expect(f.actor.getSnapshot().context.results.seedResult).toEqual({
			outcome: 'closed',
			settlement: 'confirmed'
		})
		expect(f.rollback).not.toHaveBeenCalled()
	})
})
