import { createCallbackLogic } from 'xstate'

/** One subscription per invoked actor. Consumers supply facts and their typed reports. */
export function createBoundObservationLogic<
	Value,
	Input,
	Report extends { type: string }
>(options: {
	observe: (
		input: Input,
		publish: (value: Value) => void,
		failed: () => void
	) => (() => void) | undefined
	/** Pure projections; binding/generation correlation remains explicit in the app report. */
	observed: (input: Input, value: Value) => Report
	failed: (input: Input) => Report
	/** Preserve the host's existing disposal-failure boundary; otherwise rethrow. */
	disposalFailed?: (input: Input, error: unknown) => void
}) {
	return createCallbackLogic<never, Input>(({ input, sendBack }) => {
		let active = true
		let release: (() => void) | undefined
		const failed = () => {
			if (active) sendBack(options.failed(input))
		}
		try {
			release = options.observe(
				input,
				(value) => {
					if (active) sendBack(options.observed(input, value))
				},
				failed
			)
		} catch {
			failed()
		}
		return () => {
			active = false
			try {
				release?.()
			} catch (error) {
				if (!options.disposalFailed) throw error
				options.disposalFailed(input, error)
			}
		}
	})
}
