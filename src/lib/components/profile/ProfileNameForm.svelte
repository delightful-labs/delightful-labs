<script lang="ts">
	import { Button, Heading, Text, InputText } from 'delightful-ui'
	import type { ProfileView } from '../../contracts/profile.js'
	import FormFeedback from '../forms/FormFeedback.svelte'
	import FormContent from '../forms/FormContent.svelte'
	let {
		labels, reasonText,
		profileId,
		displayName,
		view,
		onsubmit,
		onreset,
		oninput,
		onRetryReadiness
	}: {
		labels: {profile:string;description:string;invalid:string;displayName:string;save:string;saved:string;retry:string}
		reasonText:(reason: import('../../contracts/profile.js').ProfileReason)=>string
		profileId: string
		displayName: string | null | undefined
		view: ProfileView
		onsubmit: (event: SubmitEvent) => void
		onreset: (event: Event) => void
		oninput: (event: Event) => void
		onRetryReadiness: () => void
	} = $props()
</script>

<Heading level="h2">{labels.profile}</Heading>
<Text>{labels.description}</Text>
<FormFeedback retryLabel={labels.retry}
	{view}
	subject={labels.profile}
	{reasonText}
	invalidMessage={labels.invalid}
	section="readiness"
	{onRetryReadiness}
/>
{#key profileId}
	<FormContent {view} {onsubmit} {onreset} {oninput}>
		{#snippet fields(view)}
			<InputText
				label={labels.displayName}
				id="profile-display-name"
				name="displayName"
				value={displayName ?? ''}
				disabled={!view.fieldsEditable}
				autocomplete="nickname"
			/>
		{/snippet}
		{#snippet controls(view)}
			<Button type="submit" disabled={!view.canSubmit}>{labels.save}</Button>
		{/snippet}
		{#snippet feedback(view)}
			<FormFeedback retryLabel={labels.retry}
				{view}
				subject={labels.profile}
				{reasonText}
				invalidMessage={labels.invalid}
				successMessage={() => labels.saved}
				section="result"
			/>
		{/snippet}
	</FormContent>
{/key}
