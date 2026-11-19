import type { AccountCapabilities } from '../../web/src/lib/contracts/account.js'
import { machineDiagnostics } from '../../web/src/lib/diagnostics/inspect.js'
import {
	createSessionRuntimeMachine,
	createSessionRuntimeConnection,
	sessionCloseMachine
} from 'delightful-local-first/session/runtime'
import { createActor, toPromise, waitFor } from 'xstate'
import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
import {
	createApplicationReadinessMachine,
	selectLibraryActor,
	selectApplicationView
} from '../../web/src/lib/machines/runtime/application-readiness.js'
import { existingAccountInput } from '../../web/src/lib/backend/jazz/account.js'
import { extensionLibrary } from './library.js'
import { createRuntimeMachine } from './runtime-machine.js'
import {
	acceptedAcknowledgmentSchema,
	authorizationRequestSchema,
	backgroundSender,
	runtimeMessageSchema
} from './protocol.js'
import { createAuthorizationMachine, selectAccountAccess } from './authorization-machine.js'
import { extractionJob } from './worker.js'
async function command(message: unknown) {
	if (!acceptedAcknowledgmentSchema.safeParse(await chrome.runtime.sendMessage(message)).success)
		throw new Error('invalidResponse')
}
const native = existingAccountInput(
	{ serverUrl: __CLIPPER_SERVER__, env: 'clipper' },
	extensionLibrary
)
const session = createActor(createSessionRuntimeMachine<AccountCapabilities>(), {
	input: native.native,
	...machineDiagnostics
})
const connection = createSessionRuntimeConnection(session, native.native.binding)
const owner = createActor(createApplicationReadinessMachine(), {
	...machineDiagnostics,
	input: { session: connection, parsePhrase: native.parsePhrase, signOut: native.signOut }
})
const closure = createActor(sessionCloseMachine, { input: connection, ...machineDiagnostics })
owner.subscribe({
	complete: () => {
		if (owner.getSnapshot().output?.clean) closure.start()
	}
})

const runtime = createActor(
	createRuntimeMachine({
		reload: async () => {
			owner.send({ type: 'SHUTDOWN' })
			await waitFor(owner, (snapshot) => snapshot.status === 'done')
			if (!owner.getSnapshot().output?.clean) throw new Error('Application drain failed')
			const closed = await toPromise(closure)
			if (closed.outcome !== 'closed') throw new Error('Session close failed')
			location.reload()
		},
		account: (bind) => {
			const subscription = owner.subscribe((snapshot) => {
				const view = selectApplicationView(snapshot, true)
				bind(selectLibraryActor(snapshot), view.message, view.status)
			})
			owner.start()
			session.start()
			return () => {
				subscription.unsubscribe()
				stopAfterShutdown(owner)
			}
		},
		clip: (library) => {
			const bound = library.getSnapshot().context.capability!
			return {
				library,
				accountId: bound.libraryId,
				current: bound.isCurrent,
				read: (id) => chrome.runtime.sendMessage({ type: 'CAPTURE', id }),
				extraction: extractionJob,
				issue: (capture, accountId) => command({ type: 'ISSUE', id: capture.id, accountId }),
				remove: (id) => command({ type: 'REMOVE', id })
			}
		},
		waiting: (ids, message, revision) =>
			Promise.all(
				ids.map((id) => chrome.runtime.sendMessage({ type: 'WAITING', id, message, revision }))
			),
		report: async (snapshot, revision) => {
			const { capture, message, documentId } = snapshot.context
			if (!capture || !message) return
			await chrome.runtime.sendMessage({
				type: 'PROGRESS',
				capture,
				revision,
				message,
				...(documentId ? { documentId } : {})
			})
		}
	}),
	machineDiagnostics
).start()
chrome.runtime.onMessage.addListener((value: unknown, sender, reply) => {
	const authorization = authorizationRequestSchema.safeParse(value)
	if (
		authorization.success &&
		backgroundSender(sender, chrome.runtime.id, chrome.runtime.getURL('background.js'))
	) {
		const actor = createActor(
			createAuthorizationMachine((notify) => {
				const publish = () => notify(selectAccountAccess(runtime.getSnapshot()))
				const subscription = runtime.subscribe(publish)
				publish()
				return () => subscription.unsubscribe()
			}),
			{ input: { expected: authorization.data.accountId }, ...machineDiagnostics }
		)
		void toPromise(actor)
			.then(reply, () => reply({ status: 'unavailable' }))
			.finally(() => actor.stop())
		actor.start()
		return true
	}

	const parsed = runtimeMessageSchema.safeParse(value)
	if (
		!parsed.success ||
		!backgroundSender(sender, chrome.runtime.id, chrome.runtime.getURL('background.js'))
	)
		return
	const { target: _target, ...event } = parsed.data
	const accepted = runtime.getSnapshot().can(event)
	runtime.send(event)
	reply({ accepted })
})
