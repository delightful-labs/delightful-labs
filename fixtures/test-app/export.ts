import { createActor } from 'xstate'
import {
	prepareArchiveExport,
	type ArchiveFileHandoff,
	type BackupBinding
} from 'delightful-local-first/backup/export'
import type { ArchiveProtection } from 'delightful-local-first/backup/envelope'
import { createArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import { createTestAppDataset } from './dataset.js'
import { testAppProfile } from './profile.js'
import { createTestAppSource } from './source.js'

/** Creates an unstarted application-owned root actor; starts only the independent in-memory source root. */
export function createTestAppExport(options: {
	binding: BackupBinding
	handoff: ArchiveFileHandoff
	protection: ArchiveProtection
}) {
	const source = createTestAppSource(
		createTestAppDataset({
			applicationId: options.binding.applicationId,
			workspaceId: options.binding.workspaceId
		}),
		options.binding
	)
	// Host-owned source lifetime outlasts this one export; callers stop source.actor after drain.
	source.actor.start()
	const request = prepareArchiveExport({
		...options,
		source,
		profile: testAppProfile
	})
	const actor = createActor(createArchiveExportMachine(), { input: { request } })
	return { actor, request, source }
}
