<script lang="ts">
	import { Button, Dialog, Text, InputAvatar } from 'delightful-ui'
	import type {Snippet} from 'svelte'
	import type { ProfileView } from '../../contracts/profile.js'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import FormContent from '../forms/FormContent.svelte'
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
	let savedFile = $state<File | null>(null)
	let selectedFile = $state<File | null>(null)
	let pendingFile = $state<File | null>(null)
	let cropOpen = $state(false)
	let selectionError = $state(false)
	const resetRevision = $derived(view.draftRevision)
	const recordId = $derived(profileId)
	$effect(() => {
		void recordId
		void resetRevision
		const file =
			avatarData && mimeType
				? new File([Uint8Array.from(avatarData)], 'avatar', { type: mimeType })
				: null
		savedFile = file
		selectedFile = file
		pendingFile = null
		cropOpen = false
		selectionError = false
	})
</script>

<Text id="avatar-help"
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
				bind:value={
					() => selectedFile,
					(file) => {
						if (file === null && selectedFile === savedFile && savedFile !== null) {
							onRemove()
							return
						}
						if (file) {
							if (!validateFile(file)) {
								selectedFile = savedFile
								pendingFile = null
								cropOpen = false
								selectionError = true
								onSelectionChange(savedFile)
								return
							}
							selectionError = false
							pendingFile = file
							cropOpen = true
							return
						}
						selectedFile = savedFile
						onSelectionChange(savedFile)
					}
				}
				infoLabel={labels.details}
				closeLabel={labels.close}
				removeLabel={selectedFile === savedFile
					? labels.remove
					: labels.clear}
				id="profile-avatar"
				name="file"
				accept={accept}
				aria-describedby="avatar-help"
				required
				disabled={!view.fieldsEditable}
			>
				{#snippet imageActions(file, closePreview)}
					<Button
						type="button"
						disabled={!view.fieldsEditable}
						onclick={() => {
							closePreview()
							pendingFile = file
							cropOpen = true
						}}>{labels.edit}</Button
					>
				{/snippet}
			</InputAvatar>
			{#if selectionError}<p role="alert">{labels.invalid}</p>{/if}
		{/snippet}
		{#snippet controls(view)}
			{#if selectedFile && selectedFile !== savedFile}
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
{#if pendingFile}
	<Dialog
		heading={labels.cropTitle}
		bind:open={cropOpen}
		closedby="any"
		onclose={() => (pendingFile = null)}
	>
		{@render cropper(pendingFile,(file)=>{selectedFile=file;onSelectionChange(file);pendingFile=null;cropOpen=false},()=>{pendingFile=null;cropOpen=false})}
	</Dialog>
{/if}
