import { expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { readRecordMachine } from './read.js'
import { fixtureReaderDocument, fixtureAttachment } from '../../capture/fixtures.test-support.js'
import type { ReadResult } from '../../contracts/storage.js'
it.each(['available', 'missing', 'pending', 'corrupt', 'scope', 'shutdown', 'failed'])(
	'settles and clears private reader resources after %s',
	async (mode) => {
		const document = fixtureReaderDocument({ attachment: fixtureAttachment() }),
			pending = Promise.withResolvers<void>()
		let current = true,
			result: ReadResult | undefined
		const actor = createActor(readRecordMachine, {
			input: {
				id: document.id,
				capability: {
					isCurrent: () => current,
					document: async () => {
						if (mode === 'shutdown') await pending.promise
						if (mode === 'failed') throw new Error('Read failed')
						if (mode === 'scope') current = false
						if (mode === 'missing') return null
						if (mode === 'pending') return { ...document, attachment: null }
						if (mode === 'corrupt') return { ...document, readingProgress: NaN }
						return document
					}
				}
			}
		})
		actor.on('record', (event) => {
			result = event.result
		})
		actor.start()
		if (mode === 'shutdown') actor.send({ type: 'SHUTDOWN' })
		const outcome = await toPromise(actor)
		pending.resolve()
		const kind =
			mode === 'available'
				? 'available'
				: mode === 'missing'
					? 'missing'
					: mode === 'corrupt'
						? 'corrupt'
						: 'unavailable'
		expect(outcome).toEqual({ kind })
		expect(result).toMatchObject({ kind })
		if (result?.kind === 'available') {
			expect(result.text).toBe('Saved text')
			expect(result.attachment.title).toBe('Saved title')
		}
		expect(actor.getSnapshot().context).toMatchObject({
			result: undefined,
			capability: undefined,
			reportTo: undefined
		})
	}
)
it('rejects a late joined result after the account binding changes', async () => {
	const document = fixtureReaderDocument({ attachment: fixtureAttachment() }),
		pending = Promise.withResolvers<void>()
	let current = true,
		result: ReadResult | undefined
	const actor = createActor(readRecordMachine, {
		input: {
			id: document.id,
			capability: {
				isCurrent: () => current,
				document: async () => {
					await pending.promise
					return document
				}
			}
		}
	})
	actor.on('record', (event) => {
		result = event.result
	})
	actor.start()
	current = false
	pending.resolve()
	expect(await toPromise(actor)).toEqual({ kind: 'unavailable' })
	expect(result).toEqual({ kind: 'unavailable' })
})
