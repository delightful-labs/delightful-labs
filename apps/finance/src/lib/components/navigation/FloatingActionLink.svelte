<script lang="ts">
	import { FloatingActionLink as SharedFloatingActionLink, Icon } from 'delightful-ui'
	import AppLink from '#lib/components/navigation/AppLink.svelte'
	import AddIcon from 'tdesign-icons-svg/src/add.svg?component'

	let { href, label }: { href: string; label: string } = $props()
</script>

<AppLink
	{href}
	component={SharedFloatingActionLink}
	aria-label={label}
	title={label}
	class="floating-action-link"
>
	<Icon icon={AddIcon} />
</AppLink>
