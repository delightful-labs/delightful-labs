import { m } from '../paraglide/messages.js'
import {
	bankSetupSteps,
	type BankMessage,
	type BankStatus
} from '../contracts/bank-presentation-contract.js'
export function bankStatusText(status: BankStatus) {
	return status.key === 'bank.idle_step'
		? m['bank.idle_step']({ step: bankSetupSteps[0].label() })
		: m[status.key]()
}
export function bankMessageText(message: BankMessage): string {
	if (message.key === 'unavailableBank')
		return m['status.unavailable_subject']({ subject: m['bank.title']() })
	if (message.key === 'saveTransactionsFailed')
		return m['errors.save_subject']({ subject: m['nouns.transaction']({ count: 2 }) })
	if (message.key === 'bank.idle_step') return bankStatusText({ key: message.key })
	return m[message.key]()
}
