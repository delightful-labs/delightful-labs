/** Pure storage capability admission; no SDK initialization or identity policy. */
export const ACCOUNT_SELECTION_PREFIX = 'jazz-account-selection-v1:'
const prefix = ACCOUNT_SELECTION_PREFIX
export type AccountStorageBinding = {
	key: string
	earlierSuffix: string
	earlierPathname: string | undefined
}
export function isEarlierSelectionKey(binding: AccountStorageBinding, key: string) {
	if (!binding.earlierPathname || !key.startsWith(prefix) || !key.endsWith(binding.earlierSuffix))
		return false
	try {
		return (
			new URL(decodeURIComponent(key.slice(prefix.length, -binding.earlierSuffix.length)))
				.pathname === binding.earlierPathname
		)
	} catch {
		return false
	}
}
