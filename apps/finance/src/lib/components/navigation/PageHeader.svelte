<script lang="ts">
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import { Heading, Text } from 'delightful-ui'

	let { title, action }: { title: string; action?: { href: string; label: string } } = $props()
</script>

<Heading level="h1">{title}</Heading>
{#if action}<Text><AppLink href={action.href}>{action.label}</AppLink></Text>{/if}
