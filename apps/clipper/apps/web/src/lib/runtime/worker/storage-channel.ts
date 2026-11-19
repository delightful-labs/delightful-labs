export const ACCOUNT_STORAGE_PREFIX = 'jazz-account-selection-v2:'
export const NATIVE_ACCOUNT_STORAGE_PREFIX = 'jazz-account-selection-v1:'
export function isAccountStorageKey(key: string) {
	return key.startsWith(ACCOUNT_STORAGE_PREFIX) || key.startsWith(NATIVE_ACCOUNT_STORAGE_PREFIX)
}
export function accountStorageKey(serverUrl: string) {
	return `${ACCOUNT_STORAGE_PREFIX}${encodeURIComponent(new URL(serverUrl).href)}:clipper`
}
