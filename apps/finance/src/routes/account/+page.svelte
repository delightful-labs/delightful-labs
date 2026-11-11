<script lang="ts">
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()

	import { observeRow } from '#lib/runtime/observations.js'
	import { fromStore } from 'svelte/store'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import { createQuerySubscriptionOne } from 'delightful-local-first/backend/jazz/data'
	import { m } from '#lib/paraglide/messages.js'
	import { app } from '#lib/schema.js'
	import { saveProfileName, saveProfileAvatar } from '#lib/data.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import { createProfileFormOptions } from '#lib/machines/identity/profile.js'
	import type { ProfileObservation } from '#lib/contracts/profile-contract.js'
	import ProfileAvatarForm from '#lib/components/identity/ProfileAvatarForm.svelte'
	import ProfileNameForm from '#lib/components/identity/ProfileNameForm.svelte'
	import RecoveryPhraseIntegration from '#lib/components/identity/RecoveryPhraseIntegration.svelte'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'

	const session = getJazzSession()
	const currentSession = fromStore(session)
	const db = getDb()
	const userId = $derived(currentSession.current.account?.id ?? null)
	const profileQuery = createQuerySubscriptionOne(() =>
		userId ? app.profiles.where({ userId }) : undefined
	)
	const profile = $derived(profileQuery.current)

	function observeProfile(): ProfileObservation {
		return {
			identityId: currentSession.current.account?.id ?? null,
			binding: currentSession.current.client?.db ?? null,
			sessionReady: currentSession.current.status === 'ready',
			loading: profileQuery.isLoading,
			failed: profileQuery.error != null,
			profile: observeRow(profileQuery.current)
		}
	}
	const options = createProfileFormOptions({
		binding: db,
		observe: observeProfile,
		saveName: (id, user, name) => saveProfileName(db, id, user, name),
		saveAvatar: (id, user, values) => saveProfileAvatar(db, id, user, values)
	})
	const form = createScopedFormController(options.name)
	const avatarForm = createScopedFormController(options.avatar)
	function removeAvatar() {
		avatarForm.submitValues({ action: 'remove' })
	}
</script>

<svelte:head><title>{m['nouns.account']({ count: 1 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.account']({ count: 1 })} />{/snippet}

	<RecoveryPhraseIntegration />

	<ProfileNameForm
		profileId={profile?.id ?? ''}
		displayName={profile?.displayName}
		view={form.view}
		onsubmit={form.submit}
		onreset={form.reset}
		oninput={form.input}
		onRetryReadiness={form.retryReadiness}
	/>
	<ProfileAvatarForm
		profileId={profile?.id ?? ''}
		avatarData={profile?.avatarData}
		mimeType={profile?.avatarMimeType}
		view={avatarForm.view}
		onsubmit={avatarForm.submit}
		onreset={avatarForm.reset}
		oninput={avatarForm.input}
		onRetryReadiness={avatarForm.retryReadiness}
		onRemove={removeAvatar}
		onSelectionChange={(file) => avatarForm.changeValues({ action: 'upload', file })}
	/>
</PageLayout>
