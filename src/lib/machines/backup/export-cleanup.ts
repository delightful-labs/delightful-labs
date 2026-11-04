import { assign, fromCallback, sendTo, setup } from 'xstate'
import {
	exportData,
	takeExportCleanup,
	isArchiveExportError,
	type ArchiveExportRequest,
	type ArchiveExportCleanupResult,
	type ExportCleanupCustody
} from '../../backup/export.js'

type Input = { request: ArchiveExportRequest }
type Event =
	| { type: 'CUSTODY_READY'; hasLease: boolean }
	| { type: 'CLEANED' }
	| { type: 'CLEANUP_FAILED'; code: 'exportInUse' | 'captureCleanupFailed' | 'exportFailed' }
type Context = Input & { result: ArchiveExportCleanupResult }

/** A single uninterruptible native release. Custody stays here until the actual call settles. */
const release = fromCallback<{ type: 'RELEASE_LEASE' }, Input>(({ input, sendBack, receive }) => {
	let report: ((event: Event) => void) | undefined = sendBack
	let owned: ExportCleanupCustody | undefined
	try {
		owned = takeExportCleanup(input.request)
		report({ type: 'CUSTODY_READY', hasLease: owned.lease !== undefined })
	} catch (error) {
		report({
			type: 'CLEANUP_FAILED',
			code:
				isArchiveExportError(error) && error.code === 'exportInUse' ? 'exportInUse' : 'exportFailed'
		})
	}
	receive(() => {
		const custody = owned
		if (custody === undefined) return
		owned = undefined
		const lease = custody.lease
		void Promise.resolve()
			.then(() => lease?.release())
			.then(
				() => {
					custody.lease = undefined
					exportData(input.request).cleanup = custody
					report?.({ type: 'CLEANED' })
				},
				() => {
					exportData(input.request).cleanup = custody
					report?.({ type: 'CLEANUP_FAILED', code: 'captureCleanupFailed' })
				}
			)
	})
	return () => {
		report = undefined
		// Stop before issue returns the resource; stop after issue cannot cancel native release.
		if (owned !== undefined) exportData(input.request).cleanup = owned
	}
})

/** Caller-owned root for one explicit cleanup attempt; never restarts capture or handoff. */
export function createArchiveExportCleanupMachine() {
	const actors = { release }
	return setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		ArchiveExportCleanupResult
	>({ actors }).createMachine({
		id: 'archive-export-cleanup',
		initial: 'claiming',
		context: ({ input }) => ({ ...input, result: { outcome: 'cleaned' } }),
		invoke: {
			id: 'release',
			src: 'release',
			input: ({ context }) => ({ request: context.request }),
			onError: {
				target: '.complete',
				actions: assign({ result: { outcome: 'failed', code: 'exportFailed' } })
			}
		},
		output: ({ context }) => context.result,
		on: {
			CLEANUP_FAILED: {
				target: '.complete',
				actions: assign({ result: ({ event }) => ({ outcome: 'failed', code: event.code }) })
			}
		},
		states: {
			claiming: {
				on: {
					CUSTODY_READY: [
						{ guard: ({ event }) => event.hasLease, target: 'releasing' },
						{ target: 'complete' }
					]
				}
			},
			releasing: {
				entry: sendTo('release', { type: 'RELEASE_LEASE' }),
				on: { CLEANED: 'complete' }
			},
			complete: { type: 'final' }
		}
	})
}
