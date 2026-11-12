import { expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import { createArticleCollectionMachine } from './article-collection.js'
import { fixtureDocument, fixtureAttachment } from '../../capture/fixtures.test-support.js'
import type { CaptureDocument } from '../../contracts/articles.js'
function fixture() {
	let publish: (rows: CaptureDocument[]) => void = () => {},
		fail: () => void = () => {},
		current = true
	const release = vi.fn(),
		releaseTags = vi.fn(),
		next = vi.fn(),
		error = vi.fn()
	const actor = createActor(
		createArticleCollectionMachine({
			isCurrent: () => current,
			articles: (update, onError) => {
				publish = update
				fail = onError
				return release
			},
			tags: (update) => {
				update([])
				return releaseTags
			}
		}),
		{ input: { next, error } }
	).start()
	return {
		actor,
		publish,
		fail,
		next,
		error,
		release,
		releaseTags,
		expire: () => {
			current = false
		}
	}
}
it('lists only saved Documents with joined metadata and numeric progress in creation order', async () => {
	const f = fixture(),
		attachment = fixtureAttachment(),
		first = fixtureDocument({ id: 'one', attachment, createdAt: new Date('2026-11-01') }),
		second = fixtureDocument({ id: 'two', attachment, createdAt: new Date('2026-11-02') })
	expect(f.next).not.toHaveBeenCalled()
	f.publish([first, second])
	await vi.waitFor(() => expect(f.next).toHaveBeenCalledOnce())
	expect(f.next).toHaveBeenLastCalledWith([
		expect.objectContaining({
			id: 'two',
			title: 'Saved title',
			readingProgress: 0,
			readable: true
		}),
		expect.objectContaining({ id: 'one', title: 'Saved title', readingProgress: 0, readable: true })
	])
	f.actor.send({ type: 'STOP' })
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.releaseTags).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().context).toEqual({
		articles: [],
		organization: [],
		tags: [],
		callbacks: undefined
	})
	f.publish([])
	expect(f.next).toHaveBeenCalledOnce()
})
it('coalesces joined content updates and derives excerpts without separate preview subscriptions', async () => {
	const f = fixture(),
		document = fixtureDocument({ attachment: fixtureAttachment({ text: 'Body excerpt' }) })
	f.publish([document])
	f.publish([{ ...document, readingProgress: 0.5 }])
	await vi.waitFor(() => expect(f.next).toHaveBeenCalledOnce())
	expect(f.next).toHaveBeenLastCalledWith([
		expect.objectContaining({ excerpt: 'Body excerpt', readingProgress: 0.5 })
	])
	f.actor.send({ type: 'STOP' })
})
it('fails once and releases subscriptions before ignoring late native callbacks', () => {
	const f = fixture()
	f.fail()
	f.fail()
	expect(f.error).toHaveBeenCalledOnce()
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.releaseTags).toHaveBeenCalledOnce()
})
it('suppresses updates and errors after account replacement', () => {
	const f = fixture()
	f.expire()
	f.publish([fixtureDocument()])
	f.fail()
	expect(f.next).not.toHaveBeenCalled()
	expect(f.error).not.toHaveBeenCalled()
	expect(f.release).toHaveBeenCalledOnce()
})
it('releases an acquired subscription when another subscription fails to open', () => {
	const release = vi.fn(),
		error = vi.fn()
	createActor(
		createArticleCollectionMachine({
			isCurrent: () => true,
			articles: () => release,
			organization: () => {
				throw new Error('Subscription failed')
			}
		}),
		{ input: { next: () => {}, error } }
	).start()
	expect(error).toHaveBeenCalledOnce()
	expect(release).toHaveBeenCalledOnce()
})
