import { now } from '@atcute/tid'
import { createAsyncLogic } from 'xstate'
import { atRecordUriSchema } from '../../annotations/publication-link.js'
import { firstPublicationWriteSchema } from './first-write.js'

/** One selected allocation effect, not a guard/selector or a durable identity.
 * The publisher must retain native acceptance of the issued URI before sending
 * anything, and reuse that value on resume rather than invoking this again.
 * Jazz owns collision checks/history; the library owns clock/random generation. */
export const allocatePublicationAddress = createAsyncLogic({
	run: async ({ input, signal }: { input: string; signal: AbortSignal }) => {
		signal.throwIfAborted()
		const publisher = firstPublicationWriteSchema.shape.repo.safeParse(input)
		if (!publisher.success || publisher.data.trim() !== publisher.data)
			throw new Error('Publication address cannot be allocated')
		const key = firstPublicationWriteSchema.shape.rkey.safeParse(now())
		if (!key.success) throw new Error('Publication address cannot be allocated')
		const uri = atRecordUriSchema.safeParse(`at://${publisher.data}/at.margin.note/${key.data}`)
		if (!uri.success) throw new Error('Publication address cannot be allocated')
		return uri.data
	}
})
