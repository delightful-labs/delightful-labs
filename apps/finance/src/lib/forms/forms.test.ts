import { afterEach, describe, expect, it, vi } from 'vitest'
import { onMount } from 'svelte'
import { createScopedFormController } from './forms.svelte.js'
import { fixture, ready, success, type Facts } from '../machines/forms/scoped-form.fixture.js'

// Exercise the compiled server adapter with explicit mount/unmount hooks. This
// does not simulate client runes, DOM reset, or reactive rendering.
vi.mock('svelte', async (original) => ({
	...(await original<typeof import('svelte')>()),
	onMount: vi.fn()
}))
afterEach(() => {
	vi.unstubAllGlobals()
	vi.clearAllMocks()
})

function mountController(observe: () => Facts, arrayFields: () => readonly string[] = () => []) {
	const f = fixture()
	const controller = createScopedFormController({ ...f.config, observe, arrayFields })
	const mount = vi.mocked(onMount).mock.calls.at(-1)?.[0]
	if (!mount) throw new Error('Missing mount hook')
	const dispose = mount()
	if (typeof dispose !== 'function') throw new Error('Missing disposal hook')
	return { ...f, controller, dispose }
}

class FormElement {}
class Submission extends Event {
	readonly submitter = null
	constructor(target: unknown) {
		super('submit', { cancelable: true })
		Object.defineProperty(this, 'currentTarget', { value: target })
	}
}

describe('scoped form controller adapter', () => {
	it('refreshes observations synchronously before submission and preserves domain guards', async () => {
		let facts = ready
		const f = mountController(() => facts)
		try {
			facts = { ...ready, allowed: false }
			f.controller.submitValues({ name: 'blocked' })
			expect(f.started).not.toHaveBeenCalled()
			facts = ready
			f.controller.submitValues({ name: ' Home ' })
			await vi.waitFor(() => expect(f.started).toHaveBeenCalledTimes(1))
			expect(f.started.mock.calls[0]?.[0].request.values).toEqual({ name: 'Home' })
		} finally {
			f.dispose()
			f.settlement.resolve(success)
		}
	})

	it('preserves Files and repeated fields when adapting FormData and prevents native submit/reset', async () => {
		const data = new FormData()
		const file = new File(['avatar'], 'avatar.png', { type: 'image/png' })
		data.append('name', 'Home')
		data.append('tags', 'one')
		data.append('tags', 'two')
		data.append('avatar', file)
		const formData = vi.fn(function () {
			return data
		})
		vi.stubGlobal('HTMLFormElement', FormElement)
		vi.stubGlobal('FormData', formData)
		const captured: unknown[] = []
		const f = fixture()
		const parsing = vi.spyOn(f.config.schema, 'parseAsync').mockImplementation(async (values) => {
			captured.push(values)
			return { name: 'Home' }
		})
		const controller = createScopedFormController({
			...f.config,
			observe: () => ready,
			arrayFields: () => ['tags']
		})
		const mount = vi.mocked(onMount).mock.calls.at(-1)?.[0]
		const dispose = mount?.()
		try {
			const event = new Submission(new FormElement())
			controller.submit(event)
			expect(event.defaultPrevented).toBe(true)
			expect(formData).toHaveBeenCalledWith(event.currentTarget)
			expect(captured).toEqual([{ name: 'Home', tags: ['one', 'two'], avatar: file }])
			const reset = new Event('reset', { cancelable: true })
			controller.reset(reset)
			expect(reset.defaultPrevented).toBe(true)
			await vi.waitFor(() => expect(f.started).toHaveBeenCalledTimes(1))
		} finally {
			if (typeof dispose === 'function') dispose()
			f.settlement.resolve(success)
			parsing.mockRestore()
		}
	})

	it('ignores non-form submission targets after preventing browser navigation', () => {
		vi.stubGlobal('HTMLFormElement', FormElement)
		const f = mountController(() => ready)
		try {
			const event = new Submission(null)
			f.controller.submit(event)
			expect(event.defaultPrevented).toBe(true)
			expect(f.started).not.toHaveBeenCalled()
		} finally {
			f.dispose()
		}
	})

	it('forwards shutdown on unmount and lets issued work settle before stopping', async () => {
		const f = mountController(() => ready)
		f.controller.submitValues({ name: 'Home' })
		await vi.waitFor(() => expect(f.started).toHaveBeenCalledTimes(1))
		f.dispose()
		expect(f.received).toHaveBeenCalledWith({ type: 'SHUTDOWN' })
		expect(f.aborted).not.toHaveBeenCalled()
		f.controller.cancel()
		f.controller.open()
		f.controller.retryReadiness()
		f.controller.submitValues({ name: 'late' })
		expect(f.started).toHaveBeenCalledTimes(1)
		f.settlement.resolve(success)
		await Promise.resolve()
		await Promise.resolve()
		f.controller.submitValues({ name: 'after settlement' })
		expect(f.started).toHaveBeenCalledTimes(1)
	})
})
