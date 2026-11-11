<script lang="ts">
	import { InputDate, RadioGroup, RadioItem } from 'delightful-ui'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		start,
		end,
		onchange,
		onpreset
	}: {
		start: string
		end: string
		onchange: (start: string, end: string) => void
		onpreset: (days: number) => void
	} = $props()

	// Keep custom fields mounted while the parent propagates edited bounds,
	// including when either range matches a preset.
	let customRanges = $state<{ start: string; end: string }[]>([])
	const selected = $derived.by(() => {
		if (customRanges.some((range) => range.start === start && range.end === end)) return 'custom'
		const today = new Date()
		if (end === todayDateOnly(today)) {
			for (const days of [7, 30]) {
				const firstDay = new Date(today)
				firstDay.setDate(firstDay.getDate() - (days - 1))
				if (start === todayDateOnly(firstDay)) return String(days)
			}
		}
		return 'custom'
	})

	function selectCustom(nextStart: string, nextEnd: string) {
		customRanges = [
			{ start, end },
			{ start: nextStart, end: nextEnd }
		]
	}

	function changeRange(nextStart: string, nextEnd: string) {
		selectCustom(nextStart, nextEnd)
		onchange(nextStart, nextEnd)
	}
</script>

<div class="date-range-filter">
	<RadioGroup
		label={m['actions.filter_subject']({ subject: m['nouns.date']({ count: 2 }) })}
		value={selected}
		onchange={(event) => {
			const choice = event.currentTarget.value
			if (choice === 'custom') {
				selectCustom(start, end)
			} else if (choice === '7' || choice === '30') {
				customRanges = []
				onpreset(Number(choice))
			}
		}}
	>
		<RadioItem value="7">{m['labels.last_week']()}</RadioItem>
		<RadioItem value="30">{m['labels.last_month']()}</RadioItem>
		<RadioItem value="custom">{m['labels.custom']()}</RadioItem>
	</RadioGroup>
	{#if selected === 'custom'}
		<InputDate
			label={m['labels.start_subject']({ subject: m['nouns.date']({ count: 1 }) })}
			value={start}
			max={end}
			oninput={(event) => changeRange(event.currentTarget.value, end)}
		/>
		<InputDate
			label={m['labels.end_subject']({ subject: m['nouns.date']({ count: 1 }) })}
			value={end}
			min={start}
			oninput={(event) => changeRange(start, event.currentTarget.value)}
		/>
	{/if}
</div>

<style>
	.date-range-filter {
		--dui-input-font-size: 0.875rem;
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: var(--dui-spacing-md);
		min-inline-size: 0;
		max-inline-size: 100%;
	}
</style>
