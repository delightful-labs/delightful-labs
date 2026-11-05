import { createActor } from 'xstate'
import type { ArchivePayload, PayloadLimits } from 'delightful-local-first/backup/archive'
import type { ArchiveCaptureLease, BackupBinding } from 'delightful-local-first/backup/export'
import { createTestAppData, createTestAppWrite } from './source-data.js'
import {
	createTestAppSourceMachine,
	type TestAppReply,
	type TestAppSourceEvent
} from './machines/source.js'

/** Fixture-owned, unstarted source root. Its host lifetime spans successive writes/exports. */
export function createTestAppSource(payload: unknown, binding: BackupBinding) {
	const actor = createActor(createTestAppSourceMachine(), {
		input: { data: createTestAppData(payload), binding }
	})
	function ready() {
		const snapshot = actor.getSnapshot()
		return snapshot.status === 'active' && snapshot.hasTag('acceptingCommands')
	}
	function request<T>(event: (reply: TestAppReply<T>) => TestAppSourceEvent): T {
		if (!ready()) throw new Error('Test app source unavailable')
		const observation: { result: Parameters<TestAppReply<T>>[0] | undefined } = {
			result: undefined
		}
		actor.send(
			event((result) => {
				observation.result = result
			})
		)
		const result = observation.result
		if (result === undefined) throw new Error('Test app source unavailable')
		if (!result.ok) throw result.error
		return result.value
	}
	return {
		actor,
		observeBinding(binding: BackupBinding) {
			request<void>((reply) => ({ type: 'OBSERVE_BINDING', binding, reply }))
		},
		replace(payload: unknown) {
			request<void>((reply) => ({ type: 'REPLACE', write: createTestAppWrite(payload), reply }))
		},
		checkAuthority(binding: BackupBinding, signal: AbortSignal): Promise<boolean> {
			if (!ready()) return Promise.resolve(false)
			return Promise.resolve(
				request<boolean>((reply) => ({ type: 'AUTHORITY', binding, signal, reply }))
			)
		},
		acquire(binding: BackupBinding, signal: AbortSignal): Promise<ArchiveCaptureLease> {
			const expected = Object.freeze({ ...binding })
			const owner = Object.freeze({
				toJSON: (): { kind: 'testAppLease' } => ({ kind: 'testAppLease' })
			})
			request<void>((reply) => ({ type: 'ACQUIRE', owner, binding: expected, signal, reply }))
			const lease: ArchiveCaptureLease = Object.freeze({
				drain: (signal: AbortSignal) =>
					Promise.resolve(
						request<void>((reply) => ({ type: 'DRAIN', owner, binding: expected, signal, reply }))
					),
				read: (signal: AbortSignal, limits: PayloadLimits) =>
					Promise.resolve(
						request<ArchivePayload>((reply) => ({
							type: 'READ',
							owner,
							binding: expected,
							signal,
							limits,
							reply
						}))
					),
				checkConsistency: (signal: AbortSignal) =>
					!ready()
						? Promise.resolve(false)
						: Promise.resolve(
								request<boolean>((reply) => ({
									type: 'CONSISTENCY',
									owner,
									binding: expected,
									signal,
									reply
								}))
							),
				release: () => {
					if (ready()) request<void>((reply) => ({ type: 'RELEASE', owner, reply }))
					return Promise.resolve()
				}
			})
			return Promise.resolve(lease)
		}
	}
}
