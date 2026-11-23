import { createAtprotoWorkflow } from 'delightful-local-first/auth/atproto/workflow'

import type { FinanceAuthMessage } from '../../contracts/worker-auth.js'
export type { FinanceAuthMessage } from '../../contracts/worker-auth.js'
export const { machine: financeAtprotoMachine, selectView: selectFinanceAtprotoView } =
	createAtprotoWorkflow<FinanceAuthMessage>({
		messages: {
			working: { key: 'login.atproto_working', variant: 'info' },
			failed: { key: 'login.atproto_failed', variant: 'error' }
		}
	})
