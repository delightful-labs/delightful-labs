<script lang="ts">
	import { m } from '#lib/paraglide/messages.js'
</script>

<svelte:head
	><title
		>{m['labels.subject_details']({ subject: m['nouns.transfer']({ count: 1 }) })} · {m[
			'app.name'
		]()}</title
	></svelte:head
>
