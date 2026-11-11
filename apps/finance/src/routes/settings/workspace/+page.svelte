<script lang="ts">
	import { prepareBackupSubmission } from '#lib/backup/submission.js'
	import PageLayout from '#lib/components/navigation/PageLayout.svelte'
	import { getPageNavigation } from '#lib/components/navigation/page-navigation.js'
	const navigation = getPageNavigation()
	import { observeRow } from '#lib/runtime/observations.js'
	import { createScopedFormController } from '#lib/forms/forms.svelte.js'
	import { createWorkspaceRenameFormOptions } from '#lib/machines/workspaces/workspace-rename.js'
	import type { WorkspaceRenameObservation } from '#lib/contracts/workspace-rename-contract.js'
	import { workspaceNamingWrites } from '#lib/data.js'
	import { app } from '#lib/schema.js'
	import { getDb, getJazzSession } from 'jazz-tools/svelte'
	import {
		createQuerySubscription,
		createQuerySubscriptionOne
	} from 'delightful-local-first/backend/jazz/data'
	import { fromStore } from 'svelte/store'
	import { getContext, onDestroy } from 'svelte'
	import { createActor, toPromise } from 'xstate'
	import {
		createWorkspaceBackupMachine,
		selectWorkspaceBackup,
		type BackupObservation
	} from '#lib/machines/workspaces/workspace-backup.js'
	import { getReadiness } from '#lib/runtime/bank-sync.js'
	import { selectApplicationWorkspaceRestore } from '#lib/machines/runtime/application-readiness.js'
	import { prepareWorkspaceRestoreFile } from '#lib/machines/workspaces/workspace-restore.js'
	import WorkspaceBackup from '#lib/components/workspaces/WorkspaceBackup.svelte'
	import { financeFiltersKey, type FinanceFilters } from '#lib/filters/finance-filters.js'
	import { m } from '#lib/paraglide/messages.js'
	import PageHeader from '#lib/components/navigation/PageHeader.svelte'
	import { Heading } from 'delightful-ui'
	import WorkspaceSelector from '#lib/components/workspaces/WorkspaceSelector.svelte'
	import { getWorkspace } from '#lib/runtime/workspace.js'
	import QueryContent from '#lib/components/shared/QueryContent.svelte'
	import WorkspaceCreation from '#lib/components/workspaces/WorkspaceCreation.svelte'
	import WorkspaceNameForm from '#lib/components/workspaces/WorkspaceNameForm.svelte'
	import { organizationMembershipQuery } from '#lib/domain/organization-membership-query.js'
	import { ACCOUNT_CURRENCY } from '#lib/domain/account-currency.js'

	const filters = getContext<FinanceFilters>(financeFiltersKey)
	const coordinator = getWorkspace()
	const readiness = getReadiness()
	const root = fromStore(readiness.snapshot)
	const restoreView = $derived(selectApplicationWorkspaceRestore(root.current))

	const organizations = createQuerySubscription(() => app.organizations.orderBy('name'))
	const db = getDb()
	const session = fromStore(getJazzSession())
	const workspaceQuery = createQuerySubscriptionOne(() =>
		filters.activeOrganizationId
			? app.organizations.where({ id: filters.activeOrganizationId })
			: undefined
	)
	const membershipQuery = createQuerySubscriptionOne(() => {
		const userId = session.current.account?.id
		const organizationId = filters.activeOrganizationId
		return organizationMembershipQuery(organizationId, userId)
	})
	const workspace = $derived(workspaceQuery.current)
	function observe(): WorkspaceRenameObservation {
		return {
			identityId: session.current.account?.id ?? null,
			organizationId: filters.activeOrganizationId,
			binding: session.current.client?.db ?? null,
			sessionReady: session.current.status === 'ready',
			workspaceLoading: workspaceQuery.isLoading,
			membershipLoading: membershipQuery.isLoading,
			workspaceError: workspaceQuery.error != null,
			membershipError: membershipQuery.error != null,
			workspace: observeRow(workspaceQuery.current),
			membership: observeRow(membershipQuery.current)
		}
	}
	const options = createWorkspaceRenameFormOptions({
		binding: db,
		observe,
		...workspaceNamingWrites(db)
	})
	const form = createScopedFormController(options)
	function backupObservation(): BackupObservation {
		return {
			identityId: session.current.account?.id ?? null,
			workspaceId: filters.activeOrganizationId,
			membershipId: membershipQuery.current?.id ?? null,
			memberUserId: membershipQuery.current?.userId ?? null,
			ownerId: workspaceQuery.current?.ownerId ?? null,
			role: membershipQuery.current?.role ?? null,
			access: membershipQuery.current?.accountAccessMode ?? null,
			sessionReady: session.current.status === 'ready',
			attached: session.current.client?.db === db,
			loading: workspaceQuery.isLoading || membershipQuery.isLoading,
			failed: workspaceQuery.error != null || membershipQuery.error != null
		}
	}
	const backupActor = createActor(
		createWorkspaceBackupMachine({
			db,
			observe: backupObservation,
			environment: typeof window === 'undefined' ? 'finance' : window.location.origin,
			handoff: {
				async dispatch(archive, _binding, signal) {
					if (signal.aborted) return 'rejected'
					const link = document.createElement('a'),
						bytes = archive.copyBytes()
					let url: string | undefined
					try {
						url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
						link.href = url
						link.download = 'finance-backup.dlf'
						document.body.append(link)
						link.click()
						return 'dispatched'
					} finally {
						bytes.fill(0)
						link.remove()
						if (url) URL.revokeObjectURL(url)
					}
				}
			}
		}),
		{ input: {} }
	)
	let backupView = $state(selectWorkspaceBackup(backupActor.getSnapshot()))
	const backupSubscription = backupActor.subscribe((snapshot) => {
		backupView = selectWorkspaceBackup(snapshot)
	})
	backupActor.start()
	$effect(() => {
		backupActor.send({ type: 'OBSERVE', facts: backupObservation() })
	})
	onDestroy(() => {
		// Keep failed release visible after this route leaves; do not stop an unresolved owner.
		const reportRelease = () => {
			if (selectWorkspaceBackup(backupActor.getSnapshot()).canReload)
				readiness.actor.send({ type: 'RELOAD_REQUIRED' })
		}
		const releaseSubscription = backupActor.subscribe(reportRelease)
		reportRelease()
		const completion = toPromise(backupActor)
		backupActor.send({ type: 'SHUTDOWN' })
		const finish = () => {
			releaseSubscription.unsubscribe()
			backupSubscription.unsubscribe()
			backupActor.stop()
		}
		void completion.then(finish, finish)
	})
</script>

<svelte:head><title>{m['nouns.workspace']({ count: 2 })} · {m['app.name']()}</title></svelte:head>
<PageLayout {navigation}>
	{#snippet pageHeading()}<PageHeader title={m['nouns.workspace']({ count: 2 })} />{/snippet}
	<QueryContent
		queries={[organizations]}
		loadingMessage={m['status.loading_subject']({ subject: m['nouns.workspace']({ count: 2 }) })}
		errorMessage={m['errors.load_subject']({ subject: m['nouns.workspace']({ count: 2 }) })}
	>
		<WorkspaceSelector
			organizations={organizations.current}
			organizationId={filters.activeOrganizationId}
			label={m['actions.select_subject']({ subject: m['nouns.workspace']({ count: 1 }) })}
			onchange={(workspaceId) => coordinator.actor?.send({ type: 'SELECT_WORKSPACE', workspaceId })}
		/>
	</QueryContent>
	{#if filters.activeOrganizationId}
		<Heading level="h2"
			>{m['labels.subject_settings']({ subject: m['nouns.workspace']({ count: 1 }) })}</Heading
		>
		<WorkspaceNameForm
			name={workspace?.name ?? ''}
			defaultCurrency={workspace?.defaultCurrency === ACCOUNT_CURRENCY.TZS
				? ACCOUNT_CURRENCY.TZS
				: ACCOUNT_CURRENCY.USD}
			view={form.view}
			onsubmit={form.submit}
			onreset={form.reset}
			oninput={form.input}
			onRetryReadiness={form.retryReadiness}
		/>
		<WorkspaceBackup
			kind="download"
			view={backupView}
			ondownload={(protection, password) =>
				backupActor.send({
					type: 'SUBMIT',
					submission: prepareBackupSubmission(protection, password)
				})}
			oncancel={() => backupActor.send({ type: 'CANCEL' })}
			onreload={() => readiness.actor.send({ type: 'RELOAD' })}
		/>
	{/if}
	<WorkspaceBackup
		kind="restore"
		view={restoreView}
		onrestore={(file, password) =>
			readiness.actor.send({
				type: 'WORKSPACE_RESTORE',
				request: prepareWorkspaceRestoreFile(file, password)
			})}
		oncommand={(type) =>
			readiness.actor.send({ type: 'WORKSPACE_RESTORE_COMMAND', command: { type } })}
	/>
	<WorkspaceCreation />
</PageLayout>
