import { faker } from '@faker-js/faker/locale/en'
import type { Category, TransactionRow } from '../schema.js'
import { appAccountSchema } from '../validation/accounts.js'
import { independentTransactionSchema } from '../validation/transactions.js'
import { stableUuid } from './stable-uuid.js'
import { ACCOUNT_KIND } from './account-kind.js'
import { PAYMENT_METHOD } from './payment-method.js'
import { EXPENSE, INCOME } from './transaction-kind.js'
import { TRANSACTION_SOURCE } from './transaction-source.js'

type FakeTransaction = Pick<
	TransactionRow,
	| 'organizationId'
	| 'accountId'
	| 'categoryId'
	| 'kind'
	| 'amountMinor'
	| 'currency'
	| 'bookedOn'
	| 'description'
	| 'memo'
	| 'paymentMethod'
	| 'source'
>
export type FakeDataPlan = {
	accounts: { id: string; values: ReturnType<typeof appAccountSchema.parse> }[]
	transactions: { id: string; values: FakeTransaction }[]
}

export function fakeTransactionDescription() {
	return faker.finance.transactionDescription()
}

/** Compute one payload; this helper never reads or writes the database. */
export async function prepareFakeData(
	organizationId: string,
	categories: readonly Category[]
): Promise<FakeDataPlan> {
	const kinds = [ACCOUNT_KIND.CASH, ACCOUNT_KIND.BANK, ACCOUNT_KIND.CARD]
	const [accountIds, transactionIds] = await Promise.all([
		Promise.all(kinds.map((kind) => stableUuid(organizationId, `fake-data:account:${kind}`))),
		Promise.all(
			Array.from({ length: 120 }, (_, index) =>
				stableUuid(organizationId, `fake-data:transaction:${index}`)
			)
		)
	])
	const accounts = kinds.map((kind, index) => ({
		id: required(accountIds[index]),
		values: appAccountSchema.parse({
			organizationId,
			kind,
			name: faker.finance.accountName(),
			currency: 'USD'
		})
	}))
	const transactions = transactionIds.map((id, index): FakeDataPlan['transactions'][number] => {
		const account = required(accounts[index % accounts.length])
		const kind = index % 5 === 0 ? INCOME : EXPENSE
		const category = faker.helpers.arrayElement(
			categories.filter((row) => row.kind === kind && row.archivedAt === null)
		)
		const values = independentTransactionSchema.parse({
			organizationId,
			accountId: account.id,
			categoryId: category.id,
			kind,
			money: {
				amountMinor: faker.number.int({ min: 100, max: kind === INCOME ? 900000 : 25000 }),
				currency: 'USD'
			},
			bookedOn: faker.date.recent({ days: 90 }).toISOString().slice(0, 10),
			description: fakeTransactionDescription(),
			paymentMethod:
				account.values.kind === ACCOUNT_KIND.CASH ? PAYMENT_METHOD.CASH : PAYMENT_METHOD.ELECTRONIC,
			source: { source: TRANSACTION_SOURCE.MANUAL }
		})
		return {
			id,
			values: {
				organizationId,
				accountId: account.id,
				categoryId: category.id,
				kind,
				amountMinor: values.money.amountMinor,
				currency: values.money.currency,
				bookedOn: values.bookedOn,
				description: values.description ?? null,
				memo: null,
				paymentMethod: values.paymentMethod,
				source: TRANSACTION_SOURCE.MANUAL
			}
		}
	})
	return { accounts, transactions }
}

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fake-data identifier')
	return value
}
