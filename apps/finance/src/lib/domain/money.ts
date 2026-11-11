export type MoneyParseResult =
	| { kind: 'valid'; amountMinor: number }
	| { kind: 'invalid'; reason: 'empty' | 'format' | 'too-large' }

const currencySymbols: Record<string, string> = { TZS: 'TSh' }

function currencyPartValue(currency: string, value: string): string {
	return currencySymbols[currency] ?? value
}

export function currencyFractionDigits(currency: string): number {
	return (
		new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
			.maximumFractionDigits ?? 2
	)
}

export function amountInputPattern(currency = 'USD'): string {
	const fractionDigits = currencyFractionDigits(currency)
	const fraction = fractionDigits > 0 ? String.raw`(?:\.(\d{1,${fractionDigits}}))?` : ''
	return String.raw`^(0|[1-9]\d*)${fraction}$`
}

/** Parse a non-negative amount using the currency's ISO minor-unit precision. */
export function parseAmountMinor(input: string, currency = 'USD'): MoneyParseResult {
	const value = input.trim()
	if (value.length === 0) return { kind: 'invalid', reason: 'empty' }

	const fractionDigits = currencyFractionDigits(currency)
	const match = new RegExp(amountInputPattern(currency)).exec(value)
	if (match === null) return { kind: 'invalid', reason: 'format' }

	const amountMinor = BigInt(`${match[1]}${(match[2] ?? '').padEnd(fractionDigits, '0')}`)
	if (amountMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
		return { kind: 'invalid', reason: 'too-large' }
	}

	return { kind: 'valid', amountMinor: Number(amountMinor) }
}

export function minorUnitsToInput(amountMinor: number, currency: string): string {
	if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
		throw new RangeError('Money must be a non-negative integer amount in minor units.')
	}
	const fractionDigits = currencyFractionDigits(currency)
	const scale = 10 ** fractionDigits
	const whole = Math.floor(amountMinor / scale)
	if (fractionDigits === 0) return String(whole)
	const fraction = String(amountMinor % scale).padStart(fractionDigits, '0')
	return `${whole}.${fraction}`
}

export function formatMoney(amountMinor: number, currency: string, locale = 'en-US'): string {
	if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
		throw new RangeError('Money must be a non-negative integer amount in minor units.')
	}

	const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
	const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
	const scale = 10 ** fractionDigits
	const whole = Math.floor(amountMinor / scale)
	const fraction = amountMinor % scale
	const parts = formatter.formatToParts(whole)
	if (fractionDigits === 0) return parts.map((part) => part.value).join('')

	const localizedFraction = new Intl.NumberFormat(locale, {
		useGrouping: false,
		minimumIntegerDigits: fractionDigits
	}).format(fraction)
	return parts
		.map((part) =>
			part.type === 'fraction'
				? localizedFraction
				: part.type === 'currency'
					? currencyPartValue(currency, part.value)
					: part.value
		)
		.join('')
}

export function formatSignedMoney(amountMinor: bigint, currency: string, locale = 'en-US'): string {
	const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency })
	const fractionDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2
	const scale = 10n ** BigInt(fractionDigits)
	const negative = amountMinor < 0n
	const absolute = negative ? -amountMinor : amountMinor
	const whole = absolute / scale
	const fraction = absolute % scale
	const wholeAmount = negative ? (whole === 0n ? -0 : -whole) : whole
	const parts = formatter.formatToParts(wholeAmount)
	if (fractionDigits === 0) return parts.map((part) => part.value).join('')
	const localizedFraction = new Intl.NumberFormat(locale, {
		useGrouping: false,
		minimumIntegerDigits: fractionDigits,
		maximumFractionDigits: 0
	}).format(fraction)
	return parts
		.map((part) =>
			part.type === 'fraction'
				? localizedFraction
				: part.type === 'currency'
					? currencyPartValue(currency, part.value)
					: part.value
		)
		.join('')
}
