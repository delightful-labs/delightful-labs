<script lang="ts">
	import type { Snippet } from 'svelte'
	import type { ReaderPreferences } from '../../reader/schema.js'

	let { preferences, children }: { preferences: ReaderPreferences; children: Snippet } = $props()
</script>

<div
	style:--reader-font={preferences.font === 'serif'
		? 'ui-serif, Georgia, Cambria, serif'
		: 'system-ui, sans-serif'}
	style:--reader-size={preferences.size + 'px'}
	style:--reader-spacing={preferences.spacing}
	style:--reader-width={preferences.width + '%'}
>
	{@render children()}
</div>
