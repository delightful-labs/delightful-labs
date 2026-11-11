<script lang="ts">
	import ProfileAvatarForm from 'delightful-local-first/profile/avatar-form'
	import type { ProfileView } from '../../../src/lib/contracts/profile.js'
	let profileId = $state('one')
	let revision = $state(0)
	let mounted = $state(true)
	let selected = $state('unchanged')
	let removals = $state(0)
	let late: (() => void) | undefined
	const view: ProfileView = $derived({
		readiness: { kind: 'ready' }, content: { kind: 'fields' }, activity: { kind: 'idle' },
		feedback: { kind: 'none' }, canSubmit: true, canReset: true, canOpen: true,
		canCancel: true, fieldsEditable: true, canRetryReadiness: false, draftRevision: revision
	})
	const labels = {
		formats: 'PNG', maxSize: 'Small files', resize: 'Crop before save', profile: 'Profile',
		invalidName: 'Invalid name', avatar: 'Avatar', select: 'Select avatar', details: 'Details',
		close: 'Close', remove: 'Remove avatar', clear: 'Clear draft', edit: 'Edit avatar',
		invalid: 'Invalid image', save: 'Save avatar', saved: 'Saved', cropTitle: 'Crop avatar', retry: 'Retry'
	}
</script>
<button onclick={() => revision += 1}>Reset draft</button>
<button onclick={() => profileId = profileId === 'one' ? 'two' : 'one'}>Change profile</button>
<button onclick={() => late?.()}>Finish old crop</button>
<button onclick={() => mounted = false}>Unmount form</button>
<p role="status" aria-label="Selected file">{selected}</p>
<p role="status" aria-label="Removals">{removals}</p>
{#if mounted}
	<ProfileAvatarForm {profileId} {view} {labels} avatarData={null} mimeType={null}
		reasonText={() => ''} validateFile={(file) => file.type === 'image/png'} accept="image/*"
		onsubmit={(event) => event.preventDefault()} onreset={(event) => event.preventDefault()}
		oninput={() => {}} onRetryReadiness={() => {}} onRemove={() => removals += 1}
		onSelectionChange={(file) => selected = file?.name ?? 'none'}>
		{#snippet cropper(file, accept, cancel)}
			<p>{file.name}</p>
			<button onclick={() => accept(file)}>Accept crop</button>
			<button onclick={cancel}>Cancel crop</button>
			<button onclick={() => late = () => accept(file)}>Remember crop</button>
		{/snippet}
	</ProfileAvatarForm>
{/if}
