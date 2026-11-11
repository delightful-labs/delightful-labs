<script lang="ts">
	import { Button, Details } from 'delightful-ui'
	import type {
		BankMessage,
		BankLogPresentation
	} from '#lib/contracts/bank-presentation-contract.js'
	import { m } from '#lib/paraglide/messages.js'
	import { getLocale } from '#lib/paraglide/runtime.js'

	let {
		connections,
		connectionId,
		onConnection,
		attempts,
		accounts,
		profiles,
		hasEarlier,
		onEarlier
	}: {
		connections: BankLogPresentation['connections']
		connectionId: string | undefined
		onConnection: (id: string) => void
		attempts: BankLogPresentation['attempts']
		accounts: BankLogPresentation['accounts']
		profiles: readonly { userId: string; displayName: string | null }[]
		hasEarlier: boolean
		onEarlier: () => void
	} = $props()

	const dates = $derived(
		new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'medium' })
	)
	const numbers = $derived(new Intl.NumberFormat(getLocale()))
	function count(value: number | null) {
		return value === null ? m['labels.unspecified']() : numbers.format(value)
	}
	function initiator(id: string) {
		return (
			profiles.find((profile) => profile.userId === id)?.displayName || m['developer.unavailable']()
		)
	}
</script>

{#snippet counts(
	result: Pick<
		BankLogPresentation['attempts'][number],
		'importedCount' | 'existingCount' | 'omittedCount'
	>
)}
	<dt>{m['actions.imported']()}</dt>
	<dd>{count(result.importedCount)}</dd>
	<dt>{m['actions.existing']()}</dt>
	<dd>{count(result.existingCount)}</dd>
	<dt>{m['actions.omitted']()}</dt>
	<dd>{count(result.omittedCount)}</dd>
{/snippet}

{#snippet failure(message: BankMessage | undefined)}
	{#if message}<dt>{m['labels.description']()}</dt>
		<dd>{message.label()}</dd>{/if}
{/snippet}

<section aria-label={m['bank.log_title']()}>
	<h2>{m['bank.log_title']()}</h2>
	{#if connections.length > 0}
		<label>
			{m['bank.title']()}
			<select value={connectionId} onchange={(event) => onConnection(event.currentTarget.value)}>
				{#each connections as connection (connection.id)}
					<option value={connection.id}
						>{`${dates.format(connection.claimedAt)} — ${connection.ownerId ? initiator(connection.ownerId) : m['developer.unavailable']()} (${connection.status.label()})`}</option
					>
				{/each}
			</select>
		</label>
	{/if}
	{#if attempts.length === 0}
		<p>{m['labels.no_subjects_yet']({ subjects: m['bank.log_title']() })}</p>
	{/if}
	{#each attempts as attempt (attempt.id)}
		<Details summary={`${dates.format(attempt.startedAt)} — ${attempt.outcome.label()}`}>
			<dl>
				<dt>{m['labels.start_subject']({ subject: m['nouns.date']({ count: 1 }) })}</dt>
				<dd>
					<time datetime={attempt.startedAt.toISOString()}>{dates.format(attempt.startedAt)}</time>
				</dd>
				<dt>{m['labels.end_subject']({ subject: m['nouns.date']({ count: 1 }) })}</dt>
				<dd>
					{attempt.finishedAt === null
						? m['labels.unspecified']()
						: dates.format(attempt.finishedAt)}
				</dd>
				<dt>{m['transactions.created_by']()}</dt>
				<dd>{initiator(attempt.initiatedBy)}</dd>
				{@render counts(attempt)}
				<dt>{m['labels.status_subject']({ subject: m['bank.title']() })}</dt>
				<dd>{attempt.importSettlement.label()}</dd>
				{@render failure(attempt.failure)}
			</dl>
			{#each accounts.filter((row) => row.attemptId === attempt.id) as account (account.id)}
				<Details summary={`${account.accountName} — ${account.outcome.label()}`}>
					<dl>
						{@render counts(account)}
						{@render failure(account.failure)}
					</dl>
				</Details>
			{/each}
		</Details>
	{/each}
	{#if hasEarlier}<Button onclick={onEarlier}
			>{m['labels.more_subjects']({ subjects: m['bank.log_title']() })}</Button
		>{/if}
</section>

<style>
	select {
		max-inline-size: 100%;
	}
</style>
