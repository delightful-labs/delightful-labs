import { afterEach, expect, it, vi } from 'vitest'
import {
	decodeFinanceGrantRequest,
	decodeFinanceGrantReply,
	sameFinanceGrantIdentity,
	type FinanceGrantIdentity
} from './grant-protocol.js'

const identity: FinanceGrantIdentity = {
	runtimeId: '11111111-1111-4111-8111-111111111111',
	grantId: '22222222-2222-4222-8222-222222222222',
	acquisitionId: '33333333-3333-4333-8333-333333333333'
}
const key = 'jazz:shared-worker-generation:jazz-runtime:exact-root'
const acquire = {
	version: 1,
	...identity,
	type: 'ACQUIRE_GRANT',
	descriptor: { kind: 'generation', key }
}
const cleanup = new Set<() => void>()
afterEach(() => {
	for (const release of cleanup) release()
	cleanup.clear()
	vi.restoreAllMocks()
})
function pair() {
	const channel = new MessageChannel()
	cleanup.add(() => {
		channel.port1.close()
		channel.port2.close()
	})
	return channel
}
function fixture() {
	const data = pair(),
		control = pair(),
		orphan = pair()
	const ready = {
		version: 1,
		...identity,
		type: 'GRANT_READY',
		dataPort: data.port1,
		controlPort: control.port1
	}
	return { data, control, orphan, ready, ports: [data.port1, control.port1] }
}

it('copies a bounded request without inferring grant admission or scope validity for an owner', () => {
	const value = { ...acquire, descriptor: { ...acquire.descriptor } }
	const result = decodeFinanceGrantRequest(value, [])
	value.descriptor.key += ':replacement'
	value.runtimeId = '44444444-4444-4444-8444-444444444444'
	expect(result).toEqual({ kind: 'valid', message: acquire })
	if (result.kind !== 'valid') throw new Error('Missing decoded acquisition')
	expect(sameFinanceGrantIdentity(identity, result.message)).toBe(true)
	expect(sameFinanceGrantIdentity(value, result.message)).toBe(false)
})

it('decodes an independent broker descriptor and rejects descriptor fields from another grant kind', () => {
	const broker = {
		kind: 'broker',
		url: 'https://finance.example/broker.js',
		name: 'jazz-runtime:exact-root:generation-2'
	}
	const frame = { ...acquire, descriptor: broker }
	expect(decodeFinanceGrantRequest(frame, [])).toEqual({ kind: 'valid', message: frame })
	expect(decodeFinanceGrantRequest({ ...frame, descriptor: { ...broker, key } }, [])).toEqual({
		kind: 'invalid'
	})
	expect(
		decodeFinanceGrantRequest(
			{ ...acquire, descriptor: { kind: 'generation', key: 'foreign-storage' } },
			[]
		)
	).toEqual({ kind: 'invalid' })
})

it('rejects unknown failure reasons rather than treating uncertainty as a definitive refusal', () => {
	expect(
		decodeFinanceGrantReply(
			{ version: 1, ...identity, type: 'GRANT_UNCERTAIN', reason: 'rejected' },
			[]
		)
	).toEqual({ kind: 'invalid' })
	expect(
		decodeFinanceGrantReply(
			{ version: 1, ...identity, type: 'GRANT_REFUSED', reason: 'timeout' },
			[]
		)
	).toEqual({ kind: 'invalid' })
})

it.each(['runtimeId', 'grantId', 'acquisitionId'] satisfies (keyof FinanceGrantIdentity)[])(
	'requires the original %s for correlation, while leaving that decision to the chart',
	(field) => {
		const foreign = { ...identity, [field]: '44444444-4444-4444-8444-444444444444' }
		const decoded = decodeFinanceGrantReply(
			{ version: 1, ...foreign, type: 'GRANT_UNCERTAIN', reason: 'unavailable' },
			[]
		)
		if (decoded.kind !== 'valid') throw new Error('Well-formed foreign report was not decoded')
		expect(sameFinanceGrantIdentity(identity, decoded.message)).toBe(false)
		expect(sameFinanceGrantIdentity(foreign, decoded.message)).toBe(true)
	}
)

it.each([
	{ type: 'GRANT_REFUSED', reason: 'rejected' },
	{ type: 'GRANT_REFUSED', reason: 'overloaded' },
	{ type: 'GRANT_REFUSED', reason: 'unavailable' },
	{ type: 'GRANT_UNCERTAIN', reason: 'unavailable' }
])(
	'preserves the distinct $type/$reason fact and forbids resource-bearing failure reports',
	(status) => {
		const f = fixture(),
			message = { version: 1, ...identity, ...status }
		expect(decodeFinanceGrantReply(message, [])).toEqual({ kind: 'valid', message })
		expect(decodeFinanceGrantReply(message, [f.data.port1])).toEqual({ kind: 'invalid' })
		expect(decodeFinanceGrantReply({ ...message, dataPort: f.data.port1 }, [])).toEqual({
			kind: 'invalid'
		})
	}
)

it.each([
	{ field: 'version', value: 2 },
	{ field: 'runtimeId', value: 'wrong-runtime' },
	{ field: 'grantId', value: '' },
	{ field: 'acquisitionId', value: undefined },
	{ field: 'type', value: 'HOST_CLOSED' },
	{ field: 'rawError', value: 'private native exception' }
])('rejects invalid $field on every request/reply variant', ({ field, value }) => {
	const f = fixture()
	expect(decodeFinanceGrantRequest({ ...acquire, [field]: value }, [])).toEqual({ kind: 'invalid' })
	for (const { message, ports } of [
		{ message: f.ready, ports: f.ports },
		{ message: { version: 1, ...identity, type: 'GRANT_REFUSED', reason: 'rejected' }, ports: [] },
		{
			message: { version: 1, ...identity, type: 'GRANT_UNCERTAIN', reason: 'unavailable' },
			ports: []
		}
	])
		expect(decodeFinanceGrantReply({ ...message, [field]: value }, ports)).toEqual({
			kind: 'invalid'
		})
})

type InvalidTransfer =
	'missing' | 'single' | 'extra' | 'swapped' | 'undeclared' | 'aliased' | 'fake'
it.each([
	'missing',
	'single',
	'extra',
	'swapped',
	'undeclared',
	'aliased',
	'fake'
] satisfies InvalidTransfer[])(
	'rejects a %s port pair without disposing it or issuing native operations',
	(kind) => {
		const f = fixture()
		const effects = [f.data.port1, f.control.port1, f.orphan.port1].flatMap((port) => [
			vi.spyOn(port, 'close'),
			vi.spyOn(port, 'start'),
			vi.spyOn(port, 'postMessage')
		])
		const cases: Record<InvalidTransfer, { message: unknown; ports: MessagePort[] }> = {
			missing: { message: f.ready, ports: [] },
			single: { message: f.ready, ports: [f.data.port1] },
			extra: { message: f.ready, ports: [...f.ports, f.orphan.port1] },
			swapped: { message: f.ready, ports: [f.control.port1, f.data.port1] },
			undeclared: { message: { ...f.ready, dataPort: f.orphan.port1 }, ports: f.ports },
			aliased: {
				message: { ...f.ready, controlPort: f.data.port1 },
				ports: [f.data.port1, f.data.port1]
			},
			fake: { message: { ...f.ready, dataPort: {} }, ports: f.ports }
		}
		const selected = cases[kind]
		expect(decodeFinanceGrantReply(selected.message, selected.ports)).toEqual({ kind: 'invalid' })
		expect(decodeFinanceGrantRequest(acquire, [f.orphan.port1])).toEqual({ kind: 'invalid' })
		for (const effect of effects) expect(effect).not.toHaveBeenCalled()
	}
)

it('accepts an actual transferred pair with independent data/control communication and no decoder effects', async () => {
	const f = fixture(),
		transport = pair()
	const received = Promise.withResolvers<MessageEvent<unknown>>()
	transport.port2.onmessage = (event) => received.resolve(event)
	transport.port1.postMessage(f.ready, f.ports)
	const event = await received.promise
	const effects = event.ports.flatMap((port) => [
		vi.spyOn(port, 'close'),
		vi.spyOn(port, 'start'),
		vi.spyOn(port, 'postMessage')
	])
	for (const port of event.ports) cleanup.add(() => port.close())
	const decoded = decodeFinanceGrantReply(event.data, event.ports)
	if (decoded.kind !== 'valid' || decoded.message.type !== 'GRANT_READY')
		throw new Error('Missing native transferred grant')
	expect(sameFinanceGrantIdentity(identity, decoded.message)).toBe(true)
	for (const effect of effects) expect(effect).not.toHaveBeenCalled()
	const observed: { data: unknown[]; control: unknown[] } = { data: [], control: [] }
	f.data.port2.onmessage = ({ data }) => observed.data.push(data)
	f.control.port2.onmessage = ({ data }) => observed.control.push(data)
	decoded.message.dataPort.postMessage('data path')
	decoded.message.controlPort.postMessage('control path')
	await vi.waitFor(() =>
		expect(observed).toEqual({ data: ['data path'], control: ['control path'] })
	)
})
