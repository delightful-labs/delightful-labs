<script lang="ts">
	import type { WorkflowMessage } from '../contracts/feedback.js'
	import type { Snippet } from 'svelte'
	import { SkipControl } from 'delightful-ui'
	import { t } from '../localization/index.js'
	import type { ReaderPreferences } from '../reader/schema.js'
	import { setAccountSettings } from '../runtime/account-settings.js'
	import { useWorkerLibrary } from '../runtime/worker/context.js'
	let {
		account,
		children,
		connectionMessage,
		accountMessage,
		runtimeFeedback
	}: {
		account: Snippet
		children: Snippet
		connectionMessage: WorkflowMessage | undefined
		accountMessage: WorkflowMessage | undefined
		runtimeFeedback: Snippet
	} = $props()
	setAccountSettings({
		get controls() {
			return account
		},
		get connectionMessage() {
			return connectionMessage
		},
		get accountMessage() {
			return accountMessage
		}
	})
	const library = useWorkerLibrary()
	let theme = $state<ReaderPreferences['theme']>('system')
	$effect(() => {
		const actor = library.actor
		if (!actor) {
			theme = 'system'
			return
		}
		const subscription = actor.subscribe((snapshot) => {
			const view = snapshot.view.readerExperience
			theme = view.preferences.theme
		})
		return () => subscription.unsubscribe()
	})
	$effect(() => {
		if (theme === 'system') document.documentElement.removeAttribute('data-dui-theme')
		else document.documentElement.setAttribute('data-dui-theme', theme)
		return () => document.documentElement.removeAttribute('data-dui-theme')
	})
</script>

<SkipControl href="#main-content">{t('navigation.skip_to_main_content')}</SkipControl>

<div class="app-shell">
	<main id="main-content" class="content">
		{@render runtimeFeedback()}
		{@render children()}
	</main>
</div>

<style>
	.app-shell {
		--dui-drawer-height: 100%;
		height: 100dvh;
		overflow: hidden;
	}
	.content {
		position: relative;
		box-sizing: border-box;
		scrollbar-gutter: stable;
		min-inline-size: 0;
		height: 100%;
		overflow: auto;
	}
	.content:has(:global(.reader-workspace)) {
		overflow-anchor: none;
	}
</style>
