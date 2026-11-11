import { createLogger, debugEnabled } from '../diagnostics/logger.js'

const logger = createLogger('bank-sync')

// Accept only explicitly selected scalar diagnostics. Never pass events, records,
// WebAuthn results, provider payloads, URLs, or raw errors to console methods.
type Details = {
	providerHttps?: boolean
	providerHost?: 'production' | 'beta' | 'unsupported'
	providerPathAllowed?: boolean
	providerCredentialsAllowed?: boolean
	providerHasPort?: boolean
	providerHasQuery?: boolean
	providerHasFragment?: boolean
	durationMs?: number
	status?: number
	count?: number
	imported?: number
	existing?: number
	omitted?: number
	providerErrors?: number
	secureContext?: boolean
	webAuthnAvailable?: boolean
	webLocksAvailable?: boolean
	prfByteLength?: number
	prfSourceByteLength?: number
	prfIsView?: boolean
	prfIsLocalArrayBuffer?: boolean
	prfEnabled?: boolean
	prfResultPresent?: boolean
	credentialMatched?: boolean
	hasUser?: boolean
	hasOrganization?: boolean
	allowed?: boolean
	connected?: boolean
	loading?: boolean
	failed?: boolean
	aborted?: boolean
	state?:
		| 'idle'
		| 'running'
		| 'creating'
		| 'test-encryption'
		| 'encrypting'
		| 'test-decryption'
		| 'verifying'
		| 'save'
		| 'saving'
	event?:
		| 'CONNECT'
		| 'DISCOVER'
		| 'RECONNECT'
		| 'SYNC'
		| 'MAP'
		| 'CREATE_ACCOUNT'
		| 'TEST_ENCRYPTION'
		| 'VERIFY_DECRYPTION'
		| 'SAVE_CONNECTION'
		| 'DISCONNECT'
		| 'CANCEL'
		| 'RESET'
}
const knownReasons = new Set([
	'unauthorized',
	'disconnected',
	'mapping',
	'account_already_linked',
	'passkey-unavailable',
	'invalid-credential',
	'invalid-provider-url',
	'invalid_setup_token',
	'provider-failure',
	'locking_unavailable',
	'other_tab',
	'passkey_failure',
	'claim_failure',
	'save_failure',
	'unlock_failure',
	'provider_failure'
])
const errorNames = new Set([
	'AbortError',
	'NotAllowedError',
	'NotSupportedError',
	'SecurityError',
	'InvalidStateError',
	'OperationError',
	'DataError',
	'TypeError',
	'InvalidCharacterError',
	'ZodError'
])

const networkCodes = new Set([
	'ENOTFOUND',
	'EAI_AGAIN',
	'ECONNREFUSED',
	'ECONNRESET',
	'ETIMEDOUT',
	'ENETUNREACH',
	'EHOSTUNREACH',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_SOCKET',
	'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
	'SELF_SIGNED_CERT_IN_CHAIN',
	'DEPTH_ZERO_SELF_SIGNED_CERT',
	'CERT_HAS_EXPIRED',
	'ERR_TLS_CERT_ALTNAME_INVALID',
	'UND_ERR_REQ_CONTENT_LENGTH_MISMATCH'
])
function networkCode(error: unknown): string | undefined {
	if (!error || typeof error !== 'object') return undefined
	if ('code' in error && typeof error.code === 'string' && networkCodes.has(error.code))
		return error.code
	return undefined
}

export function safeBankError(error: unknown) {
	if (!(error instanceof Error)) return { errorType: 'unknown', reason: 'unclassified' }
	const reason = knownReasons.has(error.message)
		? error.message
		: error.message.startsWith('WriteRejected:')
			? 'jazz-write-rejected'
			: error.message.startsWith('Storage:')
				? 'jazz-storage-failure'
				: error.message.startsWith('NotObserved:')
					? 'query-coverage-timeout'
					: error.message.includes('catalogue has multiple genesis schemas')
						? 'schema-history-conflict'
						: 'unclassified'
	return {
		errorType: errorNames.has(error.name) ? error.name : 'Error',
		reason,
		networkCode: networkCode(error) ?? networkCode(error.cause)
	}
}

export function createBankTrace(operation: string, correlationId: string = crypto.randomUUID()) {
	function log(stage: string, details: Details = {}) {
		logger.info(`${operation} ${stage}`, { traceId: correlationId, ...details })
	}
	function failed(stage: string, error: unknown) {
		logger.warn(`${operation} ${stage}`, {
			traceId: correlationId,
			...safeBankError(error)
		})
	}
	async function step<T>(stage: string, work: () => T | PromiseLike<T>): Promise<T> {
		const start = performance.now()
		log(`${stage}:start`)
		const heartbeat = debugEnabled
			? setInterval(
					() => log(`${stage}:waiting`, { durationMs: Math.round(performance.now() - start) }),
					10000
				)
			: undefined
		try {
			const result = await work()
			log(`${stage}:done`, { durationMs: Math.round(performance.now() - start) })
			return result
		} catch (error) {
			failed(`${stage}:failed`, error)
			throw error
		} finally {
			if (heartbeat !== undefined) clearInterval(heartbeat)
		}
	}
	return { id: correlationId, log, failed, step }
}
export type BankTrace = ReturnType<typeof createBankTrace>
