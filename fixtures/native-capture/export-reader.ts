import { assign, fromCallback, fromPromise, setup } from 'xstate'
import type {
	JazzArchiveReaderInput,
	JazzArchiveReaderResult
} from '../../src/lib/backend/jazz/backup-api.js'
import type { ArchivePayload } from '../../src/lib/backup/archive.js'
import { app, type Graph } from './schema.js'
import { encodeBase64 } from '../../src/lib/backup/binary.js'
import { classifyJazzArchiveFailure } from '../../src/lib/backend/jazz/backup-api.js'

type Values = { revision: number; bytes: Uint8Array; digest?: string }
const privateReads = new WeakMap<JazzArchiveReaderInput, Values>()
export const testExportProfile = {
	id: 'test.native',
	version: 1,
	validate: (payload: ArchivePayload) =>
		payload.records.length === 1 && payload.attachments.length === 1
}
export function createExportReader(
	graph: Graph,
	pause: (input: JazzArchiveReaderInput) => Promise<void> = () => Promise.resolve(),
	crash = false
) {
	type ReaderContext = JazzArchiveReaderInput & { result: JazzArchiveReaderResult }
	const actors = {
		resources: fromCallback<{ type: string }, JazzArchiveReaderInput>(({ input }) => {
			const clear = () => {
				privateReads.get(input)?.bytes.fill(0)
				privateReads.delete(input)
			}
			input.signal.addEventListener('abort', clear, { once: true })
			return () => {
				input.signal.removeEventListener('abort', clear)
				clear()
			}
		}),
		read: fromPromise<void, JazzArchiveReaderInput>(({ input }) =>
			Promise.all([
				input.all(app.workspaces.where({ id: graph.workspace })),
				input.all(app.entries.where({ workspaceId: graph.workspace })),
				input.all(app.files.where({ workspaceId: graph.workspace })),
				input.all(app.parts.where({ workspaceId: graph.workspace }))
			]).then(([roots, entries, files, parts]) => {
				if (input.signal.aborted) return
				const root = roots[0],
					part = parts[0]
				if (!root || !part || entries.length !== 1 || files.length !== 1 || parts.length !== 1)
					throw new Error('Incomplete scope')
				privateReads.set(input, { revision: root.revision, bytes: Uint8Array.from(part.data) })
			})
		),
		pause: fromPromise<void, JazzArchiveReaderInput>(({ input }) => pause(input)),
		digest: fromPromise<void, JazzArchiveReaderInput>(({ input }) => {
			const values = privateReads.get(input)
			if (!values) throw new Error('Reader data missing')
			return input.sha256(values.bytes).then((digest) => {
				values.digest = digest
			})
		})
	}
	return setup<
		ReaderContext,
		{ type: 'CANCEL' | 'SHUTDOWN' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		JazzArchiveReaderInput,
		JazzArchiveReaderResult
	>({ actors }).createMachine({
		context: ({ input }) => ({ ...input, result: { outcome: 'ready' } }),
		initial: 'reading',
		invoke: { src: 'resources', input: ({ context }) => context, onError: '.failed' },
		output: ({ context }) => context.result,
		states: {
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context,
					onDone: [
						{ guard: ({ context }) => context.mode === 'hydrate', target: 'done' },
						{ target: 'pausing' }
					],
					onError: 'failed'
				}
			},
			pausing: {
				entry: () => {
					if (crash) throw new Error('Synthetic reader crash')
				},
				invoke: {
					src: 'pause',
					input: ({ context }) => context,
					onDone: 'hashing',
					onError: 'failed'
				}
			},
			hashing: {
				invoke: {
					src: 'digest',
					input: ({ context }) => context,
					onDone: 'done',
					onError: 'failed'
				}
			},
			done: {
				type: 'final',
				entry: ({ context }) => {
					if (context.mode !== 'capture') return
					const value = privateReads.get(context)
					if (!value?.digest) throw new Error('Missing digest')
					context.accept({
						archiveId: crypto.randomUUID(),
						profile: { id: testExportProfile.id, version: testExportProfile.version },
						source: { applicationId: context.binding.applicationId, workspaceId: graph.workspace },
						capturedAt: new Date().toISOString(),
						coverage: {
							mode: 'complete-supported-graph',
							recordTypes: ['workspace'],
							history: 'current-data',
							deletedRecords: 'excluded',
							consistency: 'jazz-exclusive-transaction'
						},
						records: [
							{
								type: 'workspace',
								id: graph.workspace,
								fields: {
									revision: { kind: 'integer', value: String(value.revision) },
									file: { kind: 'attachment', id: graph.file }
								}
							}
						],
						attachments: [
							{
								id: graph.file,
								mediaType: 'application/octet-stream',
								fileName: 'private-native-file.bin',
								sizeBytes: value.bytes.length,
								sha256: value.digest,
								data: encodeBase64(value.bytes)
							}
						],
						references: []
					})
				}
			},
			failed: {
				type: 'final',
				entry: assign({
					result: ({ event }): JazzArchiveReaderResult => ({
						outcome: 'failed',
						code: classifyJazzArchiveFailure('error' in event ? event.error : undefined)
					})
				})
			}
		}
	})
}
