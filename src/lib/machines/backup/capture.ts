import { assign, fromPromise, setup, sendTo, type ActorLogic, type Snapshot } from 'xstate'
import {
	exportFailure,
	validateCapturedExport,
	type ArchiveCaptureResult,
	type ArchiveExportInterruption,
	type ArchiveExportRequest,
	type BackupBinding
} from '../../backup/export.js'
import type { ArchiveCaptureReaderInput, ArchiveCaptureReaderResult } from '../../backup/export.js'

import {
	abortExport,
	observeExportAuthority,
	acquireExportLease,
	drainExportWriters,
	readExportGraph,
	observeExportConsistency,
	releaseExportLease
} from '../../backup/export-native.js'
import { exportReaderInput } from '../../backup/export-native.js'

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
function readerFailure(result: ArchiveCaptureReaderResult | undefined) {
	return result?.outcome === 'failed' ? result : undefined
}

/** Invoked only by the claimed export owner. Payloads and leases never enter actor snapshots. */
export type ArchiveCaptureReader<ReaderSnapshot extends Snapshot<ArchiveCaptureReaderResult>> =
	ActorLogic<ReaderSnapshot, { type: 'CANCEL' | 'SHUTDOWN' }, ArchiveCaptureReaderInput>
export function createArchiveCaptureMachine<
	ReaderSnapshot extends Snapshot<ArchiveCaptureReaderResult>
>(options?: { reader: ArchiveCaptureReader<ReaderSnapshot> }) {
	function leaf<Output>(run: (request: ArchiveExportRequest) => Output | Promise<Output>) {
		return fromPromise<Output, ArchiveExportInput>(({ input }) =>
			Promise.resolve(run(input.request))
		)
	}
	const actors = {
		authority: leaf((request) => observeExportAuthority(request)),
		acquire: leaf((request) => acquireExportLease(request)),
		drain: leaf((request) => drainExportWriters(request)),
		read:
			options?.reader ??
			fromPromise<ArchiveCaptureReaderResult, ArchiveExportInput & ArchiveCaptureReaderInput>(
				({ input }) => readExportGraph(input.request).then(() => ({ outcome: 'read' }))
			),
		consistency: leaf((request) => observeExportConsistency(request)),
		release: leaf((request) => releaseExportLease(request))
	}
	const model = setup<
		Context,
		| { type: 'CANCEL' | 'SHUTDOWN' }
		| { type: 'CAPTURE_VALIDATED' }
		| { type: 'CAPTURE_VALIDATION_FAILED'; failure: ReturnType<typeof exportFailure> },
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
	const authority = (next: string) =>
		model.createStateConfig({
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
					{ target: next }
				],
				onError: failed
			}
		})
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
			checkingAuthority: authority('acquiring'),
			acquiring: {
				invoke: { src: 'acquire', input, onDone: advance('draining'), onError: failed }
			},
			draining: {
				invoke: {
					src: 'drain',
					input,
					onDone: advance('checkingDrainedAuthority'),
					onError: failed
				}
			},
			checkingDrainedAuthority: authority('reading'),
			reading: {
				on: {
					CANCEL: {
						actions: [
							assign({ interruption: ({ context }) => context.interruption ?? 'cancelled' }),
							'abort',
							sendTo('reader', { type: 'CANCEL' })
						]
					},
					SHUTDOWN: {
						actions: [
							assign({ interruption: ({ context }) => context.interruption ?? 'closed' }),
							'abort',
							sendTo('reader', { type: 'SHUTDOWN' })
						]
					}
				},
				invoke: {
					id: 'reader',
					src: 'read',
					input: ({ context }) => ({
						...input({ context }),
						...exportReaderInput(context.request)
					}),
					onDone: [
						{ guard: 'interrupted', target: 'releasing' },
						{
							guard: ({ event }) => event.output === undefined || event.output.outcome === 'failed',
							target: 'releasing',
							actions: assign({
								failure: ({ event }) => readerFailure(event.output) ?? exportFailure(undefined)
							})
						},
						{
							guard: ({ event }) => event.output?.outcome === 'cancelled',
							target: 'releasing',
							actions: assign({ interruption: 'cancelled' })
						},
						{ target: 'validating' }
					],
					onError: failed
				}
			},
			validating: {
				entry: ({ context, self }) => {
					try {
						validateCapturedExport(context.request)
						self.send({ type: 'CAPTURE_VALIDATED' })
					} catch (error) {
						self.send({ type: 'CAPTURE_VALIDATION_FAILED', failure: exportFailure(error) })
					}
				},
				on: {
					CAPTURE_VALIDATED: advance('checkingConsistency'),
					CAPTURE_VALIDATION_FAILED: {
						target: 'releasing',
						actions: assign({ failure: ({ event }) => event.failure })
					}
				}
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
						{ guard: 'interrupted', target: 'releasing' },
						{ target: 'checkingFinalAuthority' }
					],
					onError: failed
				}
			},
			checkingFinalAuthority: authority('releasing'),
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
