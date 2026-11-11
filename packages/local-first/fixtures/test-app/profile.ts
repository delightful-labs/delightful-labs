import { z } from 'zod'
import type { ArchivePayload } from 'delightful-local-first/backup/archive'
import type { ArchiveProfileValidator } from 'delightful-local-first/backup/inspection'

const text = z.strictObject({ kind: z.literal('text'), value: z.string() }).readonly()
const notebook = z
	.strictObject({
		type: z.literal('notebook'),
		id: z.string(),
		fields: z.strictObject({ title: text }).readonly()
	})
	.readonly()
const note = z
	.strictObject({
		type: z.literal('note'),
		id: z.string(),
		fields: z
			.strictObject({
				notebook: z
					.strictObject({
						kind: z.literal('reference'),
						type: z.literal('notebook'),
						id: z.string()
					})
					.readonly(),
				body: text,
				archived: z.strictObject({ kind: z.literal('boolean'), value: z.boolean() }).readonly(),
				attachment: z.union([
					z.strictObject({ kind: z.literal('null') }).readonly(),
					z.strictObject({ kind: z.literal('attachment'), id: z.string() }).readonly()
				])
			})
			.readonly()
	})
	.readonly()

export type NotebookRecord = z.infer<typeof notebook>
export type NoteRecord = z.infer<typeof note>

/** Domain-only checks. Call after the bounded generic codec and envelope integrity checks. */
function validate(payload: ArchivePayload): boolean {
	if (
		payload.profile.id !== testAppProfile.id ||
		payload.profile.version !== testAppProfile.version
	)
		return false
	if (payload.references.length !== 0) return false
	if (
		payload.coverage.recordTypes.length !== 2 ||
		!payload.coverage.recordTypes.includes('notebook') ||
		!payload.coverage.recordTypes.includes('note')
	)
		return false

	let root: NotebookRecord | undefined
	const notes: NoteRecord[] = []
	for (const record of payload.records) {
		if (record.type === 'notebook') {
			const parsed = notebook.safeParse(record)
			if (root || !parsed.success) return false
			root = parsed.data
		} else if (record.type === 'note') {
			const parsed = note.safeParse(record)
			if (!parsed.success) return false
			notes.push(parsed.data)
		} else return false
	}
	if (!root) return false
	const files = new Set(payload.attachments.map((attachment) => attachment.id))
	const used = new Set<string>()
	for (const record of notes) {
		if (record.fields.notebook.id !== root.id) return false
		const attachment = record.fields.attachment
		if (attachment.kind === 'attachment') {
			if (!files.has(attachment.id)) return false
			used.add(attachment.id)
		}
	}
	return used.size === files.size
}

/** Trusted fixture registration; archive input cannot register or load validators. */
export const testAppProfile: Readonly<ArchiveProfileValidator> = Object.freeze({
	id: 'dlf-test-app',
	version: 1,
	validate
})
