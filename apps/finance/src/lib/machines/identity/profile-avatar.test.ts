import { afterEach, describe, expect, it, vi } from 'vitest'
import * as platform from '#lib/domain/image-processing.js'
import { MAX_AVATAR_BYTES, profileAvatarFormSchema } from '#lib/validation/identity.js'
import { createProfileFormOptions, profileScope } from './profile.js'
import { createScopedFormMachine, selectScopedFormView } from '../forms/scoped-form.js'
import type {
	ProfileObservation,
	ProfileReason,
	ProfileScope
} from '#lib/contracts/profile-contract.js'
import { createActor, toPromise, waitFor } from 'xstate'
import type { SnapshotFrom } from 'xstate'

const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
function fixture() {
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			constructor(
				public width: number,
				public height: number
			) {}
		}
	)
	const bitmap = { width: 512, height: 256, close: vi.fn() }
	const canvas = new OffscreenCanvas(256, 128)
	const decode = vi.spyOn(platform, 'decodeImage').mockResolvedValue(bitmap)
	const initialize = vi
		.spyOn(platform, 'initializeImageResizer')
		.mockImplementation(vi.fn().mockResolvedValue(undefined))
	const createCanvas = vi.spyOn(platform, 'createImageCanvas').mockReturnValue(canvas)
	const resize = vi.spyOn(platform, 'resizeImage').mockResolvedValue(canvas)
	const encode = vi
		.spyOn(platform, 'encodeImage')
		.mockResolvedValue(new Blob(['encoded'], { type: 'image/webp' }))
	const read = vi.spyOn(platform, 'readImageBytes')
	const closeBitmap = vi.spyOn(platform, 'releaseImageBitmap')
	const closeCanvas = vi.spyOn(platform, 'releaseImageCanvas')
	const binding = {}
	let facts: ProfileObservation = {
		identityId: 'user',
		binding,
		sessionReady: true,
		loading: false,
		failed: false,
		profile: {
			id: 'profile',
			userId: 'user',
			avatarData: new Uint8Array([1]),
			avatarMimeType: 'image/png'
		}
	}
	const observe = vi.fn(() => facts)
	const save = vi.fn<Parameters<typeof createProfileFormOptions>[0]['saveAvatar']>(async () => {})
	const options = createProfileFormOptions({
		binding,
		observe,
		saveName: async () => {},
		saveAvatar: save
	}).avatar
	const upload = profileAvatarFormSchema.parse({
		action: 'upload',
		file: new File(['image'], 'avatar.png', { type: 'image/png' })
	})
	function input(values = upload) {
		return {
			request: { id: 1, scopeRevision: 0, scope: profileScope(facts), values },
			observation: { revision: 0, facts }
		}
	}
	function start(values = upload) {
		const actor = createActor(options.operation, { input: input(values) })
		cleanups.push(() => actor.stop())
		return actor.start()
	}
	function form() {
		const actor = createActor(
			createScopedFormMachine<
				import('zod').z.output<typeof profileAvatarFormSchema>,
				void,
				ProfileReason,
				ProfileScope,
				ProfileObservation,
				SnapshotFrom<typeof options.availability>,
				SnapshotFrom<typeof options.operation>
			>(options),
			{ input: facts }
		)
		cleanups.push(() => actor.stop())
		return actor.start()
	}
	return {
		bitmap,
		canvas,
		decode,
		initialize,
		createCanvas,
		resize,
		encode,
		read,
		closeBitmap,
		closeCanvas,
		save,
		observe,
		options,
		upload,
		input,
		start,
		form,
		setFacts: (patch: Partial<ProfileObservation>) => (facts = { ...facts, ...patch })
	}
}
const commands = [
	{ type: 'CANCEL', outcome: 'cancelled' },
	{ type: 'INVALIDATE', outcome: 'scopeChanged' },
	{ type: 'SHUTDOWN', outcome: 'closed' }
] satisfies { type: 'CANCEL' | 'INVALIDATE' | 'SHUTDOWN'; outcome: string }[]

describe('avatar preparation and saving', () => {
	it('releases image resources before refreshing readiness and issuing one canonical save', async () => {
		const f = fixture()
		const actor = f.start()
		expect(await toPromise(actor)).toEqual({
			outcome: 'succeeded',
			value: undefined,
			settlement: 'locallyPersisted'
		})
		expect(platform.createImageCanvas).toHaveBeenCalledWith(f.bitmap, {
			maxWidth: 256,
			maxHeight: 256,
			mimeType: 'image/webp',
			quality: 0.85
		})
		expect(f.save).toHaveBeenCalledExactlyOnceWith('profile', 'user', {
			avatarData: new TextEncoder().encode('encoded'),
			avatarMimeType: 'image/webp'
		})
		expect(f.closeBitmap).toHaveBeenCalledOnce()
		expect(f.closeCanvas).toHaveBeenCalledOnce()
		expect(f.bitmap.close).toHaveBeenCalledOnce()
		expect([f.canvas.width, f.canvas.height]).toEqual([0, 0])
		expect(f.closeBitmap.mock.invocationCallOrder[0]).toBeLessThan(
			f.closeCanvas.mock.invocationCallOrder[0] ?? 0
		)
		expect(f.closeCanvas.mock.invocationCallOrder[0]).toBeLessThan(
			f.observe.mock.invocationCallOrder[0] ?? 0
		)
		expect(f.observe.mock.invocationCallOrder[0]).toBeLessThan(
			f.save.mock.invocationCallOrder[0] ?? 0
		)
		expect(actor.getSnapshot().context).toMatchObject({
			request: undefined,
			draft: undefined,
			blob: undefined,
			bytes: undefined,
			prepared: undefined,
			observation: undefined
		})
	})
	it('removes an avatar without allocating image resources', async () => {
		const f = fixture()
		expect(await toPromise(f.start({ action: 'remove' }))).toMatchObject({ outcome: 'succeeded' })
		expect(f.decode).not.toHaveBeenCalled()
		expect(f.initialize).not.toHaveBeenCalled()
		expect(f.createCanvas).not.toHaveBeenCalled()
		expect(f.closeBitmap).not.toHaveBeenCalled()
		expect(f.closeCanvas).not.toHaveBeenCalled()
		expect(f.save).toHaveBeenCalledExactlyOnceWith('profile', 'user', {
			avatarData: null,
			avatarMimeType: null
		})
	})
	it('uses the actual supported encoder MIME type', async () => {
		const f = fixture()
		f.encode.mockResolvedValue(new Blob(['png'], { type: 'image/png' }))
		expect(await toPromise(f.start())).toMatchObject({ outcome: 'succeeded' })
		expect(f.save).toHaveBeenCalledWith(
			'profile',
			'user',
			expect.objectContaining({ avatarMimeType: 'image/png' })
		)
	})
	it.each([
		{ label: 'null encoder output', blob: null },
		{ label: 'empty output', blob: new Blob([], { type: 'image/webp' }) },
		{
			label: 'oversized output',
			blob: new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)], { type: 'image/webp' })
		},
		{ label: 'unsupported MIME', blob: new Blob(['x'], { type: 'image/svg+xml' }) }
	])('rejects $label, cleans resources and issues no write', async ({ blob }) => {
		const f = fixture()
		f.encode.mockResolvedValue(blob)
		expect(await toPromise(f.start())).toEqual({
			outcome: 'failed',
			code: 'operationFailed',
			settlement: 'notStarted'
		})
		expect(f.closeBitmap).toHaveBeenCalledOnce()
		expect(f.closeCanvas).toHaveBeenCalledOnce()
		expect(f.save).not.toHaveBeenCalled()
	})
	it.each(['decode', 'initialize', 'canvas', 'resize', 'encode', 'read'])(
		'handles %s failure with the acquired resource cleanup',
		async (stage) => {
			const f = fixture()
			const error = new Error('Image processing failed')
			if (stage === 'decode') f.decode.mockRejectedValue(error)
			if (stage === 'initialize') f.initialize.mockRejectedValue(error)
			if (stage === 'canvas')
				f.createCanvas.mockImplementation(() => {
					throw error
				})
			if (stage === 'resize') f.resize.mockRejectedValue(error)
			if (stage === 'encode') f.encode.mockRejectedValue(error)
			if (stage === 'read') f.read.mockRejectedValue(error)
			expect(await toPromise(f.start())).toMatchObject({
				outcome: 'failed',
				settlement: 'notStarted'
			})
			expect(f.closeBitmap).toHaveBeenCalledTimes(stage === 'decode' ? 0 : 1)
			expect(f.closeCanvas).toHaveBeenCalledTimes(
				['decode', 'initialize', 'canvas'].includes(stage) ? 0 : 1
			)
			expect(f.save).not.toHaveBeenCalled()
		}
	)
	it.each(['bitmap', 'canvas'])(
		'prevents saving after %s cleanup fails and attempts other resource cleanup',
		async (resource) => {
			const f = fixture()
			if (resource === 'bitmap')
				f.closeBitmap.mockImplementation(() => {
					throw new Error('Close failed')
				})
			else
				f.closeCanvas.mockImplementation(() => {
					throw new Error('Canvas release failed')
				})
			expect(await toPromise(f.start())).toMatchObject({
				outcome: 'failed',
				settlement: 'notStarted'
			})
			expect(f.closeBitmap).toHaveBeenCalledOnce()
			expect(f.closeCanvas).toHaveBeenCalledOnce()
			expect(f.save).not.toHaveBeenCalled()
		}
	)
	it('rechecks current profile ownership after cleanup', async () => {
		const f = fixture()
		f.closeCanvas.mockImplementation((canvas) => {
			canvas.width = 0
			canvas.height = 0
			f.setFacts({ profile: { id: 'profile', userId: 'other' } })
		})
		expect(await toPromise(f.start())).toMatchObject({
			outcome: 'unavailable',
			reason: 'profileUnavailable',
			settlement: 'notStarted'
		})
		expect(f.save).not.toHaveBeenCalled()
	})
})

describe('avatar interruption and settlement', () => {
	it.each(['initialize', 'canvas', 'resize', 'encode', 'read'])(
		'retains a successful late %s result for cleanup without starting the next operation',
		async (stage) => {
			const f = fixture()
			const pending = Promise.withResolvers<unknown>()
			const blocked =
				stage === 'initialize'
					? f.initialize
					: stage === 'canvas'
						? f.createCanvas
						: stage === 'resize'
							? f.resize
							: stage === 'encode'
								? f.encode
								: f.read
			if (stage === 'initialize')
				f.initialize.mockReturnValue(
					pending.promise as unknown as ReturnType<typeof platform.initializeImageResizer>
				)
			if (stage === 'canvas')
				f.createCanvas.mockReturnValue(pending.promise as unknown as OffscreenCanvas)
			if (stage === 'resize') f.resize.mockReturnValue(pending.promise as Promise<OffscreenCanvas>)
			if (stage === 'encode') f.encode.mockReturnValue(pending.promise as Promise<Blob>)
			if (stage === 'read')
				f.read.mockReturnValue(
					pending.promise as unknown as ReturnType<typeof platform.readImageBytes>
				)
			const actor = f.start()
			await vi.waitFor(() => expect(blocked).toHaveBeenCalledOnce())
			actor.send({ type: 'SHUTDOWN' })
			const output =
				stage === 'initialize'
					? undefined
					: stage === 'canvas' || stage === 'resize'
						? f.canvas
						: stage === 'encode'
							? new Blob(['encoded'], { type: 'image/webp' })
							: new Uint8Array([1, 2, 3])
			pending.resolve(output)
			await expect(toPromise(actor)).resolves.toMatchObject({
				outcome: 'closed',
				settlement: 'notStarted'
			})
			expect(f.bitmap.close).toHaveBeenCalledOnce()
			expect(f.closeCanvas).toHaveBeenCalledTimes(stage === 'initialize' ? 0 : 1)
			expect(f.save).not.toHaveBeenCalled()
			if (stage === 'initialize') expect(f.createCanvas).not.toHaveBeenCalled()
			if (stage === 'canvas') expect(f.resize).not.toHaveBeenCalled()
			if (stage === 'resize') expect(f.encode).not.toHaveBeenCalled()
			if (stage === 'encode') expect(f.read).not.toHaveBeenCalled()
		}
	)

	it.each(commands)(
		'retains late decode on $type then closes its bitmap without starting resize',
		async ({ type, outcome }) => {
			const f = fixture()
			const pending = Promise.withResolvers<ImageBitmap>()
			f.decode.mockReturnValue(pending.promise)
			const actor = f.start()
			actor.send({ type })
			expect(actor.getSnapshot().status).toBe('active')
			pending.resolve(f.bitmap)
			expect(await toPromise(actor)).toEqual({ outcome, settlement: 'notStarted' })
			expect(f.bitmap.close).toHaveBeenCalledOnce()
			expect(f.initialize).not.toHaveBeenCalled()
			expect(f.save).not.toHaveBeenCalled()
		}
	)
	it.each(['initialize', 'resize', 'encode', 'read'])(
		'drains an issued %s before cleanup on shutdown',
		async (stage) => {
			const f = fixture()
			const pending = Promise.withResolvers<void>()
			const blocked =
				stage === 'initialize'
					? f.initialize
					: stage === 'resize'
						? f.resize
						: stage === 'encode'
							? f.encode
							: f.read
			blocked.mockImplementation(vi.fn().mockReturnValue(pending.promise))
			const actor = f.start()
			await vi.waitFor(() => expect(blocked).toHaveBeenCalledOnce())
			actor.send({ type: 'SHUTDOWN' })
			actor.send({ type: 'CANCEL' })
			actor.send({ type: 'INVALIDATE' })
			expect(f.closeBitmap).not.toHaveBeenCalled()
			expect(actor.getSnapshot().status).toBe('active')
			pending.reject(new Error('Issued effect failed after shutdown'))
			expect(await toPromise(actor)).toEqual({ outcome: 'closed', settlement: 'notStarted' })
			expect(f.bitmap.close).toHaveBeenCalledOnce()
			expect(f.save).not.toHaveBeenCalled()
		}
	)
	it('waits for cleanup before completing shutdown', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<void>()
		f.closeBitmap.mockImplementation(vi.fn().mockReturnValue(pending.promise))
		const actor = f.start()
		await vi.waitFor(() => expect(f.closeBitmap).toHaveBeenCalledOnce())
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(f.closeCanvas).not.toHaveBeenCalled()
		pending.resolve()
		expect(await toPromise(actor)).toEqual({ outcome: 'closed', settlement: 'notStarted' })
		expect(f.closeCanvas).toHaveBeenCalledOnce()
		expect(f.save).not.toHaveBeenCalled()
	})
	it('keeps identity invalidation through switching away and back during decode', async () => {
		const f = fixture()
		const pending = Promise.withResolvers<ImageBitmap>()
		f.decode.mockReturnValue(pending.promise)
		const input = f.input()
		const actor = f.start()
		actor.send({
			type: 'OBSERVE',
			observation: { revision: 1, facts: { ...input.observation.facts, identityId: 'other' } }
		})
		actor.send({ type: 'OBSERVE', observation: { revision: 2, facts: input.observation.facts } })
		pending.resolve(f.bitmap)
		expect(await toPromise(actor)).toEqual({ outcome: 'scopeChanged', settlement: 'notStarted' })
		expect(f.save).not.toHaveBeenCalled()
	})
	it.each(commands)('retains issued profile persistence on $type', async ({ type, outcome }) => {
		const f = fixture()
		const pending = Promise.withResolvers<void>()
		f.save.mockReturnValue(pending.promise)
		const actor = f.start()
		await vi.waitFor(() => expect(f.save).toHaveBeenCalledOnce())
		actor.send({ type })
		expect(actor.getSnapshot().status).toBe('active')
		pending.resolve()
		expect(await toPromise(actor)).toEqual({ outcome, settlement: 'locallyPersisted' })
		expect(f.save).toHaveBeenCalledOnce()
	})
	it('preserves uncertainty from a failed issued save', async () => {
		const f = fixture()
		f.save.mockRejectedValue(new Error('Save failed'))
		expect(await toPromise(f.start())).toEqual({
			outcome: 'failed',
			code: 'operationFailed',
			settlement: 'unknown'
		})
	})
	it('validates file drafts before decoding and reports preparation as operating through the real form', async () => {
		const f = fixture()
		const actor = f.form()
		actor.send({
			type: 'SUBMIT',
			values: {
				action: 'upload',
				file: new File(['svg'], 'invalid.svg', { type: 'image/svg+xml' })
			}
		})
		await waitFor(actor, (s) => s.context.result?.outcome === 'invalid')
		expect(f.decode).not.toHaveBeenCalled()
		const pending = Promise.withResolvers<ImageBitmap>()
		f.decode.mockReturnValue(pending.promise)
		actor.send({ type: 'SUBMIT', values: f.upload })
		await vi.waitFor(() => expect(f.decode).toHaveBeenCalledOnce())
		expect(actor.getSnapshot().hasTag('validating')).toBe(false)
		actor.send({ type: 'SHUTDOWN' })
		pending.resolve(f.bitmap)
		await toPromise(actor)
		expect(f.bitmap.close).toHaveBeenCalledOnce()
		expect(f.save).not.toHaveBeenCalled()
	})
})

it('shared success reset releases the uploaded file, rebuilds fields and preserves saved feedback', async () => {
	const f = fixture()
	const actor = f.form()
	actor.send({ type: 'CHANGE', values: f.upload })
	actor.send({ type: 'SUBMIT', values: f.upload })
	await waitFor(actor, (s) => s.context.result?.outcome === 'succeeded')
	expect(f.save).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context.draft).toBeUndefined()
	expect(actor.getSnapshot().context.request).toBeUndefined()
	expect(
		selectScopedFormView<
			import('zod').z.output<typeof profileAvatarFormSchema>,
			void,
			ProfileReason,
			ProfileScope,
			ProfileObservation,
			SnapshotFrom<typeof f.options.availability>,
			SnapshotFrom<typeof f.options.operation>
		>(actor.getSnapshot(), f.options)
	).toMatchObject({
		draftRevision: 1,
		canSubmit: false,
		fieldsEditable: true,
		feedback: { kind: 'result', result: { outcome: 'succeeded' } }
	})
	actor.send({
		type: 'CHANGE',
		values: { action: 'upload', file: new File(['replacement'], 'next.png', { type: 'image/png' }) }
	})
	expect(actor.getSnapshot().context.result).toBeUndefined()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
