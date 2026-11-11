/** Canonical comparison for user-entered entity names; preserve the original for display. */
export function normalizedName(name: string) {
	return name.trim().toLowerCase()
}
