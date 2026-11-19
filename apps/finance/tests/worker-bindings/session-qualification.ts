import type { JazzClient, JazzSession } from 'jazz-tools/client'
import { createJazzRecoveryAdapter } from 'delightful-local-first/backend/jazz/recovery'
import { createJazzRestorationAdapter } from 'delightful-local-first/backend/jazz/restoration'
import { createJazzSessionReadinessAdapter } from 'delightful-local-first/backend/jazz/session-readiness'
import type {
	AvailableRecoveryScope,
	RecoveryScope
} from 'delightful-local-first/recovery/contracts'

function available(scope: RecoveryScope): AvailableRecoveryScope {
	if (scope.kind !== 'available') throw new Error('Native session recovery unavailable')
	return scope
}

// Test controls own SDK operation order. Return observations only: no phrase,
// device key, raw user, client or session crosses back to the browser test.
export async function qualifyNativeSession(session: JazzSession<JazzClient>) {
	let current: JazzSession<unknown> | undefined = session
	let getterFails = false
	const recovery = createJazzRecoveryAdapter(() => {
		if (getterFails) throw new Error('Expected session getter failure')
		return current
	})
	const restoration = createJazzRestorationAdapter(session, () => current)
	const readiness = createJazzSessionReadinessAdapter(session)
	const seen = new Set<string>()
	const stop = readiness.capability.subscribe(() => seen.add(readiness.capability.readStatus()))
	const firstUser = session.getSnapshot().user
	const first = available(recovery.observeSession())
	const phrase = await recovery.capability.readPhrase(first)
	const key = await restoration.capability.parsePhrase(phrase)
	const exportMatchesNative = key === session.exportDeviceKey()
	const userStable = session.getSnapshot().user === firstUser && recovery.observeSession() === first
	const scope = { binding: restoration.binding, attempt: 1 }
	await restoration.capability.restoreIdentity(scope, key)
	const sameAccount = available(recovery.observeSession())
	const sameAccountRetiresScope =
		sameAccount.identityId === first.identityId &&
		sameAccount.generation > first.generation &&
		session.getSnapshot().user !== firstUser &&
		!recovery.capability.isCurrentScope(first)
	await session.createDeviceAccount()
	const replacedBeforeObservation = !recovery.capability.isCurrentScope(sameAccount)
	const second = available(recovery.observeSession())
	await restoration.capability.restoreIdentity(scope, key)
	const restored = available(recovery.observeSession())
	const abaRetiresScopes =
		second.identityId !== first.identityId &&
		restored.identityId === first.identityId &&
		restored.generation > second.generation &&
		!recovery.capability.isCurrentScope(first) &&
		!recovery.capability.isCurrentScope(second) &&
		recovery.capability.isCurrentScope(restored)
	const restoredIdentity = await restoration.capability.readIdentity(scope)
	const restorationReportsCurrent =
		restoredIdentity.kind === 'ready' && restoredIdentity.identityId === restored.identityId
	await session.signOut()
	const signedOutIdentity = await restoration.capability.readIdentity(scope)
	const signedOutUnavailable =
		readiness.capability.readStatus() === 'signed-out' &&
		signedOutIdentity.kind === 'unavailable' &&
		!recovery.capability.isCurrentScope(restored) &&
		recovery.observeSession().kind === 'unavailable'
	const staleReadRejected = await recovery.capability.readPhrase(restored).then(
		() => false,
		(error) => error instanceof Error && error.message === 'Recovery scope unavailable'
	)
	await session.reopenDeviceAccount()
	const reopened = available(recovery.observeSession())
	const reopenedSameAccount =
		readiness.capability.readStatus() === 'ready' &&
		reopened.identityId === first.identityId &&
		reopened.generation > restored.generation
	getterFails = true
	const getterFailureRejected = !recovery.capability.isCurrentScope(reopened)
	getterFails = false
	current = undefined
	const replacedSessionRejected =
		!recovery.capability.isCurrentScope(reopened) &&
		!restoration.capability.isCurrentBinding(restoration.binding)
	current = session
	const other = createJazzRecoveryAdapter(() => session)
	other.observeSession()
	const foreignScopeRejected = !other.capability.isCurrentScope(reopened)
	const beforeInvalidate = session.getSnapshot().user
	const invalidationPure =
		recovery.invalidate().kind === 'unavailable' &&
		!recovery.capability.isCurrentScope(reopened) &&
		session.getSnapshot().user === beforeInvalidate &&
		session.getSnapshot().status === 'ready'
	restoration.invalidate()
	const invalidRestorationRejected = await restoration.capability.restoreIdentity(scope, key).then(
		() => false,
		(error) => error instanceof Error && error.message === 'Restoration binding unavailable'
	)
	stop()
	const observedStatuses = seen.has('ready') && seen.has('signed-out')
	return {
		observedStatuses,
		exportMatchesNative,
		userStable,
		sameAccountRetiresScope,
		replacedBeforeObservation,
		abaRetiresScopes,
		restorationReportsCurrent,
		signedOutUnavailable,
		staleReadRejected,
		reopenedSameAccount,
		getterFailureRejected,
		replacedSessionRejected,
		foreignScopeRejected,
		invalidationPure,
		invalidRestorationRejected
	}
}
