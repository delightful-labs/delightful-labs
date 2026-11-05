<script lang="ts">
	import { tick, untrack } from 'svelte'
	import type { HTMLInputAttributes } from 'svelte/elements'
	import ScreenReaderText from '../ScreenReaderText.svelte'
	import Button from '../Button.svelte'
	import InputWrapper from './InputWrapper.svelte'

	type Props = {
		label: string
		addLabel: string
		removeLabel: (tag: string) => string
		selectedTagsLabel: string
		addedMessage: (tag: string) => string
		removedMessage: (tag: string) => string
		duplicateMessage: (tag: string) => string
		instructions?: string
		errorMessage?: string
		'aria-describedby'?: HTMLInputAttributes['aria-describedby']
		'aria-invalid'?: HTMLInputAttributes['aria-invalid']
		value?: string[]
		defaultValue?: string[]
		suggestions?: string[]
		normalizeTag?: (tag: string) => string
		name?: string
		id?: string
		placeholder?: string
		disabled?: boolean
		readonly?: boolean
	}

	const generatedId = $props.id()
	let {
		label,
		addLabel,
		removeLabel,
		selectedTagsLabel,
		addedMessage,
		removedMessage,
		duplicateMessage,
		instructions,
		errorMessage,
		'aria-describedby': ariaDescribedby,
		'aria-invalid': ariaInvalid,
		value = $bindable(),
		defaultValue = [],
		suggestions = [],
		normalizeTag = (tag: string) => tag.toLowerCase(),
		name,
		id,
		placeholder,
		disabled = false,
		readonly = false
	}: Props = $props()

	untrack(() => {
		if (value === undefined) value = [...defaultValue]
	})
	let tagsList = $state<HTMLUListElement>()
	let status = $state('')
	let duplicate = $state(false)
	let announcementVersion = 0
	async function announce(message: string, isDuplicate = false) {
		const version = ++announcementVersion
		status = ''
		duplicate = isDuplicate
		await tick()
		if (version === announcementVersion) status = message
	}
	function clearFeedback() {
		announcementVersion++
		status = ''
		duplicate = false
	}
	let draft = $state('')
	let input: HTMLInputElement
	let popup: HTMLDivElement
	let focused = $state(false)
	let dismissed = $state(false)
	let expanded = $state(false)
	let nativePopover = $state(true)
	let activeIndex = $state(-1)
	function comparisonKey(tag: string) {
		return normalizeTag(tag.trim())
	}
	const matches = $derived.by(() => {
		const selected = (value ?? []).map(comparisonKey)
		const seen: string[] = []
		const query = comparisonKey(draft)
		return suggestions
			.map((tag) => tag.trim())
			.filter((tag) => {
				const key = comparisonKey(tag)
				if (!tag || selected.includes(key) || seen.includes(key)) return false
				seen.push(key)
				return key.includes(query)
			})
	})
	const inputId = $derived(id ?? generatedId)
	const listId = `${generatedId}-suggestions`
	const instructionsId = `${generatedId}-instructions`
	const errorId = `${generatedId}-error`
	const statusId = `${generatedId}-status`
	const describedby = $derived(
		[
			ariaDescribedby,
			instructions ? instructionsId : undefined,
			errorMessage ? errorId : undefined,
			duplicate ? statusId : undefined
		]
			.filter(Boolean)
			.join(' ') || undefined
	)
	const locked = $derived(disabled || readonly)

	function add(tagText = draft) {
		if (locked) return
		const tag = tagText.trim()
		if (!tag) return
		const key = comparisonKey(tag)
		if (value?.some((item) => comparisonKey(item) === key)) {
			void announce(duplicateMessage(tag), true)
			return
		}
		value = [...(value ?? []), tag]
		void announce(addedMessage(tag))
		draft = ''
		dismissed = true
		activeIndex = -1
		input.focus()
	}

	async function remove(index: number) {
		if (locked) return
		const tag = value?.[index]
		if (tag === undefined) return
		value = (value ?? []).filter((_, itemIndex) => itemIndex !== index)
		void announce(removedMessage(tag))
		await tick()
		const buttons = tagsList?.querySelectorAll<HTMLButtonElement>('button')
		const next = buttons?.[Math.min(index, buttons.length - 1)]
		if (next) next.focus()
		else input.focus()
	}

	function position() {
		if (!popup || !expanded) return
		const rect = input.getBoundingClientRect()
		const viewport = window.visualViewport
		const left = viewport?.offsetLeft ?? 0
		const top = viewport?.offsetTop ?? 0
		const width = viewport?.width ?? window.innerWidth
		const height = viewport?.height ?? window.innerHeight
		const margin = 8
		const gap = 4
		if (
			rect.bottom < top ||
			rect.top > top + height ||
			rect.right < left ||
			rect.left > left + width
		) {
			dismissed = true
			return
		}
		const popupWidth = Math.min(rect.width, Math.max(0, width - margin * 2))
		popup.style.width = `${popupWidth}px`
		popup.style.left = `${Math.max(left + margin, Math.min(rect.left, left + width - popupWidth - margin))}px`
		const below = Math.max(0, top + height - rect.bottom - margin - gap)
		const above = Math.max(0, rect.top - top - margin - gap)
		const desired = Math.min(popup.scrollHeight, 240)
		const useAbove = below < desired && above > below
		popup.style.maxHeight = `${Math.min(240, useAbove ? above : below)}px`
		popup.style.top = `${useAbove ? rect.top - gap - popup.getBoundingClientRect().height : rect.bottom + gap}px`
	}

	$effect(() => {
		if (activeIndex >= matches.length) activeIndex = -1
	})

	$effect(() => {
		const visible = focused && !dismissed && !locked && matches.length > 0
		if (!popup) return
		nativePopover = typeof popup.showPopover === 'function'
		if (!nativePopover) {
			expanded = visible
			if (visible) position()
			return
		}
		if (visible) {
			if (!popup.matches(':popover-open')) popup.showPopover()
			position()
		} else if (popup.matches(':popover-open')) popup.hidePopover()
	})

	$effect(() => {
		if (!expanded) return
		// This input controls a manual popover. Native auto-popover dismissal
		// can race with the pointer gesture that first focuses the input.
		function outsidePointer(event: PointerEvent) {
			if (!(event.target instanceof Node)) return
			if (input.contains(event.target) || popup.contains(event.target)) return
			dismissed = true
			activeIndex = -1
		}
		const observer = new ResizeObserver(position)
		observer.observe(input)
		document.addEventListener('pointerdown', outsidePointer, true)
		window.addEventListener('resize', position)
		window.addEventListener('scroll', position, true)
		window.visualViewport?.addEventListener('resize', position)
		window.visualViewport?.addEventListener('scroll', position)
		return () => {
			observer.disconnect()
			document.removeEventListener('pointerdown', outsidePointer, true)
			window.removeEventListener('resize', position)
			window.removeEventListener('scroll', position, true)
			window.visualViewport?.removeEventListener('resize', position)
			window.visualViewport?.removeEventListener('scroll', position)
		}
	})

	function keydown(event: KeyboardEvent) {
		if (event.isComposing || event.keyCode === 229) return
		if (event.key === 'Escape') {
			if (expanded) event.preventDefault()
			dismissed = true
			activeIndex = -1
		} else if (
			(event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
			!locked &&
			matches.length
		) {
			event.preventDefault()
			dismissed = false
			activeIndex =
				event.key === 'ArrowDown'
					? (activeIndex + 1) % matches.length
					: activeIndex <= 0
						? matches.length - 1
						: activeIndex - 1
			void tick().then(() =>
				document
					.getElementById(`${listId}-${activeIndex}`)
					?.scrollIntoView({ block: 'nearest' })
			)
		} else if (event.key === 'Enter') {
			event.preventDefault()
			add(expanded && activeIndex >= 0 ? matches[activeIndex] : input.value)
		}
	}

	function commitOnMobileAction(event: Event) {
		if (
			!(event instanceof InputEvent) ||
			event.isComposing ||
			!['insertLineBreak', 'insertParagraph'].includes(event.inputType)
		)
			return
		event.preventDefault()
		add(expanded && activeIndex >= 0 ? matches[activeIndex] : input.value)
	}

	function registerReset(node: HTMLInputElement) {
		const form = node.form
		function reset(event: Event) {
			queueMicrotask(() => {
				if (event.defaultPrevented) return
				value = [...defaultValue]
				draft = ''
				clearFeedback()
				dismissed = true
				activeIndex = -1
			})
		}
		form?.addEventListener('reset', reset)
		return { destroy: () => form?.removeEventListener('reset', reset) }
	}
</script>

<InputWrapper title={label} key={inputId}>
	<div class="tag-list">
		{#if value?.length}
			<ul
				bind:this={tagsList}
				class="selected-tags"
				role="list"
				aria-label={selectedTagsLabel}
			>
				{#each value as tag, index (index)}
					<li class="tag">
						<span>{tag}</span>
						<button
							type="button"
							disabled={locked}
							aria-label={removeLabel(tag)}
							onclick={() => remove(index)}
							><span aria-hidden="true">×</span></button
						>
					</li>
				{/each}
			</ul>
		{/if}
		{#each value ?? [] as tag, index (index)}
			{#if name}
				<input type="hidden" {name} value={tag} {disabled} />
			{/if}
		{/each}
		<div class="entry">
			<input
				use:registerReset
				bind:this={input}
				bind:value={draft}
				id={inputId}
				type="text"
				{placeholder}
				{disabled}
				{readonly}
				aria-describedby={describedby}
				aria-invalid={ariaInvalid ?? (errorMessage ? true : undefined)}
				role={suggestions.length ? 'combobox' : undefined}
				autocomplete="off"
				enterkeyhint="done"
				aria-autocomplete={suggestions.length ? 'list' : undefined}
				aria-expanded={suggestions.length ? expanded : undefined}
				aria-controls={suggestions.length ? listId : undefined}
				aria-activedescendant={expanded && activeIndex >= 0
					? `${listId}-${activeIndex}`
					: undefined}
				onfocus={() => {
					focused = true
					dismissed = false
				}}
				onclick={() => {
					dismissed = false
				}}
				onblur={() => {
					focused = false
					activeIndex = -1
				}}
				oninput={() => {
					clearFeedback()
					dismissed = false
					activeIndex = -1
				}}
				onkeydown={keydown}
				onbeforeinput={commitOnMobileAction}
			/>
			<Button appearance="flat" disabled={locked} onclick={() => add()}
				>{addLabel}</Button
			>
		</div>
	</div>
	{#if instructions}
		<p class="help" id={instructionsId}>{instructions}</p>
	{/if}
	{#if errorMessage}
		<p class="error" id={errorId}>{errorMessage}</p>
	{/if}
	<div role="status" aria-atomic="true" id={statusId}>
		{#if duplicate}
			<p class="feedback">{status}</p>
		{:else}
			<ScreenReaderText>{status}</ScreenReaderText>
		{/if}
	</div>
	<div
		bind:this={popup}
		id={listId}
		class="suggestions"
		popover={nativePopover ? 'manual' : undefined}
		hidden={!nativePopover && !expanded}
		role="listbox"
		aria-label={label}
		onbeforetoggle={(event) => {
			expanded = event.newState === 'open'
			if (!expanded) {
				dismissed = true
				activeIndex = -1
			}
		}}
	>
		{#each matches as suggestion, index (suggestion)}
			<div
				id={`${listId}-${index}`}
				role="option"
				aria-selected={activeIndex === index}
				tabindex="-1"
				onmousedown={(event) => {
					// Canceling pointerdown suppresses touch clicks in WebKit.
					// Prevent the compatibility mouse event from moving focus instead.
					event.preventDefault()
				}}
				onclick={() => add(suggestion)}
				onkeydown={(event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault()
						add(suggestion)
					}
				}}
			>
				{suggestion}
			</div>
		{/each}
	</div>
</InputWrapper>

<style>
	@property --dui-tag-background-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-tag-color {
		syntax: '*';
		inherits: true;
	}

	@property --dui-tag-entry-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-tag-gap {
		syntax: '*';
		inherits: true;
	}

	@property --dui-tag-min-height {
		syntax: '<length-percentage>';
		inherits: true;
		initial-value: 48px;
	}

	@property --dui-tag-remove-background-color-hover {
		syntax: '*';
		inherits: true;
	}

	.help,
	.error,
	.feedback {
		margin: 0;
		font-family: var(--dui-field-font-family, var(--dui-font-family, inherit));
	}

	.error {
		color: var(--dui-input-error-color, var(--dui-color-error, #b91c1c));
	}

	.selected-tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-tag-gap, var(--dui-space-sm, var(--dui-spacing-md, 1rem)));
		list-style: none;
		margin: 0;
		padding: 0;
		min-width: 0;
		max-width: 100%;
	}

	.suggestions {
		z-index: 1;
		position: fixed;
		inset: auto;
		margin: 0;
		padding: 0;
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
		border: var(--dui-input-border-width, var(--dui-border-width, 2px)) solid
			var(--dui-input-border-color, var(--dui-color-foreground, #262626));
		background: var(--dui-color-background, #fff);
		color: var(--dui-color-foreground, #262626);
		font-family: var(
			--dui-input-font-family,
			var(--dui-font-family, monospace)
		);
	}

	.suggestions [role='option'] {
		padding: var(--dui-spacing-xs, 0.5rem) var(--dui-spacing-md, 1rem);
		min-height: 44px;
		box-sizing: border-box;
		overflow-wrap: anywhere;
		cursor: pointer;
	}

	.suggestions [role='option']:hover,
	.suggestions [aria-selected='true'] {
		background: var(--dui-color-accent, #94ff47);
		color: var(--dui-color-on-accent, #262626);
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--dui-tag-gap, var(--dui-space-sm, var(--dui-spacing-md, 1rem)));
		min-width: 0;
	}

	.tag {
		display: flex;
		align-items: stretch;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 100%;
		min-height: var(--dui-tag-min-height, 48px);
		font-family: var(
			--dui-input-font-family,
			var(--dui-font-family, monospace)
		);
		color: var(--dui-tag-color, var(--dui-color-on-accent, #262626));
		background: var(
			--dui-tag-background-color,
			var(--dui-color-accent, #94ff47)
		);
	}

	.tag > span {
		align-self: center;
		padding: var(--dui-spacing-xs, 0.5rem) 0 var(--dui-spacing-xs, 0.5rem)
			var(--dui-spacing-md, 1rem);
		overflow-wrap: anywhere;
		min-width: 0;
	}

	.tag button {
		appearance: none;
		flex: 0 0 auto;
		min-width: 40px;
		padding: var(--dui-spacing-xs, 0.5rem);
		border: 0;
		border-radius: 0;
		font: inherit;
		color: inherit;
		background: transparent;
		cursor: pointer;
	}

	.tag button:hover:not(:disabled) {
		background: var(--dui-tag-remove-background-color-hover, rgb(0 0 0 / 10%));
	}

	.tag button:focus-visible {
		outline: 2px solid
			var(--dui-input-focus-color, var(--dui-color-focus, #262626));
		outline-offset: 4px;
	}

	.tag button:disabled {
		opacity: var(--dui-input-disabled-opacity, 0.5);
		cursor: not-allowed;
	}

	.entry {
		display: flex;
		flex: 1 1 16rem;
		flex-wrap: wrap;
		align-items: stretch;
		gap: var(--dui-tag-entry-gap, var(--dui-spacing-xs, 0.5rem));
		min-width: 0;
		--dui-button-padding: var(--dui-spacing-xs, 0.5rem)
			var(--dui-spacing-sm, 0.75rem);
		--dui-button-min-height: var(--dui-tag-min-height, 48px);
	}

	.entry input {
		flex: 1 1 8rem;
		width: 0;
		min-height: var(--dui-tag-min-height, 48px);
	}

	@media (forced-colors: active) {
		.tag {
			outline: 1px solid CanvasText;
		}
		.tag button:focus-visible {
			outline-color: Highlight;
		}
	}
</style>
