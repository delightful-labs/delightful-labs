import type { ArchivePayload } from 'delightful-local-first/backup/archive'
import { testAppProfile } from './profile.js'

/** Disposable source content, including exact Unicode, relationships, archived content and bytes. */
export function createTestAppDataset(source: ArchivePayload['source']): ArchivePayload {
	return {
		archiveId: crypto.randomUUID(),
		profile: { id: testAppProfile.id, version: testAppProfile.version },
		source: { ...source },
		capturedAt: new Date().toISOString(),
		coverage: {
			mode: 'complete-supported-graph',
			recordTypes: ['notebook', 'note'],
			history: 'current-data',
			deletedRecords: 'excluded',
			consistency: 'quiescent-single-user'
		},
		records: [
			{
				type: 'notebook',
				id: 'book',
				fields: { title: { kind: 'text', value: 'Test app fixture' } }
			},
			{
				type: 'note',
				id: 'first',
				fields: {
					notebook: { kind: 'reference', type: 'notebook', id: 'book' },
					body: { kind: 'text', value: 'First line\nSecond line\r\nCafe\u0301 ☕' },
					archived: { kind: 'boolean', value: false },
					attachment: { kind: 'attachment', id: 'binary' }
				}
			},
			{
				type: 'note',
				id: 'archived',
				fields: {
					notebook: { kind: 'reference', type: 'notebook', id: 'book' },
					body: { kind: 'text', value: 'Preserve archived content\u0000exactly.' },
					archived: { kind: 'boolean', value: true },
					attachment: { kind: 'attachment', id: 'binary' }
				}
			},
			{
				type: 'note',
				id: 'empty',
				fields: {
					notebook: { kind: 'reference', type: 'notebook', id: 'book' },
					body: { kind: 'text', value: '' },
					archived: { kind: 'boolean', value: false },
					attachment: { kind: 'null' }
				}
			}
		],
		attachments: [
			{
				id: 'binary',
				mediaType: 'application/octet-stream',
				fileName: 'bytes.bin',
				sizeBytes: 4,
				// Exact bytes: 00 ff 80 0a. Sealing/opening must check this digest independently.
				sha256: '6d6f7836f1e146dc0204afb5133dae52fdc05603d8ac2dc793b481b0e0829fd1',
				data: 'AP+ACg=='
			}
		],
		references: []
	}
}
