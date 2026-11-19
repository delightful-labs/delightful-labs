import type { AppTransforms } from './jazz.generated.js'
import { appAccountSchema } from './validation/accounts.js'
import { checkNumberText, checkDateText } from './validation/checks.js'
import { amountMinorValue, currencyText, externalIdText } from './validation/transactions.js'
import { syncCount } from './validation/bank-sync-log.js'

export const transforms = {
	accountName: {
		from: (value) => value,
		to: (value) => appAccountSchema.shape.name.parse(value)
	},
	accountCurrency: {
		from: (value) => value,
		to: (value) => appAccountSchema.shape.currency.parse(value)
	},
	checkNumber: {
		from: (value) => value,
		to: (value) => checkNumberText.parse(value)
	},
	dateOnly: {
		from: (value) => value,
		to: (value) => checkDateText.parse(value)
	},
	currency: {
		from: (value) => value,
		to: (value) => currencyText.parse(value)
	},
	externalId: {
		from: (value) => value,
		to: (value) => externalIdText.parse(value)
	},
	amountMinor: {
		from: (value) => amountMinorValue.parse(Number(value)),
		to: (value) => BigInt(amountMinorValue.parse(value))
	},
	syncCount: {
		from: (value) => syncCount.nullable().parse(value),
		to: (value) => syncCount.nullable().parse(value)
	}
} satisfies AppTransforms
