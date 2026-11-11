// Resolve actual built entries. Synthetic ownership resources never create or close an SDK client.
import { createActor, createStepLogic, waitFor } from 'xstate'
import { createJazzSessionAcquisition } from 'delightful-local-first/backend/jazz/session'
import {
	createSessionAcquisitionMachine,
	createSessionStartupMachine,
	createSessionReadinessMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
import 'delightful-local-first/session/contracts'

const backend = createJazzSessionAcquisition({
	appId: 'package-session',
	serverUrl: 'http://127.0.0.1:9'
})
if (typeof backend.capability.open !== 'function') throw new Error('Session creation entry missing')
const session = { id: 'synthetic package session' }
let opens = 0
const owner = createActor(createSessionAcquisitionMachine(), {
	input: {
		binding: backend.binding,
		capability: {
			open: async () => {
				opens += 1
				return session
			}
		}
	}
}).start()
const reporter = createActor(
	createStepLogic({
		context: 0,
		run: (
			/** @type {{context:number;event:import('delightful-local-first/session/contracts').SessionStartupReport<object>}} */ {
				context,
				event
			}
		) => ({ context: event.type === 'SESSION_ACQUIRED' ? context + 1 : context })
	})
).start()
const first = createActor(createSessionStartupMachine(), { input: { reportTo: reporter } }).start()
const second = createActor(createSessionStartupMachine(), { input: { reportTo: reporter } }).start()
try {
	first.send({
		type: 'START',
		owner,
		scope: { binding: backend.binding, attachment: {}, generation: 0 }
	})
	await waitFor(reporter, (snapshot) => snapshot.context === 1)
	first.send({ type: 'SHUTDOWN' })
	await waitFor(first, (snapshot) => snapshot.status === 'done')
	second.send({
		type: 'START',
		owner,
		scope: { binding: backend.binding, attachment: {}, generation: 0 }
	})
	await waitFor(reporter, (snapshot) => snapshot.context === 2)
	second.send({ type: 'SHUTDOWN' })
	await waitFor(second, (snapshot) => snapshot.status === 'done')
	if (opens !== 1 || selectAcquiredSession(owner.getSnapshot()) !== session) {
		throw new Error('Packaged session acquisition did not retain the shared reference')
	}
} finally {
	first.stop()
	second.stop()
	reporter.stop()
	owner.stop()
}

// Exercise acquired-session readiness through the built workflow and Jazz adapter entries.
const { createJazzSessionReadinessAdapter } =
	await import('delightful-local-first/backend/jazz/session-readiness')
let retries = 0
let released = 0
const unused = async () => {}
const readinessBinding = createJazzSessionReadinessAdapter({
	getSnapshot: () => ({ status: 'ready' }),
	subscribe: () => () => {
		released += 1
	},
	retry: async () => {
		retries += 1
	},
	createLocalFirst: unused,
	restoreLocalFirst: unused,
	becomeBackend: unused,
	registerJWT: unused,
	loginJWT: unused,
	loginOrRegisterJWT: unused,
	linkJWT: unused,
	logout: unused,
	close: unused
})
const readinessReporter = createActor(
	createStepLogic({
		context: 0,
		run: (
			/** @type {{context:number;event:import('delightful-local-first/session/contracts').SessionReadinessReport}} */ {
				context,
				event
			}
		) => ({
			context: event.type === 'SESSION_STATUS' && event.afterRetry === 1 ? context + 1 : context
		})
	})
).start()
const readiness = createActor(createSessionReadinessMachine(), {
	input: { reportTo: readinessReporter }
}).start()
try {
	const scope = { binding: readinessBinding.binding, attachment: {} }
	readiness.send({ type: 'BIND', scope, capability: readinessBinding.capability })
	readiness.send({ type: 'RETRY', scope, attempt: 1 })
	await waitFor(readinessReporter, (snapshot) => snapshot.context === 1)
	readiness.send({ type: 'SHUTDOWN' })
	await waitFor(readiness, (snapshot) => snapshot.status === 'done')
	if (retries !== 1 || released !== 1)
		throw new Error('Packaged readiness did not settle and release')
} finally {
	readiness.stop()
	readinessReporter.stop()
}
