import { render } from 'svelte/server'
import { describe, expect, it, vi } from 'vitest'
import RecoveryPhrase from './RecoveryPhrase.svelte'
import { createRecoveryMessages } from '../../localization/recovery.js'
import type { RecoveryScopeSource } from '../../contracts/recovery-phrase.js'

describe('owned recovery server rendering', () => {
	it('does not subscribe, export a phrase, or consult the live host', () => {
		const source: RecoveryScopeSource = { subscribe: vi.fn(() => () => {}) }
		const capability = {
			readPhrase: vi.fn(async () => 'synthetic SSR phrase'),
			isCurrentScope: vi.fn(() => true)
		}
		const { body } = render(RecoveryPhrase, {
			props: { source, capability, messages: createRecoveryMessages('en') }
		})
		expect(source.subscribe).not.toHaveBeenCalled()
		expect(capability.readPhrase).not.toHaveBeenCalled()
		expect(capability.isCurrentScope).not.toHaveBeenCalled()
		expect(body).not.toContain('<textarea')
		expect(body).not.toContain('synthetic SSR phrase')
	})

	it('keeps messages isolated between server renders', () => {
		const source: RecoveryScopeSource = { subscribe: () => () => {} }
		const capability = { readPhrase: async () => 'synthetic', isCurrentScope: () => false }
		const first = render(RecoveryPhrase, {
			props: {
				source,
				capability,
				messages: createRecoveryMessages('en', { description: 'First request text' })
			}
		})
		const second = render(RecoveryPhrase, {
			props: {
				source,
				capability,
				messages: createRecoveryMessages('en', { description: 'Second request text' })
			}
		})
		expect(first.body).toContain('First request text')
		expect(first.body).not.toContain('Second request text')
		expect(second.body).toContain('Second request text')
		expect(second.body).not.toContain('First request text')
	})
})
