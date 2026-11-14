<script lang="ts">
	import ReaderPage from '../../../routes/articles/[id=article]/+page.svelte'
	import type { LibraryClient } from '../../runtime/worker/client.js'
	import { provideWorkerLibrary } from '../../runtime/worker/context.js'
	import AppShell from '../AppShell.svelte'
	import { page } from './page.svelte.js'
	let { client, id }: { client: LibraryClient | undefined; id: string } = $props()
	provideWorkerLibrary({
		get actor() {
			return client
		}
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
{#snippet feedback()}{/snippet}
<AppShell
	account={controls}
	connectionMessage={undefined}
	accountMessage={undefined}
	runtimeFeedback={feedback}
>
	<ReaderPage />
</AppShell>
