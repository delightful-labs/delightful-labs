<script lang="ts">
	import { untrack } from 'svelte'
	import { Textarea, Button, StatusMessage } from 'delightful-ui'
	import { textFieldSync } from 'jazz-tools/text-field'
	import type { NoteDraftRecord } from '../notes/schema.js'
	import type { AnnotationCommand } from './schema.js'
	import { noun, t } from '../localization/index.js'
	let {
		note,
		documentId,
		enabled,
		send
	}: {
		note: { id: string; text: string; drafts?: NoteDraftRecord[] }
		documentId: string
		enabled: boolean
		send: (command: AnnotationCommand) => void
	} = $props()
	let element = $state.raw<HTMLTextAreaElement>()
	// Status-only worker views can repeat an older value while local edits travel.
	// Forward column changes to the native adapter, not repeated row snapshots.
	const savedText = $derived(note.text)
	const initial = untrack(() => note.text)
	$effect(() => {
		const field = element
		if (!field) return
		const owner = textFieldSync(field, {
			onChange: (text, { editedFrom }) =>
				send({ type: 'EDIT_NOTE', documentId, id: note.id, text, editedFrom })
		})
		$effect(() => owner.apply(savedText))
		return () => owner.destroy()
	})
</script>

<Textarea bind:element label={noun('note')} defaultValue={initial} disabled={!enabled} />
<Button
	appearance="flat"
	disabled={!enabled}
	onclick={() => send({ type: 'DELETE_NOTE', documentId, id: note.id })}
	>{t('actions.remove_name', { name: noun('note') })}</Button
>

{#each note.drafts ?? [] as record (record.writerId)}
	<StatusMessage variant="info" text={t('errors.conflict', { subject: noun('note') })} />
	<Textarea label={noun('note')} defaultValue={record.draft.text} readonly />
	<Button
		disabled={!enabled}
		onclick={() => send({ type: 'KEEP_DRAFT', documentId, id: note.id, writerId: record.writerId })}
		>{t('notes.keep_text')}</Button
	>
{/each}
