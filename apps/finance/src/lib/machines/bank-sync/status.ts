import type { BankStatus } from '#lib/contracts/bank-presentation-contract.js'

export const bankFailureStatuses = {
	passkey: { key: 'bank.unlock_failure' },
	provider: { key: 'bank.provider_failure' },
	mapping: { key: 'bank.mapping_failure' },
	interrupted: { key: 'bank.other_tab' }
} satisfies Record<string, BankStatus>
