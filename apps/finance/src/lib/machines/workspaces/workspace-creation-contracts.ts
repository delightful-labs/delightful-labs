import type { Organization } from '../../queries.js'

export type WorkspacePersistenceEvent = { type: 'CANCEL' } | { type: 'SHUTDOWN' }
export type WorkspacePersistenceResult =
	| { outcome: 'succeeded'; settlement: 'locallyPersisted'; workspace: Organization }
	| { outcome: 'profileUnavailable' | 'conflict'; settlement: 'notStarted' }
	| { outcome: 'failed'; settlement: 'notStarted' | 'unresolved'; error: unknown }
	| {
			outcome: 'cancelled' | 'closed'
			settlement: 'notStarted' | 'locallyPersisted' | 'unresolved'
	  }
