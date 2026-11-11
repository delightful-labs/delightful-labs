<script lang="ts">
	import { Button, Heading, InputText, Select } from 'delightful-ui'
	import { m } from '#lib/paraglide/messages.js'
	import type {
		selectWorkspaceBackup,
		BackupMessage
	} from '#lib/machines/workspaces/workspace-backup.js'
	import type {
		WorkspaceRestoreView,
		WorkspaceRestoreCommand
	} from '#lib/machines/workspaces/workspace-restore.js'
	type Props =
		| {
				kind: 'download'
				view: ReturnType<typeof selectWorkspaceBackup>
				ondownload: (protection: 'none' | 'password', password: string) => void
				oncancel: () => void
				onreload: () => void
		  }
		| {
				kind: 'restore'
				view: WorkspaceRestoreView
				onrestore: (file: File, password: string) => void
				oncommand: (type: WorkspaceRestoreCommand['type']) => void
		  }
	let props: Props = $props()
	let protection = $state('password'),
		password = $state(''),
		file = $state<File | undefined>()
	const messages: Record<
		Exclude<BackupMessage, undefined> | 'restoring' | 'done' | 'conflict',
		() => string
	> = {
		preparing: () => m['status.preparing_subject']({ subject: m['nouns.backup']({ count: 1 }) }),
		restoring: () => m['status.restoring_subject']({ subject: m['nouns.workspace']({ count: 1 }) }),
		done: () => m['status.done'](),
		conflict: () => m['errors.data_changed'](),
		downloaded: () => m['status.download_started'](),
		cancelled: () => m['status.cancelled'](),
		permissionDenied: () => m['errors.permission_denied'](),
		dataChanged: () => m['errors.data_changed'](),
		failed: () => m['errors.operation_failed'](),
		password: () => m['forms.enter_subject']({ subject: m['labels.password']() })
	}
	$effect(() => {
		if (!props.view.editable) {
			password = ''
			file = undefined
		}
	})
	function submit(event: SubmitEvent) {
		event.preventDefault()
		if (props.kind === 'download')
			props.ondownload(protection === 'none' ? 'none' : 'password', password)
		else if (file) props.onrestore(file, password)
		password = ''
	}
</script>

{#if props.kind === 'download'}
	<Heading level="h2">{m['nouns.backup']({ count: 1 })}</Heading>
	<form onsubmit={submit}>
		<Select
			id="workspace-backup-protection"
			label={m['nouns.backup']({ count: 1 })}
			bind:value={protection}
			disabled={!props.view.editable}
		>
			<option value="password">{m['labels.with_password']()}</option><option value="none"
				>{m['labels.without_password']()}</option
			>
		</Select>
		{#if protection === 'password'}<InputText
				id="workspace-backup-password"
				type="password"
				label={m['labels.password']()}
				bind:value={password}
				autocomplete="new-password"
				disabled={!props.view.editable}
			/>{/if}
		<Button type="submit" disabled={!props.view.canDownload}
			>{m['actions.download_subject']({ subject: m['nouns.backup']({ count: 1 }) })}</Button
		>
		{#if props.view.canCancel}<Button type="button" onclick={props.oncancel}
				>{m['actions.cancel']()}</Button
			>{/if}
		{#if props.view.canReload}<Button type="button" onclick={props.onreload}
				>{m['actions.retry']()}</Button
			>{/if}
		{#if props.view.message}<p role={props.view.alert ? 'alert' : 'status'}>
				{messages[props.view.message]()}
			</p>{/if}
	</form>
{:else}
	<section
		aria-label={m['actions.restore_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}
	>
		<Heading level="h2"
			>{m['actions.restore_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}</Heading
		>
		{#if props.view.editable}
			<form onsubmit={submit}>
				<label for="workspace-restore-file">{m['nouns.backup']({ count: 1 })}</label>
				<input
					id="workspace-restore-file"
					type="file"
					accept=".dlf"
					required
					onchange={(event) => {
						file = event.currentTarget.files?.[0]
					}}
				/>
				<InputText
					id="workspace-restore-password"
					type="password"
					label={m['labels.password']()}
					bind:value={password}
					autocomplete="current-password"
				/>
				<Button type="submit" disabled={!file}
					>{m['actions.restore_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}</Button
				>
			</form>
		{/if}
		{#if props.view.canConfirm}
			<p>
				{m['labels.subject_name']({ subject: m['nouns.workspace']({ count: 1 }) })}: {props.view
					.workspaceName}
			</p>
			<Button type="button" onclick={() => props.kind === 'restore' && props.oncommand('CONFIRM')}
				>{props.view.confirmAction === 'retry'
					? m['actions.retry']()
					: m['actions.create_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}</Button
			>
		{/if}
		{#if props.view.canRetryRelease}<Button
				type="button"
				onclick={() => props.kind === 'restore' && props.oncommand('RETRY_RELEASE')}
				>{m['actions.retry']()}</Button
			>{/if}
		{#if props.view.canReload}<Button
				type="button"
				onclick={() => props.kind === 'restore' && props.oncommand('RELOAD')}
				>{m['actions.retry']()}</Button
			>{/if}
		{#if props.view.canCancel}<Button
				type="button"
				onclick={() => props.kind === 'restore' && props.oncommand('CANCEL')}
				>{m['actions.cancel']()}</Button
			>{/if}
		{#if props.view.canOpen}<Button
				type="button"
				onclick={() => props.kind === 'restore' && props.oncommand('OPEN')}
				>{m['actions.open_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}</Button
			>{/if}
		{#if !props.view.busy && props.view.visibleOutsideSettings}<Button
				type="button"
				onclick={() => props.kind === 'restore' && props.oncommand('DISMISS')}
				>{m['actions.close']()}</Button
			>{/if}
		{#if props.view.message}<p role={props.view.alert ? 'alert' : 'status'}>
				{messages[props.view.message]()}
			</p>{/if}
	</section>
{/if}
