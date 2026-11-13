<script lang="ts">
	import { untrack } from 'svelte'
	import { createAttachmentKey } from 'svelte/attachments'
	import type { LibraryClient } from '../runtime/worker/client.js'
	import PageNavigation from '../components/navigation/PageNavigation.svelte'
	import { Button, StatusMessage } from 'delightful-ui'
	import LibrarySearch from '../components/library/LibrarySearch.svelte'
	import LibraryFilters from '../components/library/LibraryFilters.svelte'
	import LibraryFilterPopovers from '../components/library/LibraryFilterPopovers.svelte'
	import ArticleList from '../components/library/ArticleList.svelte'
	import ArticleTags from './ArticleTags.svelte'
	import { action, t } from '../localization/index.js'
	import AddLink from './AddLink.svelte'
	import { Heading } from 'delightful-ui'
	let {
		actor
	}: {
		actor: LibraryClient
		gatewayEnabled?: boolean
	} = $props()
	// The page keys Library by client; reads and intents share that exact scope.
	const client = untrack(() => actor)
	let heading = $state<HTMLHeadingElement>()
	const headingAttachment = {
		[createAttachmentKey()]: (element: Element) => {
			if (element instanceof HTMLHeadingElement) heading = element
			return () => {
				heading = undefined
			}
		}
	}
	let tagTrigger: HTMLElement | undefined
	let tagArticleId = $state<string>()
	let tagsOpen = $state(false)
	const filterState = $derived($client.filters)
	const view = $derived($client.view)
</script>

<section aria-label={t('library.heading')}>
	<div class="library-header">
		<PageNavigation />
		<Heading level="h1" size="xl" tabindex={-1} {...headingAttachment}
			>{t('library.heading')}</Heading
		>
		<LibraryFilterPopovers
			searchLabel={action('search', 'article', 2)}
			onsearch={() => client.send({ type: 'SEARCH_OPEN' })}
			filtersLabel={action('filter', 'article', 2)}
		>
			{#snippet search()}
				<LibrarySearch
					query={filterState.query}
					enabled={view.search.enabled}
					onquery={(query) => client.send({ type: 'QUERY', query })}
				/>
			{/snippet}
			{#snippet filters()}
				<LibraryFilters
					view={filterState.view}
					favorites={filterState.favorites}
					tags={view.tags}
					selectedTags={filterState.selectedTags}
					onfilter={(view, favorites) => client.send({ type: 'FILTER', view, favorites })}
					ontagfilter={(keys) => client.send({ type: 'TAG_FILTER', keys })}
				/>
			{/snippet}
		</LibraryFilterPopovers>
	</div>
	{#if view.search.message}<StatusMessage {...view.search.message} />{/if}
	{#if view.search.canRetry}<Button
			type="button"
			onclick={() => client.send({ type: 'RETRY_SEARCH' })}>{t('actions.retry')}</Button
		>{/if}
	{#if view.organizationMessage}<StatusMessage {...view.organizationMessage} />{/if}
	{#if view.listMessage}<StatusMessage {...view.listMessage} />{/if}
	{#if view.emptyMessage}<p>{view.emptyMessage.text}</p>{/if}
	<ArticleList
		rows={view.rows}
		hasMore={$client.hasMore}
		onmore={() => client.more()}
		resetKey={JSON.stringify([
			filterState.query,
			filterState.view,
			filterState.favorites,
			filterState.selectedTags
		])}
		readable={view.readable}
		enabled={view.canOrganize}
		onorganize={(request) => client.send({ type: 'ORGANIZE', request })}
		onretry={(id) => client.send({ type: 'RETRY', id })}
		ontags={(row, trigger) => {
			tagTrigger = trigger
			tagArticleId = row.id
			client.editTags(row.id)
			tagsOpen = true
		}}
		onemptyfocus={() => heading?.focus()}
	/>
</section>
<div class="capture-control">
	{#key client}<AddLink actor={client} />{/key}
</div>
<ArticleTags
	actor={client}
	row={$client.tagArticle && $client.tagArticle.id === tagArticleId
		? $client.tagArticle
		: view.rows.find((row) => row.id === tagArticleId)}
	tags={view.tags}
	enabled={view.canOrganize}
	bind:open={tagsOpen}
	onclose={() => {
		client.editTags(undefined)
		if (!tagTrigger?.isConnected) heading?.focus()
	}}
/>

<style>
	.library-header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		min-inline-size: 0;
	}

	.capture-control {
		grid-area: 1 / 1;
		align-self: end;
		position: sticky;
		inset-block-end: 0;
	}

	section {
		min-inline-size: 0;
	}
</style>
