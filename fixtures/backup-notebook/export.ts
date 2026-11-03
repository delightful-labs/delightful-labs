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
import { NotebookSource } from './source.js'

/** Creates an unstarted application-owned root actor; no file, network or storage effects here. */
export function createNotebookExport(options: {
	binding: BackupBinding
	handoff: ArchiveFileHandoff
	protection: ArchiveProtection
}) {
	const source = new NotebookSource(
		createNotebookDataset({
			applicationId: options.binding.applicationId,
			workspaceId: options.binding.workspaceId
		}),
		options.binding
	)
	const request = prepareArchiveExport({
		...options,
		source,
		profile: notebookProfile
	})
	const actor = createActor(createArchiveExportMachine(), { input: { request } })
	return { actor, request, source }
}
