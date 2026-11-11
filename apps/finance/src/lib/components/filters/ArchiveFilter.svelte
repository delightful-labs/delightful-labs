<script module lang="ts">
	export type ArchiveFilterValue = 'active' | 'archived' | 'all'
</script>

<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'

	let { value = $bindable('active') }: { value: ArchiveFilterValue } = $props()
	const groupName = $props.id()
</script>

<fieldset>
	<legend>{m['labels.status_subject']({ subject: m['nouns.archive']({ count: 1 }) })}</legend>
	<label>
		<input type="radio" name={groupName} bind:group={value} value="active" />
		{m['archive_filter.active']()}
	</label>
	<label>
		<input type="radio" name={groupName} bind:group={value} value="archived" />
		{m['archive_filter.archived']()}
	</label>
	<label>
		<input type="radio" name={groupName} bind:group={value} value="all" />
		{m['archive_filter.all']()}
	</label>
</fieldset>
