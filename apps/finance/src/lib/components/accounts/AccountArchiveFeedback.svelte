<script lang="ts">
	import { StatusMessage } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import type { AccountArchiveFeedback } from '../../contracts/account-archive-feedback.js'
	let { feedback }: { feedback: AccountArchiveFeedback | null } = $props()
	const text = $derived(
		feedback?.outcome === 'succeeded'
			? m['status.archived_subject_name']({
					subject: m['nouns.account']({ count: 1 }),
					name: feedback.name
				})
			: feedback?.settlement === 'locallyPersisted'
				? m['accounts.archive_interrupted_saved']()
				: feedback?.outcome === 'scopeChanged'
					? m['accounts.archive_scope_changed']()
					: feedback?.outcome === 'denied'
						? m['accounts.archive_restricted']()
						: m['errors.archive_subject']({ subject: m['nouns.account']({ count: 1 }) })
	)
</script>

{#if feedback}
	<StatusMessage
		variant={feedback.settlement === 'locallyPersisted' ? 'success' : 'error'}
		{text}
	/>
{/if}
