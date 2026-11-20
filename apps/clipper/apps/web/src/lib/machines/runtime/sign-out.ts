import { createOrderedSignOutMachine } from 'delightful-local-first/session/sign-out/workflow'
import type {
	OrderedSignOutInput,
	SignOutStage
} from 'delightful-local-first/session/sign-out/contracts'
import type { AccountInput, AccountObservation } from '../../contracts/account.js'

export type { SignOutStage }
export const signOutMachine = createOrderedSignOutMachine()

/** Captured binding survives provider settlement; the shared runtime rechecks mutation admission. */
export function signOutInput(
	input: AccountInput,
	observation: AccountObservation,
	attempt: number,
	onOverdue?: (stage: SignOutStage) => void
): OrderedSignOutInput {
	return {
		...(input.signOut ? { provider: input.signOut } : {}),
		observeSession: () => {
			const current = input.session.view.get().observation
			if (
				current?.status === 'signed-out' ||
				(current?.status === 'ready' && current.identityKind === 'device')
			)
				return 'signed-out'
			if (current?.status !== 'ready') return 'unavailable'
			return observation.status === 'ready' && current.binding === observation.binding
				? 'current'
				: 'replaced'
		},
		session: {
			session: input.session,
			scope: { binding: input.session.binding, attempt },
			change: {
				operation: 'signOut',
				before: observation.status === 'ready' ? observation : undefined
			}
		},
		...(onOverdue ? { onOverdue } : {})
	}
}
