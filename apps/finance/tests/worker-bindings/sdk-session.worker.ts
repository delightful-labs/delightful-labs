import { actorFixture } from './actor/session.js'
import { createJazzClient } from 'jazz-tools/client'
import wasmUrl from '#jazz-wasm-binary?url'
import { brokerHostClient } from 'delightful-local-first/backend/jazz/worker-broker'
import { createFinanceAccountStore } from '../../src/lib/runtime/worker/account-store.js'
import { app } from '../../src/lib/queries.js'
import { qualifyNativeSession } from './session-qualification.js'

export type SdkCommand =
	| {
			type: 'OPEN_ACTOR'
			initial: 'device' | 'signed-out'
			scope: string
			brokerUrl: string
			hold: boolean
			data: MessagePort
			control: MessagePort
	  }
	| { type: 'ACTOR_STATE' }
	| { type: 'CREATE_ACTOR_IDENTITY' }
	| { type: 'RECOVER_ACTOR_IDENTITY' }
	| { type: 'RESTORE_ACTOR_IDENTITY'; hold: boolean }
	| { type: 'READ_ACTOR_BINDING' }
	| { type: 'CLOSE_ACTOR' }
	| { type: 'SIGN_OUT_ACTOR'; stale: boolean; hold: boolean }
	| { type: 'RELEASE_ACTOR_CHANGE' }
	| { type: 'RELEASE_ACTOR_OPEN' }
	| { type: 'DISPOSE_ACTOR' }
	| {
			type: 'OPEN'
			scope: string
			brokerUrl: string
			data: MessagePort
			control: MessagePort
			failLoader: boolean
	  }
	| { type: 'READ'; organizationId: string }
	| {
			type: 'SEED'
			organizationId: string
			accountId: string
			categoryId: string
			transactionId: string
	  }
	| { type: 'EDIT'; transactionId: string; amountMinor: number }
	| { type: 'CLOSE' }
	| { type: 'QUALIFY_SESSION' }
export type SdkReply =
	| { kind: 'actor-started' }
	| { kind: 'actor-recovered'; cleared: boolean }
	| { kind: 'actor-binding'; rows: number }
	| { kind: 'actor-state'; state: ReturnType<typeof actorFixture.state> }
	| { kind: 'actor-disposed'; receipt: Awaited<ReturnType<typeof actorFixture.dispose>> }
	| { kind: 'opened'; accountId: string; localFirst: boolean; windowPresent: boolean }
	| { kind: 'rows'; rows: { id: string; amountMinor: number; memo: string | null }[] }
	| { kind: 'saved' }
	| { kind: 'session-qualified'; report: Awaited<ReturnType<typeof qualifyNativeSession>> }
	| { kind: 'closed'; sdkClosed: boolean; hostClosed: boolean }
	| { kind: 'failed'; message: string; stack?: string }

let session: Awaited<ReturnType<typeof createJazzClient>> | undefined
let store: ReturnType<typeof createFinanceAccountStore> | undefined
let broker: ReturnType<typeof brokerHostClient> | undefined
function current() {
	const snapshot = session?.getSnapshot()
	if (!session || !snapshot?.user) throw new Error('SDK fixture session unavailable')
	return { db: session.db, accountId: snapshot.user.accountId }
}

// Disposable SDK controls, not an application runtime. The test owns operation
// order, fixture seeding and browser-process restarts through these SDK leaves.
async function execute(command: SdkCommand): Promise<SdkReply> {
	if (command.type === 'OPEN_ACTOR') {
		actorFixture.open(
			command.initial,
			command.scope,
			command.brokerUrl,
			command.hold,
			command.data,
			command.control
		)
		return { kind: 'actor-started' }
	}
	if (command.type === 'RECOVER_ACTOR_IDENTITY')
		return { kind: 'actor-recovered', cleared: await actorFixture.recover() }
	if (command.type === 'READ_ACTOR_BINDING')
		return { kind: 'actor-binding', rows: await actorFixture.readBinding() }
	if (command.type === 'DISPOSE_ACTOR')
		return { kind: 'actor-disposed', receipt: await actorFixture.dispose() }
	if (
		command.type === 'ACTOR_STATE' ||
		command.type === 'CREATE_ACTOR_IDENTITY' ||
		command.type === 'RESTORE_ACTOR_IDENTITY' ||
		command.type === 'CLOSE_ACTOR' ||
		command.type === 'SIGN_OUT_ACTOR' ||
		command.type === 'RELEASE_ACTOR_CHANGE' ||
		command.type === 'RELEASE_ACTOR_OPEN'
	) {
		if (command.type === 'CREATE_ACTOR_IDENTITY') actorFixture.createIdentity()
		if (command.type === 'RESTORE_ACTOR_IDENTITY') actorFixture.restoreIdentity(command.hold)
		if (command.type === 'CLOSE_ACTOR') actorFixture.close()
		if (command.type === 'SIGN_OUT_ACTOR') actorFixture.signOut(command.stale, command.hold)
		if (command.type === 'RELEASE_ACTOR_CHANGE') actorFixture.releaseChange()
		if (command.type === 'RELEASE_ACTOR_OPEN') actorFixture.releaseOpen()
		return { kind: 'actor-state', state: actorFixture.state() }
	}

	if (command.type === 'OPEN') {
		if (session || store || broker) throw new Error('SDK fixture already open')
		const serverUrl = new URL('/jazz', location.origin).href
		store = createFinanceAccountStore({ serverUrl, scope: command.scope, environment: 'sdk-proof' })
		broker = brokerHostClient(command.data, command.control, command.scope, {
			onOverdue: () => self.postMessage({ kind: 'failed', message: 'Broker close overdue' }),
			onBlocked: () => self.postMessage({ kind: 'failed', message: 'Broker blocked' })
		})
		session = await createJazzClient({
			serverUrl,
			scope: command.scope,
			env: 'sdk-proof',
			store,
			initial: 'device',
			localFirst: 'now',
			client: () => {
				if (command.failLoader) throw new Error('Expected SDK loader failure')
				return import('jazz-tools/local-first')
			},
			runtimeSources: {
				wasmUrl,
				brokerWorkerUrl: command.brokerUrl,
				wasmVersion: 'finance-sdk-proof-1',
				browserWorkerHost: broker
			}
		})
		const { db, accountId } = current()
		return {
			kind: 'opened',
			accountId,
			localFirst: db.isLocalFirst(),
			windowPresent: typeof window !== 'undefined'
		}
	}
	if (command.type === 'CLOSE') {
		if (!store || !broker) throw new Error('SDK fixture was not opened')
		await session?.close()
		const sdkClosed = session === undefined || session.getSnapshot().status === 'closed'
		await store.close()
		const receipt = await broker.close()
		return {
			kind: 'closed',
			sdkClosed,
			hostClosed:
				receipt.scope === broker.host.identity.scope &&
				receipt.requestId === broker.host.identity.requestId
		}
	}
	if (command.type === 'QUALIFY_SESSION') {
		if (!session) throw new Error('SDK session unavailable')
		return { kind: 'session-qualified', report: await qualifyNativeSession(session) }
	}
	const { db, accountId } = current()
	if (command.type === 'READ') {
		const rows = await db.all(app.transactions.where({ organizationId: command.organizationId }), {
			tier: 'local-first'
		})
		return {
			kind: 'rows',
			rows: rows.map(({ id, amountMinor, memo }) => ({ id, amountMinor, memo }))
		}
	}
	if (command.type === 'EDIT') {
		await db
			.update(app.transactions, command.transactionId, { amountMinor: command.amountMinor })
			.wait({ tier: 'local' })
		return { kind: 'saved' }
	}
	await db
		.insert(
			app.organizations,
			{ name: 'SDK fixture', kind: 'personal', defaultCurrency: 'USD', ownerId: accountId },
			{ id: command.organizationId }
		)
		.wait({ tier: 'local' })
	await db
		.insert(app.organizationMembers, {
			organizationId: command.organizationId,
			userId: accountId,
			role: 'owner',
			accountAccessMode: 'all'
		})
		.wait({ tier: 'local' })
	await db
		.insert(
			app.accounts,
			{ organizationId: command.organizationId, name: 'SDK ledger', kind: 'cash', currency: 'USD' },
			{ id: command.accountId }
		)
		.wait({ tier: 'local' })
	await db
		.insert(
			app.categories,
			{
				organizationId: command.organizationId,
				name: 'SDK category',
				kind: 'expense',
				isSystem: false
			},
			{ id: command.categoryId }
		)
		.wait({ tier: 'local' })
	await db
		.insert(
			app.transactions,
			{
				organizationId: command.organizationId,
				accountId: command.accountId,
				categoryId: command.categoryId,
				amountMinor: 1234,
				currency: 'USD',
				kind: 'expense',
				source: 'manual',
				bookedOn: '2026-11-16',
				memo: 'Stored in the worker'
			},
			{ id: command.transactionId }
		)
		.wait({ tier: 'local' })
	return { kind: 'saved' }
}

self.onmessage = async ({ data, ports }: MessageEvent<SdkCommand>) => {
	const reply = ports[0]
	if (!reply) return
	try {
		reply.postMessage(await execute(data))
	} catch (error) {
		reply.postMessage({
			kind: 'failed',
			message: `${data.type} (${session?.getSnapshot().status ?? 'no session'}): ${error instanceof Error ? error.message : 'SDK fixture failed'}`,
			...(error instanceof Error && error.stack ? { stack: error.stack } : {})
		} satisfies SdkReply)
	} finally {
		reply.close()
	}
}
