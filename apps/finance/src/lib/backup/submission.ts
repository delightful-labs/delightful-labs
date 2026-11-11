import type { prepareJazzArchiveExport } from 'delightful-local-first/backend/jazz/backup'

type Protection = Parameters<typeof prepareJazzArchiveExport>[0]['protection']
export type BackupSubmission = Readonly<{
	validPassword: boolean
	release(): void
	toJSON(): { type: 'finance-backup-submission' }
}>
const submissions = new WeakMap<BackupSubmission, Protection>()

/** Integration-boundary capability. Raw passwords never become actor input or context. */
export function prepareBackupSubmission(
	protection: 'none' | 'password',
	password: string
): BackupSubmission {
	const submission: BackupSubmission = {
		validPassword:
			protection === 'none' ||
			(password.length > 0 && new TextEncoder().encode(password).length <= 1024),
		release: () => {
			submissions.delete(submission)
		},
		toJSON: () => ({ type: 'finance-backup-submission' })
	}
	submissions.set(
		submission,
		protection === 'none' ? { kind: 'none' } : { kind: 'password', password }
	)
	return Object.freeze(submission)
}

/** Called by the selected preparation leaf, never by a transition calculation. */
export function takeBackupProtection(submission: BackupSubmission): Protection {
	const protection = submissions.get(submission)
	if (!protection) throw new Error('Backup submission unavailable')
	submissions.delete(submission)
	return protection
}
