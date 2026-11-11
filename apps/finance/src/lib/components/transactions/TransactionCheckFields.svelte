<script lang="ts">
	import { untrack } from 'svelte'
	import { InputText, InputDate, FieldFeedback } from 'delightful-ui'
	import type { Check } from '#lib/schema.js'
	import { todayDateOnly } from '#lib/domain/date-only.js'
	import { m } from '#lib/paraglide/messages.js'
	let {
		active,
		initialCheck,
		issues = []
	}: {
		active: boolean
		initialCheck?: Pick<Check, 'id' | 'checkNumber' | 'checkDate'> | undefined
		issues?: readonly { path: readonly PropertyKey[] }[]
	} = $props()
	let number = $state(untrack(() => initialCheck?.checkNumber ?? ''))
	let date = $state(untrack(() => initialCheck?.checkDate ?? todayDateOnly()))

	function invalid(field: string) {
		return issues.some((issue) => issue.path.at(-1) === field)
	}
</script>

<fieldset hidden={!active} disabled={!active}>
	{#if initialCheck}<input type="hidden" name="checkId" value={initialCheck.id} />{/if}

	<InputText
		name="checkNumber"
		id="check-number"
		label={m['labels.subject_number']({ subject: m['nouns.check']({ count: 1 }) })}
		bind:value={number}
		aria-invalid={invalid('checkNumber') || undefined}
		aria-describedby="check-number-feedback"
		required={active}
	/>
	<FieldFeedback
		id="check-number-feedback"
		errorMessage={invalid('checkNumber')
			? m['forms.enter_subject']({
					subject: m['labels.subject_number']({ subject: m['nouns.check']({ count: 1 }) })
				})
			: ''}
	/>
	<InputDate
		name="checkDate"
		id="check-date"
		label={m['labels.subject_date']({ subject: m['nouns.check']({ count: 1 }) })}
		bind:value={date}
		aria-invalid={invalid('checkDate') || undefined}
		aria-describedby="check-date-feedback"
		required={active}
	/>
	<FieldFeedback
		id="check-date-feedback"
		errorMessage={invalid('checkDate')
			? m['forms.enter_subject']({
					subject: m['labels.subject_date']({ subject: m['nouns.check']({ count: 1 }) })
				})
			: ''}
	/>
</fieldset>
