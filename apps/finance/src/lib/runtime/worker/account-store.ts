import { accountRegistryUrl } from 'jazz-tools'
import { z } from 'zod'
import { createIndexedDbAccountStore } from 'delightful-local-first/backend/jazz/account-store/indexeddb'

const configuration = z
	.object({
		serverUrl: z.string().url().max(8192),
		scope: z.string().trim().min(1).max(8192),
		environment: z.string().max(8192).optional()
	})
	.strict()
export type FinanceAccountStoreConfiguration = z.infer<typeof configuration>
const databaseName = 'delightful-finances-account-selection'

/** Pure app binding. The SDK owns registry resolution and selection contents. */
export function financeAccountStoreBinding(input: FinanceAccountStoreConfiguration) {
	const decoded = configuration.safeParse(input)
	if (!decoded.success) throw new Error('Invalid Finance account storage binding')
	let registry: string
	try {
		registry = accountRegistryUrl(decoded.data.serverUrl, decoded.data.scope)
	} catch {
		throw new Error('Invalid Finance account storage binding')
	}
	return {
		databaseName,
		key: JSON.stringify([registry, decoded.data.environment ?? 'dev'])
	}
}

/** One native root at worker-host initialization. Starts no SDK session. The
 * application owner closes the SDK before awaiting this store's close receipt. */
export function createFinanceAccountStore(
	configuration: FinanceAccountStoreConfiguration,
	factory?: IDBFactory
) {
	return createIndexedDbAccountStore({
		...financeAccountStoreBinding(configuration),
		...(factory === undefined ? {} : { factory })
	})
}
