<script lang="ts">
	import Shared from 'delightful-local-first/profile/name-view'
	import type { ComponentProps } from 'svelte'
	import { m } from '#lib/paraglide/messages.js'
	import { formReasonText } from '#lib/forms/form-messages.js'
	let props: Omit<ComponentProps<typeof Shared>, 'labels' | 'reasonText'> = $props()
</script>

<Shared
	{...props}
	reasonText={(reason) => formReasonText[reason]()}
	labels={{
		profile: m['nouns.profile']({ count: 1 }),
		description: m['profile.name_description'](),
		invalid: m['profile.name_invalid'](),
		displayName: m['labels.display_name'](),
		save: m['actions.save'](),
		saved: m['status.saved_subject_name']({
			subject: m['nouns.profile']({ count: 1 }),
			name: m['labels.display_name']()
		}),
		retry: m['actions.retry']()
	}}
/>
