import { assign, fromPromise, setup } from 'xstate'
import {
	exportFailure,
	exportOperation,
	type ArchiveCaptureResult,
	type ArchiveExportInterruption,
	type ArchiveExportRequest,
	type BackupBinding
} from '../../backup/export.js'

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
	function leaf(run: (operation: ReturnType<typeof exportOperation>) => void | Promise<void>) {
		return fromPromise<void, ArchiveExportInput>(({ input }) =>
			Promise.resolve(run(exportOperation(input.request)))
		)
	}
	const actors = {
		authority: leaf((operation) => operation.checkAuthority()),
		acquire: leaf((operation) => operation.acquire()),
		drain: leaf((operation) => operation.drain()),
		read: leaf((operation) => operation.read()),
		validate: leaf((operation) => operation.validate()),
		consistency: leaf((operation) => operation.checkConsistency()),
		release: leaf((operation) => operation.releaseLease())
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
			abort: ({ context }) => exportOperation(context.request).abort()
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
				invoke: { src: 'authority', input, onDone: advance('acquiring'), onError: failed }
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
				invoke: { src: 'consistency', input, onDone: 'releasing', onError: failed }
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
