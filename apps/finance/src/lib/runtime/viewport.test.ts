import { afterEach, expect, it, vi } from 'vitest'
import { isMobile } from './viewport.js'

afterEach(() => vi.unstubAllGlobals())

it('checks the current viewport on every call', () => {
	const matchMedia = vi
		.fn()
		.mockReturnValueOnce({ matches: true })
		.mockReturnValueOnce({ matches: false })
	vi.stubGlobal('window', { matchMedia })

	expect(isMobile()).toBe(true)
	expect(isMobile()).toBe(false)
	expect(matchMedia).toHaveBeenNthCalledWith(1, '(max-width: 48rem)')
	expect(matchMedia).toHaveBeenNthCalledWith(2, '(max-width: 48rem)')
})
