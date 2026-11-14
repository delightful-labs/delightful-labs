import { z } from 'zod'

export const financeGrantScopeSchema = z.string().uuid()
const generationFields = z
	.object({
		key: z.string().startsWith('jazz:shared-worker-generation:jazz-runtime:').max(65536)
	})
	.strict()
const brokerFields = z
	.object({
		url: z.string().url().max(8192),
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
	.strict()

const generationGrantSchema = generationFields.extend({ scope: financeGrantScopeSchema })
const brokerGrantSchema = brokerFields.extend({ scope: financeGrantScopeSchema })
export const financeGrantDescriptorSchema = z.discriminatedUnion('kind', [
	generationFields.extend({ kind: z.literal('generation') }),
	brokerFields.extend({ kind: z.literal('broker') })
])
export type FinanceGenerationGrant = z.infer<typeof generationGrantSchema>
export type FinanceBrokerGrant = z.infer<typeof brokerGrantSchema>
export type FinanceGrantDescriptor = z.infer<typeof financeGrantDescriptorSchema>

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

export function financeGenerationGrantBinding(input: unknown): FinanceGenerationGrant {
	const decoded = generationGrantSchema.safeParse(input)
	if (!decoded.success) throw new Error('Invalid Finance generation grant')
	return decoded.data
}

export function financeBrokerGrantBinding(input: unknown, origin: string): FinanceBrokerGrant {
	const decoded = brokerGrantSchema.safeParse(input)
	if (!decoded.success) throw new Error('Invalid Finance broker grant')
	return { ...decoded.data, url: selectedBrokerUrl(decoded.data.url, origin) }
}

/** Copy and canonicalize an exact SDK-supplied binding before owner admission.
 * This does not derive a generation key or worker name from another binding. */
export function financeGrantDescriptor(input: unknown, origin: string): FinanceGrantDescriptor {
	const decoded = financeGrantDescriptorSchema.safeParse(input)
	if (!decoded.success) throw new Error('Invalid Finance grant descriptor')
	if (decoded.data.kind === 'generation') return decoded.data
	return { ...decoded.data, url: selectedBrokerUrl(decoded.data.url, origin) }
}

/** The owner supplies its admitted canonical descriptor and runtime generation.
 * JSON tuples keep caller-controlled separators from aliasing another grant. */
export function financeGrantKey(runtimeId: string, descriptor: FinanceGrantDescriptor) {
	return JSON.stringify(
		descriptor.kind === 'generation'
			? [runtimeId, 'generation', descriptor.key]
			: [runtimeId, 'broker', descriptor.url, descriptor.name]
	)
}
