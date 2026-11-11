<script lang="ts">
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import { page } from '$app/state'
	import { resolve } from '$app/paths'
	import { Text } from 'delightful-ui'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import { m } from '#lib/paraglide/messages.js'

	const title = $derived(
		page.status === 404 ? m['errors.not_found_title']() : m['errors.unexpected_title']()
	)
</script>

<svelte:head>
	<title>{page.status} · {title} · {m['app.name']()}</title>
</svelte:head>

<div>
	<PageHeader title={`${page.status} · ${title}`} />
	<Text>
		{page.status === 404
			? m['errors.not_found_description']()
			: m['errors.unexpected_description']()}
	</Text>
	<Text
		><AppLink href={resolve('/')}
			>{m['actions.back_to_subject']({ subject: m['navigation.overview']() })}</AppLink
		></Text
	>
</div>
