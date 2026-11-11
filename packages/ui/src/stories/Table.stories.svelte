<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf'
	import Table from '#lib/Components/Table.svelte'
	import Button from '#lib/Components/Button.svelte'

	const { Story } = defineMeta({
		title: 'Data/Table',
		component: Table,
		tags: ['autodocs'],
		args: { caption: 'Accounts' }
	})
</script>

<Story name="Accounts">
	{#snippet template(args)}
		<Table {...args}>
			<thead>
				<tr
					><th scope="col">Account</th><th scope="col">Type</th><th scope="col"
						>Currency</th
					><th scope="col">Actions</th></tr
				>
			</thead>
			<tbody>
				<tr
					><th scope="row">Personal checking</th><td>Bank</td><td>USD</td><td
						><Button aria-label="Archive Personal checking">Archive</Button></td
					></tr
				>
				<tr
					><th scope="row">Cash</th><td>Cash</td><td>USD</td><td
						><Button aria-label="Archive Cash">Archive</Button></td
					></tr
				>
			</tbody>
		</Table>
	{/snippet}
</Story>

<Story name="Transactions" args={{ caption: 'Recent transactions' }}>
	{#snippet template(args)}
		<Table {...args}>
			<thead
				><tr
					><th scope="col">Date</th><th scope="col" style="text-align: end"
						>Amount</th
					><th scope="col">Memo</th></tr
				></thead
			>
			<tbody>
				<tr
					><td>2026-10-14</td><td
						style="text-align: end; font-variant-numeric: tabular-nums"
						>$45.20</td
					><td>Groceries</td></tr
				>
				<tr
					><td>2026-10-13</td><td
						style="text-align: end; font-variant-numeric: tabular-nums"
						>$120.00</td
					><td>Household supplies</td></tr
				>
			</tbody>
		</Table>
	{/snippet}
</Story>

<Story
	name="Horizontal overflow"
	args={{
		caption: 'Accounts with details',
		style: '--dui-table-min-width: 48rem;'
	}}
>
	{#snippet template(args)}
		<div style="max-inline-size: 24rem;">
			<Table {...args}>
				<thead
					><tr
						><th scope="col">Account</th><th scope="col">Type</th><th
							scope="col">Currency</th
						><th scope="col">Notes</th><th scope="col">Actions</th></tr
					></thead
				>
				<tbody
					><tr
						><th scope="row">Personal checking</th><td>Bank</td><td>USD</td><td
							>Household expenses and recurring payments</td
						><td
							><Button aria-label="Archive Personal checking">Archive</Button
							></td
						></tr
					></tbody
				>
			</Table>
		</div>
	{/snippet}
</Story>

<Story name="Dark theme" args={{ caption: 'Recent transactions' }}>
	{#snippet template(args)}
		<div
			data-dui-theme="dark"
			style="--dui-color-foreground: #fff; --dui-color-background: #262626; color: var(--dui-color-foreground); background: var(--dui-color-background);"
		>
			<Table {...args}>
				<thead>
					<tr
						><th scope="col">Date</th><th scope="col">Amount</th><th scope="col"
							>Memo</th
						></tr
					>
				</thead>
				<tbody>
					<tr><td>2026-10-14</td><td>$45.20</td><td>Groceries</td></tr>
					<tr><td>2026-10-13</td><td>$120.00</td><td>Household supplies</td></tr
					>
				</tbody>
			</Table>
		</div>
	{/snippet}
</Story>
