import { createCallbackLogic, setup, types, type SnapshotFrom } from 'xstate'
import type { Db as JazzDb } from 'jazz-tools'
import { app, type SyncAttempt, type SyncAccountResult } from '../../queries.js'
import { observeRows } from '../../runtime/observations.js'
import { bankObservation, selectedBankConnection } from './availability.js'
import { selectBankLogPresentation } from './history.js'
import { workerBankHistory, type WorkerBankHistory } from '../../contracts/worker-banks.js'
import {
	historyPageLimit,
	initialHistoryPage,
	nextHistoryPage,
	selectHistoryConnection,
	selectHistoryPage,
	selectHistoryAccounts
} from './history-page.js'
import type { BankSource } from './types.js'
type Input = { source: BankSource; visible: boolean }
type Profiles = WorkerBankHistory['profiles']
type Context = Input & {
	selection: { scope: string; id: string }
	page: ReturnType<typeof initialHistoryPage>
	token: object
	detailToken: object
	attempts: readonly SyncAttempt[] | null
	accounts: readonly SyncAccountResult[] | null
	profiles: Profiles | null
	failed: boolean
}
function selection(c: Context) {
	const scope = JSON.stringify([c.source.userId, c.source.organizationId])
	const selected = selectHistoryConnection(
		c.source.connections,
		c.source.organizationId ?? undefined,
		c.selection,
		scope,
		selectedBankConnection(c.source)?.id
	)
	const pageScope = JSON.stringify([scope, selected.connectionId])
	return { ...selected, scope, pageScope, limit: historyPageLimit(c.page, pageScope) }
}
function page(c: Context) {
	const s = selection(c)
	return selectHistoryPage(
		c.attempts ?? [],
		s.connections,
		c.source.organizationId,
		s.connectionId,
		s.limit
	)
}
function queryKey(c: Context) {
	const s = selection(c)
	return JSON.stringify([
		c.visible,
		bankObservation(c.source).allowed,
		s.scope,
		s.connectionId,
		s.limit
	])
}
const reset = { attempts: null, accounts: null, profiles: null, failed: false }

/** History controls and bounded subscriptions are owned alongside the bank workflow. */
export function createWorkerBankHistory(db: Pick<JazzDb, 'subscribe'>) {
	const attempts = createCallbackLogic<never, Context>(({ input, sendBack }) => {
		const s = selection(input)
		if (
			!input.visible ||
			!bankObservation(input.source).allowed ||
			!input.source.organizationId ||
			!s.connectionId
		)
			return
		let active = true
		const release = db.subscribe(
			app.simplefinSyncAttempts
				.where({ organizationId: input.source.organizationId, connectionId: s.connectionId })
				.orderBy('startedAt', 'desc')
				.orderBy('id', 'desc')
				.limit(s.limit + 1),
			{
				onUpdate: (rows) => {
					if (active) sendBack({ type: 'ATTEMPTS', token: input.token, rows: observeRows(rows) })
				},
				onError: () => {
					if (active) sendBack({ type: 'FAILED', token: input.token })
				}
			},
			{ tier: 'local-first' }
		)
		return () => {
			active = false
			release()
		}
	})
	const details = createCallbackLogic<never, Context>(({ input, sendBack }) => {
		const p = page(input),
			organizationId = input.source.organizationId
		if (!input.visible || !bankObservation(input.source).allowed || !organizationId) return
		let active = true
		const failed = () => {
			if (active) sendBack({ type: 'DETAIL_FAILED', token: input.detailToken })
		}
		const profilesUnavailable = () => {
			if (active) sendBack({ type: 'PROFILES', token: input.detailToken, rows: [] })
		}
		const releases: (() => void)[] = []
		const dispose = () => {
			active = false
			const failures: unknown[] = []
			for (const release of releases.splice(0)) {
				try {
					release()
				} catch (error) {
					failures.push(error)
				}
			}
			if (failures.length) throw new AggregateError(failures, 'Subscription cleanup failed')
		}
		try {
			const accounts = p.attemptIds.length
				? db.subscribe(
						app.simplefinSyncAccountResults.where({
							organizationId,
							attemptId: { in: p.attemptIds }
						}),
						{
							onUpdate: (rows) => {
								if (active)
									sendBack({ type: 'ACCOUNTS', token: input.detailToken, rows: observeRows(rows) })
							},
							onError: failed
						},
						{ tier: 'local-first' }
					)
				: undefined
			if (accounts) releases.push(accounts)
			if (!accounts) sendBack({ type: 'ACCOUNTS', token: input.detailToken, rows: [] })
			let profiles: (() => void) | undefined
			try {
				profiles = p.initiatorIds.length
					? db.subscribe(
							app.profiles.where({ userId: { in: p.initiatorIds } }),
							{
								onUpdate: (rows) => {
									if (active)
										sendBack({
											type: 'PROFILES',
											token: input.detailToken,
											rows: rows.map((row) => ({
												userId: row.userId,
												displayName: row.displayName ?? null
											}))
										})
								},
								onError: profilesUnavailable
							},
							{ tier: 'local-first' }
						)
					: undefined
			} catch {
				profilesUnavailable()
			}
			if (profiles) releases.push(profiles)
			if (!profiles) sendBack({ type: 'PROFILES', token: input.detailToken, rows: [] })
		} catch (error) {
			try {
				dispose()
			} finally {
				throw error
			}
		}
		return dispose
	})
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			events: {
				OBSERVE: types<Input>(),
				SELECT: types<{ connectionId: string }>(),
				EARLIER: types(),
				SHUTDOWN: types(),
				ATTEMPTS: types<{ token: object; rows: readonly SyncAttempt[] }>(),
				ACCOUNTS: types<{ token: object; rows: readonly SyncAccountResult[] }>(),
				PROFILES: types<{ token: object; rows: Profiles }>(),
				FAILED: types<{ token: object }>(),
				DETAIL_FAILED: types<{ token: object }>()
			}
		},
		actors: { attempts, details }
	}).createMachine({
		id: 'finance-worker-bank-history',
		context: ({ input }) => ({
			...input,
			selection: { scope: '', id: '' },
			page: initialHistoryPage(),
			token: {},
			detailToken: {},
			...reset
		}),
		initial: 'observing',
		on: { SHUTDOWN: { target: '.closed' } },
		states: {
			observing: {
				initial: 'details',
				invoke: { src: 'attempts', input: ({ context }) => context, onError: { target: 'failed' } },
				on: {
					OBSERVE: ({ context, event }) => {
						const next = { ...context, ...event }
						return queryKey(next) !== queryKey(context)
							? {
									target: 'observing',
									reenter: true,
									context: {
										source: event.source,
										visible: event.visible,
										token: {},
										detailToken: {},
										...reset
									}
								}
							: { context: { source: event.source, visible: event.visible } }
					},
					SELECT: ({ context, event }) => ({
						target: 'observing',
						reenter: true,
						context: {
							selection: { scope: selection(context).scope, id: event.connectionId },
							page: initialHistoryPage(),
							token: {},
							detailToken: {},
							...reset
						}
					}),
					EARLIER: ({ context }) => ({
						target: 'observing',
						reenter: true,
						context: {
							page: nextHistoryPage(context.page, selection(context).pageScope),
							token: {},
							detailToken: {},
							...reset
						}
					}),
					ACCOUNTS: ({ context, event }) =>
						event.token === context.detailToken ? { context: { accounts: event.rows } } : undefined,
					PROFILES: ({ context, event }) =>
						event.token === context.detailToken ? { context: { profiles: event.rows } } : undefined,
					FAILED: ({ context, event }) =>
						event.token === context.token ? { context: { failed: true } } : undefined,
					DETAIL_FAILED: ({ context, event }) =>
						event.token === context.detailToken ? { context: { failed: true } } : undefined
				},
				states: {
					details: {
						on: {
							// Reenter only this child. Reentering the parent also restarts
							// its attempts subscription, which immediately reports again.
							ATTEMPTS: ({ context, event }) => {
								if (event.token !== context.token) return
								const next = { ...context, attempts: event.rows }
								const before = page(context),
									after = page(next)
								const changed =
									JSON.stringify([before.attemptIds, before.initiatorIds]) !==
									JSON.stringify([after.attemptIds, after.initiatorIds])
								return changed
									? {
											target: 'details',
											reenter: true,
											context: {
												attempts: event.rows,
												detailToken: {},
												accounts: null,
												profiles: null
											}
										}
									: { context: { attempts: event.rows } }
							}
						},
						invoke: {
							src: 'details',
							input: ({ context }) => context,
							onError: { target: '#finance-worker-bank-history.failed' }
						}
					}
				}
			},
			failed: {
				on: {
					OBSERVE: ({ context, event }) =>
						queryKey({ ...context, ...event }) !== queryKey(context)
							? {
									target: 'observing',
									context: {
										source: event.source,
										visible: event.visible,
										token: {},
										detailToken: {},
										...reset
									}
								}
							: { context: { source: event.source, visible: event.visible } }
				}
			},
			closed: { type: 'final' }
		}
	})
}
export function selectWorkerBankHistory(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkerBankHistory>>
) {
	const c = snapshot.context
	if (!c.visible || !bankObservation(c.source).allowed) return null
	const s = selection(c),
		p = page(c)
	const presentation = selectBankLogPresentation({
		connections: s.connections.map(({ id, ownerId, claimedAt, status }) => ({
			id,
			ownerId,
			claimedAt,
			status
		})),
		attempts: p.attempts,
		accounts: selectHistoryAccounts(c.accounts ?? [], c.source.organizationId, p.attemptIds)
	})
	const result = workerBankHistory.safeParse({
		...presentation,
		connectionId: s.connectionId,
		profiles: c.profiles ?? [],
		hasEarlier: p.hasEarlier,
		loading: c.attempts === null || c.accounts === null || c.profiles === null,
		failed: c.failed || snapshot.matches('failed')
	})
	return result.success ? result.data : null
}

export function selectWorkerBankHistoryReport(
	snapshot: SnapshotFrom<ReturnType<typeof createWorkerBankHistory>>
) {
	return { source: snapshot.context.source, view: selectWorkerBankHistory(snapshot) }
}
