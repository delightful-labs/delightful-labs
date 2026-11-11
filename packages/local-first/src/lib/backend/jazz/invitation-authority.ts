import { isRequestAuthenticationError, isNoJazzAccountError, type Jazz } from 'jazz-tools/backend'
import type { SerializableWriteHandle, Transaction } from 'jazz-tools'
import type { InvitationAuthorityAdmission } from '../../contracts/workspace-invitation-authority.js'

type Client = Pick<Jazz, 'forReqUser'>
type Admission = InvitationAuthorityAdmission<Transaction<'serializable'>, SerializableWriteHandle>

/** Server-only adapter. The host retains its backend session and owns transaction sequencing. */
export function createJazzInvitationAuthority(
	client: Client,
	retainDetached: (
		accountId: string,
		custody: import('../../contracts/transaction-custody.js').DetachedTransaction<
			Transaction<'serializable'>,
			Readonly<{ write: SerializableWriteHandle }>
		>
	) => void
) {
	return {
		async admit(request: Pick<Request, 'url' | 'method' | 'headers'>): Promise<Admission> {
			try {
				// Capture before awaiting verification; later host Headers changes cannot replace the caller.
				const captured = new Request(request.url, {
					method: request.method,
					headers: new Headers(request.headers)
				})
				const db = await client.forReqUser(captured)
				const accountId = db.getAuthState().session?.user
				if (!accountId) return { outcome: 'unauthenticated' }
				return {
					outcome: 'admitted',
					accountId,
					transactions: {
						open: () => db.beginSerializableTransaction(),
						retainDetached: (custody) => retainDetached(accountId, custody),
						commit: (transaction) => ({ write: transaction.commit() }),
						confirm: (write) => write.wait(),
						rollback: (transaction) => transaction.rollback()
					}
				}
			} catch (error) {
				return {
					outcome:
						isRequestAuthenticationError(error) || isNoJazzAccountError(error)
							? 'unauthenticated'
							: 'unavailable'
				}
			}
		}
	}
}
