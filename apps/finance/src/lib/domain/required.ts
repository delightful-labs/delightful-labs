/** Invariant narrowing at typed actor boundaries; workflow decisions belong to guards. */
export function required<Value>(value: Value | null | undefined): Value {
	if (value == null) throw new Error('invalid-machine-context')
	return value
}
