<script lang="ts">
	import { setContext } from 'svelte'
	import ReaderPage from '../../../routes/articles/[id=article]/+page.svelte'
	import type { LibraryClient } from '../../runtime/worker/client.js'
	import { workerLibraryContextKey } from '../../runtime/worker/context.js'
	import { setAccountSettings } from '../../runtime/account-settings.js'
	import { page } from './page.svelte.js'
	let { client, id }: { client: LibraryClient | undefined; id: string } = $props()
	setContext(workerLibraryContextKey, {
		get actor() {
			return client
		}
	})
	setAccountSettings({
		get controls() {
			return controls
		},
		connectionMessage: undefined,
		accountMessage: undefined
	})
	$effect.pre(() => {
		page.params.id = id
		page.url = new URL('/articles/' + id, 'https://example.invalid/')
	})
	export function navigate(owner: LibraryClient | undefined, articleId: string) {
		client = owner
		id = articleId
	}
</script>

{#snippet controls()}<span>Account fixture</span>{/snippet}
<main><ReaderPage /></main>
