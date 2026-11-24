import { createCallbackLogic } from 'xstate'

export type ObservationRelease = { type: 'RELEASE' }
export type ObservationReleaseOutcome = 'released' | 'unresolved'

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
	/** Opt into explicit native release and publish its actual receipt before actor stop. */
	released?: ((input: Input, outcome: ObservationReleaseOutcome) => Report) | undefined
}) {
	return createCallbackLogic<ObservationRelease, Input>(({ input, sendBack, receive }) => {
		let active = true
		let release: (() => void) | undefined
		let acquisitionFailed = false
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
			acquisitionFailed = true
			failed()
		}
		const dispose = (): ObservationReleaseOutcome => {
			active = false
			try {
				release?.()
				return acquisitionFailed ? 'unresolved' : 'released'
			} catch (error) {
				if (!options.disposalFailed) throw error
				options.disposalFailed(input, error)
				return 'unresolved'
			}
		}
		receive((event) => {
			if (event.type !== 'RELEASE' || !active || !options.released) return
			const outcome = dispose()
			sendBack(options.released(input, outcome))
		})
		return () => {
			if (active) dispose()
		}
	})
}
