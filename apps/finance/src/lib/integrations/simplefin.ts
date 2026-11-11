import { PUBLIC_SIMPLEFIN_DEMO } from '$app/env/public'
import type { BankTrace } from './diagnostics.js'
import { requestProviderWorker } from './simplefin-worker.js'
import { requestRelay, type RelayRequest } from './simplefin-relay.js'
import { providerResponseSchema, type ProviderAccount } from '../validation/integrations.js'

export const simplefinDemo = PUBLIC_SIMPLEFIN_DEMO === 'true'

export type ProviderBalanceSnapshot = { availableBalance: string; balanceDate: Date }

export function providerBalanceSnapshot(
	account: Pick<ProviderAccount, 'balance' | 'available-balance' | 'balance-date'>
): ProviderBalanceSnapshot | undefined {
	const availableBalance = account['available-balance'] ?? account.balance
	const balanceDate = account['balance-date']
	if (availableBalance === undefined || balanceDate === undefined) return undefined
	return { availableBalance, balanceDate: new Date(balanceDate * 1000) }
}

// This reserved domain cannot be mistaken for a real Bridge credential.
const demoClaimUrl = 'https://simplefin-demo.invalid/claim'
const demoAccessUrl = 'https://demo:demo@simplefin-demo.invalid/simplefin'
const demoOrganization = { 'sfin-url': 'https://simplefin-demo.invalid', id: 'demo-bank' }
const demoAccounts = [
	{
		id: 'demo-checking',
		name: 'Demo Checking',
		currency: 'USD',
		org: demoOrganization,
		transactions: [
			{ id: 'demo-payroll', amount: '2500.00', posted: 1790985600, description: 'Demo payroll' },
			{ id: 'demo-groceries', amount: '-54.32', posted: 1791072000, description: 'Demo groceries' }
		]
	},
	{
		id: 'demo-savings',
		name: 'Demo Savings',
		currency: 'USD',
		org: demoOrganization,
		transactions: [
			{ id: 'demo-interest', amount: '1.25', posted: 1791158400, description: 'Demo interest' }
		]
	}
] satisfies ProviderAccount[]

export function providerAccountIdentity(account: ProviderAccount) {
	return JSON.stringify([
		account.org['sfin-url'],
		account.org.domain ?? account.org.id ?? '',
		account.id
	])
}

// The official developer guide also issues tokens on beta-bridge.simplefin.org.
// Keep an exact host allowlist for both client validation and the stateless relay.
export function bridgeUrl(value: string, kind: 'claim' | 'access', trace?: BankTrace) {
	const url = new URL(value)
	const hostAllowed =
		url.hostname === 'bridge.simplefin.org' || url.hostname === 'beta-bridge.simplefin.org'
	const pathAllowed =
		kind === 'claim'
			? /^\/simplefin\/claim\/[^/]+$/.test(url.pathname)
			: url.pathname === '/simplefin'
	const credentialsAllowed =
		kind === 'claim' ? !url.username && !url.password : Boolean(url.username && url.password)
	trace?.log(`provider-url.${kind}.shape`, {
		providerHttps: url.protocol === 'https:',
		providerHost:
			url.hostname === 'bridge.simplefin.org'
				? 'production'
				: url.hostname === 'beta-bridge.simplefin.org'
					? 'beta'
					: 'unsupported',
		providerPathAllowed: pathAllowed,
		providerCredentialsAllowed: credentialsAllowed,
		providerHasPort: Boolean(url.port),
		providerHasQuery: Boolean(url.search),
		providerHasFragment: Boolean(url.hash)
	})
	if (
		url.protocol !== 'https:' ||
		!hostAllowed ||
		url.port ||
		url.hash ||
		url.search ||
		!pathAllowed ||
		!credentialsAllowed
	)
		throw new Error('invalid-provider-url')
	return url
}

export function validateSetupToken(token: string, trace: BankTrace) {
	return trace.step('claim.validate-token', () => {
		if (simplefinDemo) {
			if (token.trim() !== 'demo') throw new Error('invalid-setup-token')
			return demoClaimUrl
		}
		return bridgeUrl(atob(token.trim()), 'claim', trace).href
	})
}

async function request(body: RelayRequest, signal: AbortSignal, trace: BankTrace) {
	if (simplefinDemo) throw new Error('provider-failure')
	signal.throwIfAborted()
	const response = await trace.step('relay.http', () =>
		requestRelay('/api/simplefin', body, signal, trace.id)
	)
	trace.log('relay.response', { status: response.status })
	if (!response.ok) throw new Error('provider-failure')
	return response
}
export async function claimToken(token: string, signal: AbortSignal, trace: BankTrace) {
	signal.throwIfAborted()
	const claimUrl = await validateSetupToken(token, trace)
	signal.throwIfAborted()
	if (simplefinDemo) return demoAccessUrl
	const response = await request({ operation: 'claim', url: claimUrl }, signal, trace)
	const accessUrl = await trace.step('claim.read-response', () => response.text())
	await trace.step('claim.validate-access-url', () => bridgeUrl(accessUrl, 'access', trace))
	return accessUrl
}
export async function fetchAccounts(
	accessUrl: string,
	discovery: boolean,
	signal: AbortSignal,
	trace: BankTrace
) {
	signal.throwIfAborted()
	if (simplefinDemo) {
		if (accessUrl !== demoAccessUrl) throw new Error('invalid-provider-url')
		return trace.step('demo.validate-response', () =>
			providerResponseSchema.parse({
				errors: [],
				accounts: discovery
					? demoAccounts.map(({ transactions, ...account }) => account)
					: demoAccounts
			})
		)
	}
	bridgeUrl(accessUrl, 'access', trace)
	return requestProviderWorker(accessUrl, discovery, signal, trace)
}
