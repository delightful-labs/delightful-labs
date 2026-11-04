import { createActor } from 'xstate'
import {
	prepareArchiveExport,
	type ArchiveFileHandoff,
	type BackupBinding
} from 'delightful-local-first/backup/export'
import type { ArchiveProtection } from 'delightful-local-first/backup/envelope'
import { createArchiveExportMachine } from 'delightful-local-first/backup/export/workflow'
import { createNotebookDataset } from './dataset.js'
import { notebookProfile } from './profile.js'
import { createNotebookSource } from './source.js'

/** Creates an unstarted application-owned root actor; starts only the independent in-memory source root. */
export function createNotebookExport(options: {
	binding: BackupBinding
	handoff: ArchiveFileHandoff
	protection: ArchiveProtection
}) {
	const source = createNotebookSource(
		createNotebookDataset({
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
		profile: notebookProfile
	})
	const actor = createActor(createArchiveExportMachine(), { input: { request } })
	return { actor, request, source }
}
