import { z } from 'zod'
import { serveBrokerHost } from 'delightful-local-first/backend/jazz/worker-broker'

const bindingSchema = z
	.object({
		scope: z.string().uuid(),
		url: z.string().url().max(8192)
	})
	.strict()
const generationGrantSchema = bindingSchema.pick({ scope: true }).extend({
	key: z.string().startsWith('jazz:shared-worker-generation:jazz-runtime:').max(65536)
})
const brokerGrantSchema = bindingSchema.pick({ scope: true, url: true }).extend({
	name: z
		.string()
		.startsWith('jazz-runtime:')
		.max(65536)
		.regex(/:generation-\d{1,16}$/)
		.refine((value) => {
			const suffix = value.slice(value.lastIndexOf(':generation-') + ':generation-'.length)
			return Number.isSafeInteger(Number(suffix))
		})
})
export type FinanceGenerationGrant = z.infer<typeof generationGrantSchema>
export type FinanceBrokerGrant = z.infer<typeof brokerGrantSchema>
export type FinanceBrokerNative = {
	origin: string
	storage: Pick<Storage, 'getItem' | 'setItem'>
	openBroker: (
		url: string,
		name: string
	) => Pick<SharedWorker, 'port' | 'addEventListener' | 'removeEventListener'>
}

function selectedBrokerUrl(value: string, origin: string) {
	try {
		const url = new URL(value)
		if (
			!['http:', 'https:'].includes(url.protocol) ||
			url.origin !== new URL(origin).origin ||
			url.username ||
			url.password
		)
			throw new Error('Invalid Finance broker binding')
		return url.href
	} catch {
		throw new Error('Invalid Finance broker binding')
	}
}

/** Exact-key grant for existing SDK readGeneration/writeGeneration callbacks.
 * It holds no SharedWorker constructor and cannot admit broker opens. */
export function serveFinanceGenerationGrant(
	data: MessagePort,
	control: MessagePort,
	grant: FinanceGenerationGrant,
	native: Pick<FinanceBrokerNative, 'storage'>
) {
	const decoded = generationGrantSchema.safeParse(grant)
	if (!decoded.success) throw new Error('Invalid Finance generation grant')
	const selected = decoded.data
	return serveBrokerHost(data, control, selected.scope, {
		storage: native.storage,
		admitGeneration: (key) => key === selected.key,
		admitOpen: () => false,
		open: () => {
			throw new Error('Finance generation grant cannot open a broker')
		}
	})
}

/** Exact URL/name grant for the existing SDK open callback. Each generation
 * uses the SDK-supplied name; no private namespace derivation or storage access. */
export function serveFinanceBrokerGrant(
	data: MessagePort,
	control: MessagePort,
	grant: FinanceBrokerGrant,
	native: Pick<FinanceBrokerNative, 'origin' | 'openBroker'>
) {
	const decoded = brokerGrantSchema.safeParse(grant)
	if (!decoded.success) throw new Error('Invalid Finance broker grant')
	const selected = { ...decoded.data, url: selectedBrokerUrl(decoded.data.url, native.origin) }
	return serveBrokerHost(data, control, selected.scope, {
		open: (_url, name) => native.openBroker(selected.url, name),
		admitOpen: (url, name) => new URL(url).href === selected.url && name === selected.name,
		admitGeneration: () => false,
		storage: {
			getItem: () => {
				throw new Error('Finance broker grant cannot read generation storage')
			},
			setItem: () => {
				throw new Error('Finance broker grant cannot write generation storage')
			}
		}
	})
}
