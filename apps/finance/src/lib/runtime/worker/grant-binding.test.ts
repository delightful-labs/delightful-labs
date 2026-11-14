import { expect, it } from 'vitest'
import { financeGrantDescriptor, financeGrantKey } from './grant-binding.js'

const origin = 'https://finance.example'
const url = `${origin}/assets/broker.js`
const name = 'jazz-runtime:exact-sdk-root:generation-2'
const key = 'jazz:shared-worker-generation:jazz-runtime:exact-sdk-root'
const runtime = '11111111-1111-4111-8111-111111111111'

it('uses canonical URLs while preserving the exact independent SDK key and full name', () => {
	const broker = financeGrantDescriptor({ kind: 'broker', url, name }, origin)
	const equivalent = financeGrantDescriptor(
		{ kind: 'broker', url: 'HTTPS://FINANCE.EXAMPLE:443/a/../assets/broker.js', name },
		origin
	)
	expect(equivalent).toEqual(broker)
	expect(financeGrantKey(runtime, equivalent)).toBe(financeGrantKey(runtime, broker))
	expect(financeGrantDescriptor({ kind: 'generation', key }, origin)).toEqual({
		kind: 'generation',
		key
	})
	expect(broker).toEqual({ kind: 'broker', url, name })
})

it('isolates runtime, kind, exact key, URL and full name, including ambiguous colon separators', () => {
	const descriptors = [
		{ kind: 'generation', key },
		{ kind: 'generation', key: `${key}:other` },
		{ kind: 'broker', url, name },
		{ kind: 'broker', url: `${url}?other`, name },
		{ kind: 'broker', url, name: 'jazz-runtime:exact-sdk-root:generation-3' },
		{
			kind: 'broker',
			url: `${url}?marker=:jazz-runtime:left`,
			name: 'jazz-runtime:right:generation-2'
		},
		{
			kind: 'broker',
			url: `${url}?marker=`,
			name: 'jazz-runtime:left:jazz-runtime:right:generation-2'
		}
	].map((descriptor) => financeGrantDescriptor(descriptor, origin))
	const keys = descriptors.flatMap((descriptor) => [
		financeGrantKey(runtime, descriptor),
		financeGrantKey('22222222-2222-4222-8222-222222222222', descriptor)
	])
	expect(new Set(keys).size).toBe(descriptors.length * 2)
})

it('captures descriptor fields before the caller changes its configuration', () => {
	const generation = { kind: 'generation', key }
	const broker = { kind: 'broker', url, name }
	const selectedGeneration = financeGrantDescriptor(generation, origin)
	const selectedBroker = financeGrantDescriptor(broker, origin)
	generation.key += ':replacement'
	broker.url += '?replacement'
	broker.name = 'jazz-runtime:replacement:generation-0'
	expect(selectedGeneration).toEqual({ kind: 'generation', key })
	expect(selectedBroker).toEqual({ kind: 'broker', url, name })
})

it.each([
	{ kind: 'generation', key, url },
	{ kind: 'generation', key, scope: runtime },
	{ kind: 'generation', key: 'unrelated-storage-key' },
	{ kind: 'broker', url, name, key },
	{ kind: 'broker', url, name: 'jazz-runtime:root:generation-9007199254740992' },
	{ kind: 'broker', url, name: 'jazz-runtime:root:generation--1' },
	{ kind: 'broker', url: 'https://other.example/assets/broker.js', name },
	{ kind: 'broker', url: 'https://secret@finance.example/assets/broker.js', name },
	{ kind: 'broker', url: 'ftp://finance.example/assets/broker.js', name },
	{ kind: 'broker', url: 'javascript:alert(1)', name },
	{ kind: 'unsupported', key }
])('refuses cross-kind fields, unsafe namespaces or non-admitted broker bindings %#', (value) => {
	expect(() => financeGrantDescriptor(value, origin)).toThrow(/Invalid Finance/)
})

it('accepts the documented field boundaries and rejects the next larger descriptor', () => {
	const prefix = 'jazz:shared-worker-generation:jazz-runtime:'
	const maximumKey = prefix + 'x'.repeat(65536 - prefix.length)
	const maximumUrl = `${origin}/` + 'x'.repeat(8192 - origin.length - 1)
	const suffix = ':generation-9007199254740991'
	const maximumName =
		'jazz-runtime:' + 'x'.repeat(65536 - 'jazz-runtime:'.length - suffix.length) + suffix
	expect(financeGrantDescriptor({ kind: 'generation', key: maximumKey }, origin)).toMatchObject({
		key: maximumKey
	})
	expect(
		financeGrantDescriptor({ kind: 'broker', url: maximumUrl, name: maximumName }, origin)
	).toMatchObject({ url: maximumUrl, name: maximumName })
	for (const invalid of [
		{ kind: 'generation', key: maximumKey + 'x' },
		{ kind: 'broker', url: maximumUrl + 'x', name },
		{ kind: 'broker', url, name: 'jazz-runtime:x' + maximumName.slice('jazz-runtime:'.length) }
	])
		expect(() => financeGrantDescriptor(invalid, origin)).toThrow(/Invalid Finance/)
})
