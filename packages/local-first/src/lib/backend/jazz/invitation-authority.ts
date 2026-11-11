import { isRequestAuthenticationError, type JazzClient } from 'jazz-tools/backend'
import type { ExclusiveWriteHandle, Transaction } from 'jazz-tools'
import type { InvitationAuthorityAdmission } from '../../contracts/workspace-invitation-authority.js'

type Client = Pick<JazzClient, 'withAttributionForRequest'>
type Admission = InvitationAuthorityAdmission<Transaction<'exclusive'>, ExclusiveWriteHandle>

/** Server-only adapter. The host retains its backend session and owns transaction sequencing. */
export function createJazzInvitationAuthority(
	client: Client,
	retainDetached: (
		accountId: string,
		custody: import('../../contracts/transaction-custody.js').DetachedTransaction<
			Transaction<'exclusive'>,
			Readonly<{ write: ExclusiveWriteHandle }>
		>
	) => void
) {
	return {
		async admit(request: Pick<Request, 'headers'>): Promise<Admission> {
			try {
				// Capture before awaiting verification; later host Headers changes cannot replace the caller.
				const captured = {
					headers: Object.freeze({
						authorization: request.headers.get('authorization') ?? undefined
					})
				}
				const db = await client.withAttributionForRequest(captured)
				const accountId = db.getAuthState().session?.user.account
				if (!accountId) return { outcome: 'unauthenticated' }
				return {
					outcome: 'admitted',
					accountId,
					transactions: {
						open: () => db.beginExclusiveTransaction(),
						retainDetached: (custody) => retainDetached(accountId, custody),
						commit: (transaction) => ({ write: transaction.commit() }),
						confirm: (write) => write.wait(),
						rollback: (transaction) => transaction.rollback()
					}
				}
			} catch (error) {
				return { outcome: isRequestAuthenticationError(error) ? 'unauthenticated' : 'unavailable' }
			}
		}
	}
}
