import { createActor, SimulatedClock } from 'xstate'
import { vi } from 'vitest'
import {
	brokerHostCall,
	type BrokerHostOperation,
	type BrokerHostResult
} from 'delightful-local-first/backend/jazz/worker-broker'
import {
	serveFinanceBrokerGrant,
	serveFinanceGenerationGrant
} from '../../runtime/worker/broker-host.js'
import type { FinanceGrantDescriptor } from '../../runtime/worker/grant-binding.js'
import type { FinanceGrantOwnerInput, FinanceGrantOwnerReport } from './worker-grant-contracts.js'
import {
	createGrantFixtureParent,
	type GrantFixtureInput
} from '../../../../tests/worker-bindings/grant-owner-parent.js'

export const origin = 'https://finance.example'
export const key = 'jazz:shared-worker-generation:jazz-runtime:owner-fixture'
export const url = `${origin}/assets/broker.js`
export const name = 'jazz-runtime:owner-fixture:generation-2'
type MutableConfiguration = {
	-readonly [Field in keyof Omit<FinanceGrantOwnerInput, 'reportTo'>]: Omit<
		FinanceGrantOwnerInput,
		'reportTo'
	>[Field]
}
export function grantFixture(
	options: {
		manual?: boolean
		start?: boolean
		descriptor?: FinanceGrantDescriptor
		configure?: (input: MutableConfiguration) => void
		onReport?: (report: FinanceGrantOwnerReport) => void
	} = {}
) {
	const resources = new Set<() => void>()
	function pair() {
		const value = new MessageChannel()
		resources.add(() => {
			value.port1.close()
			value.port2.close()
		})
		return value
	}
	const data = pair(),
		control = pair()
	const clock = new SimulatedClock()
	const identity = {
		runtimeId: crypto.randomUUID(),
		grantId: crypto.randomUUID(),
		acquisitionId: crypto.randomUUID()
	}
	const close = { scope: identity.grantId, requestId: crypto.randomUUID() }
	const descriptor = options.descriptor ?? { kind: 'generation', key }
	const postAcquire = vi.fn<FinanceGrantOwnerInput['postAcquire']>(() => ({ kind: 'posted' }))
	const configuration = {
		request: { version: 1, ...identity, type: 'ACQUIRE_GRANT', descriptor },
		origin,
		closeRequestId: close.requestId,
		acquisitionTimeoutMs: 10,
		requestTimeoutMs: 5,
		closeTimeoutMs: 7,
		postAcquire
	} satisfies Omit<FinanceGrantOwnerInput, 'reportTo'>
	let stored: string | null = 'raw generation'
	const native = {
		origin,
		storage: {
			getItem: vi.fn(() => stored),
			setItem: vi.fn((_key: string, value: string) => {
				stored = value
			})
		},
		openBroker: vi.fn((_url: string, _name: string) => {
			const echo = pair()
			echo.port2.onmessage = ({ data }) => echo.port2.postMessage(data)
			return Object.assign(new EventTarget(), { port: echo.port1 })
		})
	}
	const commands: unknown[] = [],
		dataCommands: unknown[] = []
	control.port1.addEventListener('message', ({ data }) => commands.push(data))
	control.port1.start()
	data.port1.addEventListener('message', ({ data }) => dataCommands.push(data))
	data.port1.start()
	if (!options.manual)
		resources.add(
			descriptor.kind === 'generation'
				? serveFinanceGenerationGrant(
						data.port1,
						control.port1,
						{ scope: identity.grantId, key: descriptor.key },
						native
					)
				: serveFinanceBrokerGrant(
						data.port1,
						control.port1,
						{ scope: identity.grantId, url: descriptor.url, name: descriptor.name },
						native
					)
		)
	options.configure?.(configuration)
	const input: GrantFixtureInput = {
		configuration: () => configuration,
		...(options.onReport ? { onReport: options.onReport } : {})
	}
	const parent = createActor(createGrantFixtureParent(), { input, clock })
	const outputs: unknown[] = []
	parent.subscribe({ complete: () => outputs.push(parent.getSnapshot().output), error: () => {} })
	const ready = {
		version: 1,
		...identity,
		type: 'GRANT_READY',
		dataPort: data.port2,
		controlPort: control.port2
	} satisfies import('../../runtime/worker/grant-protocol.js').FinanceGrantReply
	if (options.start !== false) parent.start()
	return {
		parent,
		clock,
		identity,
		close,
		configuration,
		postAcquire,
		native,
		data,
		control,
		commands,
		dataCommands,
		ready,
		outputs,
		pair,
		bind: () => parent.send({ type: 'GRANT_REPLY', reply: ready }),
		retire: () => parent.send({ type: 'RETIRE' }),
		ack: () => control.port1.postMessage({ version: 1, type: 'HOST_CLOSED', ...close }),
		issues: () =>
			parent
				.getSnapshot()
				.context.reports.flatMap((report) =>
					report.type === 'GRANT_ISSUE' ? [report.issue.kind] : []
				),
		reports: () => parent.getSnapshot().context.reports,
		call(operation: BrokerHostOperation) {
			const result = Promise.withResolvers<BrokerHostResult>()
			const settle = vi.fn((value: BrokerHostResult) => result.resolve(value))
			parent.send({ type: 'REQUEST', call: brokerHostCall(crypto.randomUUID(), operation, settle) })
			return { result: result.promise, settle }
		},
		dispose() {
			parent.stop()
			for (const release of resources) release()
		}
	}
}
