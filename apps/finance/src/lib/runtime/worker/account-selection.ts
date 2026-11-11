import { accountRegistryUrl, parseAuthSecret } from 'jazz-tools'
import { z } from 'zod'
import {
	ACCOUNT_SELECTION_PREFIX,
	isEarlierSelectionKey,
	type AccountStorageBinding
} from './account-storage-namespace.js'
export { isEarlierSelectionKey, type AccountStorageBinding } from './account-storage-namespace.js'
const prefix = ACCOUNT_SELECTION_PREFIX
const backendUser = z.object({
	format: z.literal('jazz-backend-user-v1'),
	account: z.string(),
	identity: z.object({ issuer: z.string(), subject: z.string() }),
	claims: z.record(z.string(), z.unknown())
})
const selection = z
	.object({
		format: z.literal('jazz-account-selection-v1'),
		roots: z.array(
			z.string().refine((secret) => {
				try {
					parseAuthSecret(secret)
					return true
				} catch {
					return false
				}
			})
		),
		selected: z.number().int().nonnegative().nullable(),
		forgottenAccounts: z.array(z.string()).optional(),
		backendUser: z.unknown().optional()
	})
	.passthrough()
	.refine((value) => value.selected === null || value.selected < value.roots.length)
	.refine((value) => {
		const user = value.backendUser
		if (user === undefined || user === null) return true
		const shape = z.object({ format: z.string() }).safeParse(user)
		return (
			(shape.success && shape.data.format !== 'jazz-backend-user-v1') ||
			backendUser.safeParse(user).success
		)
	})
export type AccountSelection = z.infer<typeof selection>
export type EarlierSelection = { key: string; value: string | null }
export type AccountSelectionSnapshot = { current: string | null; earlier: EarlierSelection[] }
/** registry is obtained from the SDK's public accountRegistryUrl contract. The
 * environment is opaque and defaults to the existing Window SDK's 'dev'. */
export function accountStorageBinding(
	registry: string,
	environment = 'dev',
	legacyScope?: string
): AccountStorageBinding {
	const canonical = new URL(registry).href
	return {
		key: `${prefix}${encodeURIComponent(canonical)}:${encodeURIComponent(environment)}`,
		earlierSuffix: `:${encodeURIComponent(environment)}`,
		earlierPathname: legacyScope?.trim()
			? new URL(accountRegistryUrl('https://finance.invalid', legacyScope.trim())).pathname
			: undefined
	}
}
export function parseAccountSelection(value: string | null): AccountSelection | undefined {
	if (value === null) return undefined
	try {
		const decoded = selection.safeParse(JSON.parse(value))
		return decoded.success ? decoded.data : undefined
	} catch {
		return undefined
	}
}
export function earlierSelection(binding: AccountStorageBinding, entries: EarlierSelection[]) {
	const eligible = entries.filter((entry) => isEarlierSelectionKey(binding, entry.key))
	return eligible.length === 1 ? eligible[0] : undefined
}
export function droppedAccountRoots(previous: string | null, replacement: string) {
	const next = parseAccountSelection(replacement)
	if (!next) throw new Error('Invalid account selection replacement')
	return parseAccountSelection(previous)?.roots.filter((root) => !next.roots.includes(root)) ?? []
}
export function hasDroppedAccountRoots(value: AccountSelection, dropped: string[]) {
	return value.roots.some((root) => dropped.includes(root))
}
/** Preserve unknown persisted fields and selected-root identity, matching the SDK
 * scrub semantics; indexes cannot remain attached to a different surviving root. */
export function withoutDroppedAccountRoots(value: AccountSelection, dropped: string[]) {
	const selected = value.selected === null ? undefined : value.roots[value.selected]
	const roots = value.roots.filter((root) => !dropped.includes(root))
	return JSON.stringify({
		...value,
		roots,
		selected: selected !== undefined && roots.includes(selected) ? roots.indexOf(selected) : null
	})
}
