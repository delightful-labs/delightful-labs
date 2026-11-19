<script lang="ts">
	import { Button, ButtonContent } from 'delightful-ui'
	import ArchiveIcon from 'tdesign-icons-svg/src/folder-minus.svg?component'
	import { m } from '#lib/paraglide/messages.js'
	import type { ArchiveRowAction } from '../../machines/accounts/account-archive.js'
	let { action, onarchive }: { action: ArchiveRowAction | undefined; onarchive: () => void } =
		$props()
</script>

{#if action && action !== 'unavailable'}
	<Button
		type="button"
		disabled={action !== 'available'}
		aria-busy={action === 'archiving'}
		onclick={onarchive}
	>
		<ButtonContent
			icon={ArchiveIcon}
			loading={action === 'archiving'}
			text={action === 'archiving'
				? m['status.archiving_subject']({ subject: m['nouns.account']({ count: 1 }) })
				: m['actions.archive_button']()}
		/>
	</Button>
{:else}
	<p>{m['accounts.archive_restricted']()}</p>
{/if}
