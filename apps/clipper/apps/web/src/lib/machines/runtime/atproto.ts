import { createAtprotoWorkflow } from 'delightful-local-first/auth/atproto/workflow'
import { t } from '../../localization/index.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'

export { AUTH_REQUEST_TIMEOUT_MS } from 'delightful-local-first/auth/atproto/workflow'
export const { machine: atprotoMachine, selectView } = createAtprotoWorkflow({
	defaultAuthorizationScope: 'atproto repo:at.margin.note',
	messages: {
		working: { text: t('account.status.working'), variant: 'info' } satisfies WorkflowMessage,
		failed: {
			text: t('account.feedback.identityFailed'),
			variant: 'error'
		} satisfies WorkflowMessage
	}
})

/** Clipper does not request confirmation; preserve its existing worker view contract. */
export function selectAtprotoView(...input: Parameters<typeof selectView>) {
	const { confirmationRequired: _confirmationRequired, ...view } = selectView(...input)
	return view
}
