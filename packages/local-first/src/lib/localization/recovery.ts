import { m } from '../paraglide/messages.js'
import type { RecoveryMessages } from '../contracts/recovery-messages.js'

export type { RecoveryMessages } from '../contracts/recovery-messages.js'

/** English is the only bundled locale. Locale resolution belongs to the host, never a singleton. */
export function createRecoveryMessages(
	locale: 'en',
	overrides: Partial<RecoveryMessages> = {}
): RecoveryMessages {
	if (locale !== 'en') throw new RangeError('Recovery messages support only the en locale')
	const options = { locale }
	return {
		description: m['recovery.description']({}, options),
		heading: m['labels.subject_recovery'](
			{ subject: m['nouns.account']({ count: 1 }, options) },
			options
		),
		show: m['actions.show_subject'](
			{ subject: m['nouns.recovery_phrase']({ count: 1 }, options) },
			options
		),
		warning: m['recovery.warning']({}, options),
		phraseLabel: m['recovery.phrase_label']({}, options),
		close: m['actions.close']({}, options),
		pending: m['recovery.pending']({}, options),
		failure: m['recovery.failure']({}, options),
		unavailable: m['recovery.unavailable']({}, options),
		retry: m['actions.retry']({}, options),
		...overrides
	}
}
