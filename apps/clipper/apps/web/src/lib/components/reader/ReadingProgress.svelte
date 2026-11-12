<script lang="ts">
	import { t } from '../../localization/index.js'
	let { value }: { value: number } = $props()
	const percent = $derived(
		new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value * 100)
	)
</script>

<span class="reading-progress">{t('reader.progress', { percent })} </span>

<style>
	.reading-progress {
		display: inline-flex;
		align-items: center;
		gap: var(--dui-spacing-xs);
	}
</style>
