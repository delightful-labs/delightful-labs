<script lang="ts">
	import { Button, Dialog, Text, InputAvatar } from 'delightful-ui'
	import type { Snippet } from 'svelte'
	import { createAvatarSelection } from './avatar-selection.svelte.js'
	import type { ProfileView } from '../../contracts/profile.js'
	import FormFeedback from '../../components/forms/FormFeedback.svelte'
	import FormContent from '../../components/forms/FormContent.svelte'
	const instanceId = $props.id()
	const avatarId = `${instanceId}-avatar`
	const helpId = `${instanceId}-avatar-help`
	let {
		labels,reasonText,validateFile,accept,cropper,
		profileId,
		avatarData,
		mimeType,
		view,
		onsubmit,
		onreset,
		oninput,
		onRetryReadiness,
		onRemove,
		onSelectionChange
	}: {
		labels:Record<'formats'|'maxSize'|'resize'|'profile'|'invalidName'|'avatar'|'select'|'details'|'close'|'remove'|'clear'|'edit'|'invalid'|'save'|'saved'|'cropTitle'|'retry',string>
		reasonText:(reason:import('../../contracts/profile.js').ProfileReason)=>string
		validateFile:(file:File)=>boolean
		accept:string
		cropper:Snippet<[File,(file:File)=>void,()=>void]>
		profileId: string
		avatarData: Uint8Array | null | undefined
		mimeType: string | null | undefined
		view: ProfileView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		oninput: (event: Event) => void
		onRetryReadiness: () => void
		onRemove: () => void
		onSelectionChange: (file: File | null) => void
	} = $props()
	const persistedFile = $derived(
		avatarData && mimeType
			? new File([Uint8Array.from(avatarData)], 'avatar', { type: mimeType })
			: null
	)
	const selection = createAvatarSelection({
		observe: () => ({ profileId, resetRevision: view.draftRevision, saved: persistedFile }),
		validateFile: (file) => validateFile(file),
		onSelectionChange: (file) => onSelectionChange(file),
		onRemove: () => onRemove()
	})
</script>

<Text id={helpId}
	>{labels.formats} {labels.maxSize} {labels.resize}</Text
>
<FormFeedback retryLabel={labels.retry}
	{view}
	subject={labels.profile}
	{reasonText}
	invalidMessage={labels.invalidName}
	section="readiness"
	{onRetryReadiness}
/>
{#key profileId}
	<FormContent {view} {onsubmit} {onreset} {oninput}>
		{#snippet fields(view)}
			<input type="hidden" name="action" value="upload" />
			<InputAvatar
				label={labels.avatar}
				uploadLabel={labels.select}
				bind:value={() => selection.view.selected, selection.select}
				infoLabel={labels.details}
				closeLabel={labels.close}
				removeLabel={!selection.view.dirty
					? labels.remove
					: labels.clear}
				id={avatarId}
				name="file"
				accept={accept}
				aria-describedby={helpId}
				required
				disabled={!view.fieldsEditable}
			>
				{#snippet imageActions(file, closePreview)}
					<Button
						type="button"
						disabled={!view.fieldsEditable}
						onclick={() => {
							closePreview()
							selection.edit(file)
						}}>{labels.edit}</Button
					>
				{/snippet}
			</InputAvatar>
			{#if selection.view.invalid}<p role="alert">{labels.invalid}</p>{/if}
		{/snippet}
		{#snippet controls(view)}
			{#if selection.view.dirty}
				<Button type="submit" disabled={!view.canSubmit}>
					{labels.save}
				</Button>
			{/if}
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback retryLabel={labels.retry}
				{view}
				subject={labels.profile}
				{reasonText}
				invalidMessage={labels.invalid}
				successMessage={() =>
					labels.saved}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
{#if selection.view.crop}
	{@const crop = selection.view.crop}
	{#key crop}
		<Dialog
			heading={labels.cropTitle}
			open
			closedby="any"
			onclose={() => selection.dismiss(crop)}
		>
			{@render cropper(crop.file, (file) => selection.accept(crop, file), () => selection.dismiss(crop))}
		</Dialog>
	{/key}
{/if}
