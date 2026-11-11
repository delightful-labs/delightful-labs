<script lang="ts">
	import '#lib/theme.css'
	import {
		Button,
		Icon,
		Details,
		Dialog,
		Popover,
		InputNumber,
		InputText,
		LoadingSpinner
	} from '#lib'

	let loadingPreview = $state(false)
	let dialogOpen = $state(false)
	let dialogMounted = $state(true)
	let lightDismissOpen = $state(false)
	let preventOpening = $state(false)
	let preventCancel = $state(false)
	let dialogResult = $state('None')
	let cancelStatus = $state('No cancel request')
	let absoluteOpen = $state(false)
	let lastToggle = $state('Not toggled')
	let submitted = $state<string | undefined>()
	let boundText = $state<string | undefined>()
	let boundNumber = $state<number | undefined>()

	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (!(event.currentTarget instanceof HTMLFormElement)) return
		submitted = JSON.stringify(
			Array.from(new FormData(event.currentTarget)),
			null,
			2
		)
	}
</script>

<main>
	<h1>Delightful UI</h1>
	<section aria-labelledby="popover-heading">
		<h2 id="popover-heading">Popover</h2>
		<div class="controls">
			<Button popovertarget="amount-info">About amounts</Button>
			<Button popovertarget="amount-info">More amount information</Button>
			<Button popovertarget="help-info">Help information</Button>
		</div>
		<Popover id="amount-info" title="Amount & tax" data-example="information">
			<p>Enter the total amount, including tax.</p>
			<a href="#input-heading">View input examples</a>
			<Button popovertarget="amount-info" popovertargetaction="hide"
				>Close amount information</Button
			>
		</Popover>
		<Popover id="help-info"><p>Contact your administrator for help.</p></Popover
		>
	</section>
	<section aria-labelledby="button-heading">
		<h2 id="button-heading">Button</h2>
		<div class="controls">
			<Button>Save</Button>
			<Button>
				<Icon style="width: 1em; height: 1em; vertical-align: -0.125em;">
					<path d="M5 12h14M13 6l6 6-6 6" />
				</Icon>
				Continue
			</Button>
			<Button disabled>Save</Button>
			<Button text="Text label" />
		</div>
	</section>
	<section aria-labelledby="input-heading">
		<h2 id="input-heading">Inputs</h2>
		<form onsubmit={submit} onreset={() => (submitted = undefined)}>
			<InputText
				label="Description"
				name="description"
				defaultValue="Example"
				required
			/>
			<InputText label="Category" name="category" list="category-options" />
			<datalist id="category-options">
				<option value="Personal"></option>
				<option value="Work"></option>
			</datalist>
			<InputNumber
				label="Quantity"
				name="quantity"
				defaultValue={0}
				min={0}
				max={100}
				required
			/>
			<InputNumber
				label="Measurement"
				name="measurement"
				defaultValue={1.25}
				step={0.01}
			/>
			<InputText
				label="Readonly"
				name="readonly"
				defaultValue="Included"
				readonly
			/>
			<InputText
				label="Disabled"
				name="disabled"
				defaultValue="Omitted"
				disabled
			/>
			<details>
				<summary>Optional value binding</summary>
				<div class="bound-fields">
					<InputText
						label="Bound text"
						name="bound-text"
						defaultValue="Preview"
						bind:value={boundText}
					/>
					<p>Current text: {boundText ?? ''}</p>
					<InputNumber
						label="Bound number"
						name="bound-number"
						defaultValue={2.5}
						step="any"
						bind:value={boundNumber}
					/>
					<p>Current number: {boundNumber ?? 'undefined'}</p>
				</div>
			</details>
			<div class="controls">
				<Button type="submit">Submit</Button>
				<Button type="reset">Reset</Button>
			</div>
		</form>
		<h3>Submitted FormData</h3>
		<pre aria-live="polite">{submitted ?? 'No submission yet.'}</pre>
	</section>
	<section aria-labelledby="details-heading">
		<h2 id="details-heading">Details</h2>
		<div class="inline-example">
			<Details open>
				{#snippet summary()}
					<strong>Inline details</strong>
				{/snippet}
				<a href="#input-heading">View input examples</a>
			</Details>
		</div>
		<div class="details-examples">
			<Details
				summary="Start-aligned panel"
				position="absolute"
				name="details-demo"
				bind:open={absoluteOpen}
			>
				<a href="#input-heading">View input examples</a>
			</Details>
			<div class="end-panel">
				<Details
					summary="End-aligned panel"
					position="absolute"
					align="end"
					name="details-demo"
					style="--dui-details-panel-width: 18rem;"
					ontoggle={(event) => {
						lastToggle = event.currentTarget.open
							? 'End panel opened'
							: 'End panel closed'
					}}
				>
					<a href="#button-heading">View button examples</a>
				</Details>
			</div>
		</div>
		<div class="controls">
			<Button onclick={() => (absoluteOpen = true)}>Open start panel</Button>
			<Button onclick={() => (absoluteOpen = false)}>Close start panel</Button>
		</div>
		<p aria-live="polite">Start panel: {absoluteOpen ? 'open' : 'closed'}</p>
		<p aria-live="polite">{lastToggle}</p>
	</section>
	<section aria-labelledby="dialog-heading">
		<h2 id="dialog-heading">Dialog</h2>
		<div class="controls">
			<Button
				onclick={() => {
					dialogMounted = true
					dialogOpen = true
				}}>Open dialog</Button
			>
			<Button
				aria-pressed={preventOpening}
				onclick={() => (preventOpening = !preventOpening)}
			>
				Prevent opening
			</Button>
			<Button onclick={() => (lightDismissOpen = true)}
				>Open light-dismiss dialog</Button
			>
		</div>
		<p>Prevent opening: {preventOpening ? 'on' : 'off'}</p>
		<p aria-live="polite">Dialog state: {dialogOpen ? 'open' : 'closed'}</p>
		<p aria-live="polite">Last dialog result: {dialogResult}</p>
		{#if dialogMounted}
			<Dialog
				heading="Review dialog"
				id="review-dialog"
				bind:open={dialogOpen}
				onbeforetoggle={(event) => {
					if (event.newState === 'open' && preventOpening)
						event.preventDefault()
				}}
				oncancel={(event) => {
					if (preventCancel) event.preventDefault()
					cancelStatus = event.defaultPrevented
						? 'Escape prevented'
						: 'Escape allowed'
				}}
				onclose={(event) => {
					dialogResult = event.currentTarget.returnValue || 'No return value'
				}}
			>
				<form method="dialog">
					<InputText
						label="Dialog note"
						name="dialog-note"
						defaultValue="Draft"
						required
					/>
					<div class="controls">
						<Button type="submit" value="save">Save dialog</Button>
						<Button type="submit" value="cancel" formnovalidate
							>Cancel dialog</Button
						>
					</div>
				</form>
				<div class="dialog-options">
					<Button
						aria-pressed={preventCancel}
						onclick={() => (preventCancel = !preventCancel)}
					>
						Prevent Escape
					</Button>
					<Button onclick={() => (dialogOpen = false)}>Close with state</Button>
					<Button
						onclick={() => {
							dialogOpen = false
							dialogMounted = false
						}}>Remove dialog</Button
					>
				</div>
				<p>Prevent Escape: {preventCancel ? 'on' : 'off'}</p>
				<p role="status">{cancelStatus}</p>
			</Dialog>
		{/if}
		<Dialog closedby="any" bind:open={lightDismissOpen}>
			{#snippet heading()}
				Light-dismiss dialog
			{/snippet}
			<form method="dialog">
				<Button type="submit" value="close">Close light-dismiss dialog</Button>
			</form>
		</Dialog>
		<p aria-live="polite">
			Light-dismiss state: {lightDismissOpen ? 'open' : 'closed'}
		</p>
	</section>
	<section aria-labelledby="loading-spinner-heading">
		<h2 id="loading-spinner-heading">LoadingSpinner</h2>
		<div class="spinner-examples">
			<div>
				<h3>Default</h3>
				<LoadingSpinner />
			</div>
			<div>
				<h3>Compact</h3>
				<LoadingSpinner
					text="Loading compact preview"
					style="--dui-loading-spinner-size: 32px; --dui-loading-spinner-border-width: 2px; --dui-loading-spinner-color: var(--dui-color-accent);"
				/>
			</div>
		</div>
		<h3>Loading state</h3>
		<Button
			aria-pressed={loadingPreview}
			onclick={() => (loadingPreview = !loadingPreview)}
		>
			Toggle loading preview
		</Button>
		<div aria-busy={loadingPreview}>
			<p>Preview content: {loadingPreview ? 'loading' : 'ready'}</p>
		</div>
		<LoadingSpinner
			id="loading-state-preview"
			text="Loading preview content"
			hidden={!loadingPreview}
		/>
	</section>
	<section aria-labelledby="theme-heading">
		<h2 id="theme-heading">Theme</h2>
		<a href="#input-heading">Input examples</a>
	</section>
</main>

<style>
	main {
		padding: var(--dui-space-lg, var(--dui-spacing-xl, 2rem));
	}

	section + section {
		margin-top: var(--dui-space-lg, var(--dui-spacing-xl, 2rem));
	}

	form,
	.bound-fields {
		display: grid;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}

	form {
		max-width: 32rem;
	}

	.bound-fields {
		margin-top: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}

	.bound-fields p {
		margin: 0;
	}

	.inline-example {
		max-width: 32rem;
	}

	.details-examples {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
		margin-block: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}

	.end-panel {
		margin-inline-start: auto;
		max-inline-size: 100%;
	}

	.dialog-options {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
		margin-top: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}

	.spinner-examples {
		display: flex;
		flex-wrap: wrap;
		align-items: start;
		gap: var(--dui-space-lg, var(--dui-spacing-xl, 2rem));
	}

	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: var(--dui-space-sm, var(--dui-spacing-md, 1rem));
	}
</style>
