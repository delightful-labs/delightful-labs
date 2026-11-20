import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import {
	createClassificationOwner,
	createCategoryManagementFormOptions,
	createTagManagementFormOptions
} from './classification-forms.js'
import type { ManagementObservation } from '../../contracts/management-contract.js'
import type { ClassificationForm, WorkerFormCommand } from '../../contracts/worker-forms.js'

function fixture(held = false) {
	const binding = {},
		identityId = crypto.randomUUID(),
		organizationId = crypto.randomUUID()
	const category = {
		id: crypto.randomUUID(),
		organizationId,
		name: 'Food',
		kind: 'expense',
		isSystem: false,
		archivedAt: null
	} satisfies ManagementObservation['categories'][number]
	const tag = {
		id: crypto.randomUUID(),
		organizationId,
		name: 'Groceries',
		kind: 'expense',
		categoryId: category.id,
		archivedAt: null
	} satisfies ManagementObservation['tags'][number]
	let observation: ManagementObservation = {
		binding,
		identityId,
		organizationId,
		sessionReady: true,
		loading: false,
		failed: false,
		membership: {
			id: crypto.randomUUID(),
			organizationId,
			userId: identityId,
			role: 'owner',
			accountAccessMode: 'all',
			profileId: null
		},
		categories: [category],
		tags: [tag]
	}
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const createCategory = vi.fn<Parameters<typeof createCategoryManagementFormOptions>[0]['create']>(
		async (organizationId, values) => {
			entered.resolve()
			if (held) await release.promise
			return { ...category, ...values, organizationId, id: crypto.randomUUID() }
		}
	)
	const createTag = vi.fn<Parameters<typeof createTagManagementFormOptions>[0]['create']>(
		async (organizationId, values) => ({
			...tag,
			...values,
			organizationId,
			id: crypto.randomUUID()
		})
	)
	const archiveCategory = vi.fn(async (_id: string) => {}),
		archiveTag = vi.fn(async (_id: string) => {})
	const owner = createClassificationOwner({
		categories: createCategoryManagementFormOptions({
			binding,
			observe: () => observation,
			create: createCategory,
			archive: archiveCategory
		}),
		tags: createTagManagementFormOptions({
			binding,
			observe: () => observation,
			create: createTag,
			archive: archiveTag
		})
	})
	const actor = createActor(owner.logic, { input: observation }).start()
	return {
		actor,
		entered,
		release,
		category,
		tag,
		createCategory,
		createTag,
		archiveCategory,
		archiveTag,
		view: () => owner.selectReport(actor.getSnapshot()).view,
		report: () => owner.selectReport(actor.getSnapshot()),
		observe: (next: ManagementObservation) => {
			observation = next
			actor.send({ type: 'OBSERVE', observation })
		},
		facts: () => observation,
		command: (form: ClassificationForm, command: WorkerFormCommand) =>
			actor.send({ type: 'CLASSIFICATION', form, command }),
		ready: (form: ClassificationForm) =>
			waitFor(actor, (s) => owner.selectReport(s).view?.[form].canSubmit === true),
		idle: (form: ClassificationForm) =>
			waitFor(actor, (s) => owner.selectReport(s).view?.[form].activity.kind === 'idle')
	}
}

it('routes all four forms and projects their existing DTOs through one public report', async () => {
	const f = fixture()
	try {
		for (const [form, values] of [
			['createCategory', { name: 'Travel', kind: 'expense' }],
			['createTag', { name: 'Trip', kind: 'expense', categoryId: f.category.id }],
			['archiveCategory', { categoryId: f.category.id, organizationId: f.category.organizationId }],
			['archiveTag', { tagId: f.tag.id, organizationId: f.tag.organizationId }]
		] satisfies [ClassificationForm, Record<string, unknown>][]) {
			f.command(form, { type: 'OPEN' })
			await f.ready(form)
			f.command(form, { type: 'SUBMIT', values })
			await f.idle(form)
			expect(f.view()?.[form].feedback).toMatchObject({
				kind: 'result',
				result: { outcome: 'succeeded', settlement: 'locallyPersisted' }
			})
		}
		expect(f.createCategory).toHaveBeenCalledOnce()
		expect(f.createTag).toHaveBeenCalledOnce()
		expect(f.archiveCategory).toHaveBeenCalledWith(f.category.id)
		expect(f.archiveTag).toHaveBeenCalledWith(f.tag.id)
		f.actor.send({ type: 'SHUTDOWN' })
		expect(await toPromise(f.actor)).toEqual({ outcome: 'closed' })
	} finally {
		f.actor.stop()
	}
})

it('resets routed drafts and publishes only the current A → B → A observation', async () => {
	const f = fixture()
	const a = f.facts()
	try {
		f.command('createCategory', { type: 'OPEN' })
		await f.ready('createCategory')
		const revision = f.view()?.createCategory.draftRevision
		f.actor.send({ type: 'RESET' })
		expect(f.view()?.createCategory.draftRevision).toBe((revision ?? 0) + 1)
		f.observe({ ...a, organizationId: crypto.randomUUID(), membership: null })
		f.observe({ ...a })
		await f.ready('createCategory')
		expect(f.report().observation).toBe(f.facts())
		expect(f.createCategory).not.toHaveBeenCalled()
	} finally {
		f.actor.send({ type: 'SHUTDOWN' })
		await toPromise(f.actor)
	}
})

it.each(['duplicate', 'readOnly', 'reference'])(
	'retains %s refusal before persistence',
	async (reason) => {
		const f = fixture()
		try {
			if (reason === 'readOnly') {
				const membership = f.facts().membership
				if (!membership) throw new Error('Missing fixture membership')
				f.observe({ ...f.facts(), membership: { ...membership, role: 'viewer' } })
			}
			const form = reason === 'reference' ? 'createTag' : 'createCategory'
			f.command(form, { type: 'OPEN' })
			await f.idle(form)
			f.command(form, {
				type: 'SUBMIT',
				values: {
					name: reason === 'duplicate' ? ' FOOD ' : 'Travel',
					kind: 'expense',
					categoryId: crypto.randomUUID()
				}
			})
			await f.idle(form)
			expect(f.createCategory).not.toHaveBeenCalled()
			expect(f.createTag).not.toHaveBeenCalled()
			if (reason === 'readOnly')
				expect(f.view()?.[form].readiness).toEqual({ kind: 'blocked', reason: 'readOnly' })
			else
				expect(f.view()?.[form].feedback).toMatchObject({
					kind: 'result',
					result: {
						outcome: 'unavailable',
						reason: reason === 'duplicate' ? 'duplicateName' : 'unavailableReference'
					}
				})
		} finally {
			f.actor.send({ type: 'SHUTDOWN' })
			await toPromise(f.actor)
		}
	}
)

it.each(['route', 'workspace', 'session'])(
	'drains an issued write through %s replacement and shutdown without replay',
	async (replacement) => {
		const f = fixture(true)
		try {
			f.command('createCategory', { type: 'OPEN' })
			await f.ready('createCategory')
			f.command('createCategory', { type: 'SUBMIT', values: { name: 'Travel', kind: 'expense' } })
			await f.entered.promise
			if (replacement === 'route') f.actor.send({ type: 'RESET' })
			if (replacement === 'workspace')
				f.observe({ ...f.facts(), organizationId: crypto.randomUUID(), membership: null })
			if (replacement === 'session') f.observe({ ...f.facts(), binding: {}, sessionReady: false })
			f.actor.send({ type: 'SHUTDOWN' })
			f.actor.send({ type: 'RESET' })
			f.command('createCategory', { type: 'SUBMIT', values: { name: 'Late', kind: 'expense' } })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(f.createCategory).toHaveBeenCalledOnce()
			f.release.resolve()
			expect(await toPromise(f.actor)).toEqual({ outcome: 'closed' })
			expect(f.createCategory).toHaveBeenCalledOnce()
		} finally {
			f.release.resolve()
			f.actor.stop()
		}
	}
)

it('reports unexpected child completion without closing or stopping a sibling issued write', async () => {
	const f = fixture(true)
	try {
		f.command('createCategory', { type: 'OPEN' })
		await f.ready('createCategory')
		f.command('createCategory', { type: 'SUBMIT', values: { name: 'Travel', kind: 'expense' } })
		await f.entered.promise
		// Fault injection: a form completes before the feature requested shutdown.
		f.actor.getSnapshot().children.createTag?.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, () => f.report().failed)
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.actor.getSnapshot().children.createCategory?.getSnapshot().status).toBe('active')
		f.release.resolve()
		expect(await f.createCategory.mock.results[0]?.value).toMatchObject({ name: 'Travel' })
		expect(f.createCategory).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().status).toBe('active')
	} finally {
		f.release.resolve()
		f.actor.stop()
	}
})
