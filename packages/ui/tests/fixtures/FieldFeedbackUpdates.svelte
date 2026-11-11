<script lang="ts">
	import InputText from '#lib/Components/Inputs/InputText.svelte'
	import FieldFeedback from '#lib/Components/Inputs/FieldFeedback.svelte'
	let instructions = $state('Use your account name.')
	let errorMessage = $state('')
</script>

<InputText
	label="Account name"
	aria-describedby="account-feedback"
	aria-invalid={Boolean(errorMessage)}
/>
<FieldFeedback id="account-feedback" {instructions} {errorMessage} />
<button onclick={() => (errorMessage = 'Enter an account name.')}
	>Show error</button
>
<button
	onclick={() => {
		instructions = ''
		errorMessage = ''
		document.getElementById('account-feedback')?.setAttribute('hidden', '')
	}}>Clear feedback</button
>
