import { assign, fromPromise, setup } from 'xstate'
import {
	exportFailure,
	validateCapturedExport,
	type ArchiveCaptureResult,
	type ArchiveExportInterruption,
	type ArchiveExportRequest,
	type BackupBinding
} from '../../backup/export.js'

import {
	abortExport,
	observeExportAuthority,
	acquireExportLease,
	drainExportWriters,
	readExportGraph,
	observeExportConsistency,
	releaseExportLease
} from '../../backup/export-native.js'

export type ArchiveExportInput = { request: ArchiveExportRequest }
export type ArchiveExportControl =
	| { type: 'CANCEL' | 'SHUTDOWN' }
	| { type: 'INVALIDATE'; binding: BackupBinding }
export type ArchiveExportEvent =
	| ArchiveExportControl
	| { type: 'RETRY_HANDOFF'; binding: BackupBinding }
type Context = ArchiveExportInput & {
	interruption: ArchiveExportInterruption | undefined
	failure: ReturnType<typeof exportFailure> | undefined
}

/** Invoked only by the claimed export owner. Payloads and leases never enter actor snapshots. */
export function createArchiveCaptureMachine() {
	function leaf<Output>(run: (request: ArchiveExportRequest) => Output | Promise<Output>) {
		return fromPromise<Output, ArchiveExportInput>(({ input }) =>
			Promise.resolve(run(input.request))
		)
	}
	const actors = {
		authority: leaf((request) => observeExportAuthority(request)),
		acquire: leaf((request) => acquireExportLease(request)),
		drain: leaf((request) => drainExportWriters(request)),
		read: leaf((request) => readExportGraph(request)),
		validate: leaf((request) => validateCapturedExport(request)),
		consistency: leaf((request) => observeExportConsistency(request)),
		release: leaf((request) => releaseExportLease(request))
	}
	const model = setup<
		Context,
		{ type: 'CANCEL' | 'SHUTDOWN' },
		typeof actors,
		{},
		{ fail: undefined; abort: undefined },
		{ interrupted: undefined },
		never,
		string,
		ArchiveExportInput,
		ArchiveCaptureResult
	>({
		actors,
		guards: {
			interrupted: ({ context }) => context.interruption !== undefined
		},
		actions: {
			fail: assign({
				failure: ({ event }) => exportFailure('error' in event ? event.error : undefined)
			}),
			abort: ({ context }) => abortExport(context.request)
		}
	})
	const input = ({ context }: { context: Context }) => ({ request: context.request })
	const failed = { target: 'releasing', actions: 'fail' } satisfies {
		target: string
		actions: 'fail'
	}
	const advance = (
		target: string
	): ({ guard: 'interrupted'; target: string } | { target: string })[] => [
		{ guard: 'interrupted', target: 'releasing' },
		{ target }
	]
	return model.createMachine({
		id: 'archive-capture',
		initial: 'checkingAuthority',
		context: ({ input }) => ({ ...input, interruption: undefined, failure: undefined }),
		output: ({ context }) => {
			if (context.failure?.code === 'captureCleanupFailed') return context.failure
			if (context.interruption) return { outcome: context.interruption }
			return context.failure ?? { outcome: 'captured' }
		},
		on: {
			CANCEL: {
				actions: [
					assign({ interruption: ({ context }) => context.interruption ?? 'cancelled' }),
					'abort'
				]
			},
			SHUTDOWN: {
				actions: [
					assign({ interruption: ({ context }) => context.interruption ?? 'closed' }),
					'abort'
				]
			}
		},
		states: {
			checkingAuthority: {
				invoke: {
					src: 'authority',
					input,
					onDone: [
						{ guard: 'interrupted', target: 'releasing' },
						{
							guard: ({ event }) => !event.output,
							target: 'releasing',
							actions: assign({ failure: { outcome: 'failed', code: 'authorityDenied' } })
						},
						{ target: 'acquiring' }
					],
					onError: failed
				}
			},
			acquiring: {
				invoke: { src: 'acquire', input, onDone: advance('draining'), onError: failed }
			},
			draining: {
				invoke: { src: 'drain', input, onDone: advance('reading'), onError: failed }
			},
			reading: {
				invoke: { src: 'read', input, onDone: advance('validating'), onError: failed }
			},
			validating: {
				invoke: { src: 'validate', input, onDone: advance('checkingConsistency'), onError: failed }
			},
			checkingConsistency: {
				invoke: {
					src: 'consistency',
					input,
					onDone: [
						{
							guard: ({ event }) => !event.output,
							target: 'releasing',
							actions: assign({ failure: { outcome: 'failed', code: 'captureInconsistent' } })
						},
						{ target: 'releasing' }
					],
					onError: failed
				}
			},
			releasing: {
				invoke: {
					src: 'release',
					input,
					onDone: 'complete',
					onError: { target: 'complete', actions: 'fail' }
				}
			},
			complete: { type: 'final' }
		}
	})
}
