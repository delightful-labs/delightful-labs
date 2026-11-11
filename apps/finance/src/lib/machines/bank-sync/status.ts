import { m } from '#lib/paraglide/messages.js'
import type { BankStatus } from '#lib/contracts/bank-presentation-contract.js'

export const bankFailureStatuses = {
	passkey: { key: 'bank.unlock_failure', label: m['bank.unlock_failure'] },
	provider: { key: 'bank.provider_failure', label: m['bank.provider_failure'] },
	mapping: { key: 'bank.mapping_failure', label: m['bank.mapping_failure'] },
	interrupted: { key: 'bank.other_tab', label: m['bank.other_tab'] }
} satisfies Record<string, BankStatus>
