import { describe, expect, it } from 'vitest'
import {
	appProfileSchema,
	profileNameFormSchema,
	workspaceSettingsFormSchema,
	workspaceNameFormSchema,
	profileAvatarFormSchema,
	profileAvatarValuesSchema,
	MAX_AVATAR_BYTES,
	MAX_AVATAR_UPLOAD_BYTES
} from './identity.js'

describe('workspace name validation', () => {
	it('trims the submitted name', () => {
		expect(workspaceNameFormSchema.parse({ name: '  Household  ' })).toEqual({ name: 'Household' })
	})
	it.each(['', ' ', '\t\n', undefined, null, 123])('rejects invalid names %j', (name) => {
		expect(workspaceNameFormSchema.safeParse({ name }).success).toBe(false)
	})
	it('strips fields outside the name form', () => {
		expect(workspaceNameFormSchema.parse({ name: 'Household', ownerId: 'other' })).toEqual({
			name: 'Household'
		})
	})
})

describe('workspace settings validation', () => {
	it('trims the name and accepts each supported default currency', () => {
		expect(
			workspaceSettingsFormSchema.parse({ name: '  Household  ', defaultCurrency: 'USD' })
		).toEqual({ name: 'Household', defaultCurrency: 'USD' })
		expect(
			workspaceSettingsFormSchema.parse({ name: 'Household', defaultCurrency: 'TZS' })
		).toEqual({ name: 'Household', defaultCurrency: 'TZS' })
	})
	it('rejects unsupported default currencies', () => {
		expect(
			workspaceSettingsFormSchema.safeParse({ name: 'Household', defaultCurrency: 'EUR' }).success
		).toBe(false)
	})
})

describe('profile name validation', () => {
	const userId = '11111111-1111-4111-8111-111111111111'
	it('trims names in the canonical schema and form', () => {
		expect(appProfileSchema.parse({ userId, displayName: '  Matthew  ' })).toEqual({
			userId,
			displayName: 'Matthew'
		})
		expect(profileNameFormSchema.parse({ displayName: '  Matthew  ' })).toEqual({
			displayName: 'Matthew'
		})
	})
	it.each(['', ' ', '\t\n'])('clears a blank submitted name %j', (displayName) => {
		expect(profileNameFormSchema.parse({ displayName })).toEqual({ displayName: null })
	})
	it('allows missing or cleared canonical names for identity fallbacks', () => {
		expect(appProfileSchema.parse({ userId })).toEqual({ userId })
		expect(appProfileSchema.parse({ userId, displayName: null })).toEqual({
			userId,
			displayName: null
		})
	})
	it.each([undefined, null, 123, {}, ['Matthew']])(
		'rejects non-text form values %j',
		(displayName) => {
			expect(profileNameFormSchema.safeParse({ displayName }).success).toBe(false)
		}
	)
	it('strips submitted identity and profile ID fields', () => {
		expect(
			profileNameFormSchema.parse({ displayName: 'Matthew', userId: 'other', id: 'other' })
		).toEqual({ displayName: 'Matthew' })
	})
	it('rejects invalid canonical identity and blank canonical names', () => {
		expect(appProfileSchema.safeParse({ userId: 'invalid', displayName: 'Matthew' }).success).toBe(
			false
		)
		expect(appProfileSchema.safeParse({ userId, displayName: ' ' }).success).toBe(false)
	})
})

describe('profile avatar validation', () => {
	const avatar = { avatarData: new Uint8Array([1, 2, 3]), avatarMimeType: 'image/webp' }
	it('accepts complete avatar values or complete removal', () => {
		expect(profileAvatarValuesSchema.parse(avatar)).toEqual(avatar)
		expect(profileAvatarValuesSchema.parse({ avatarData: null, avatarMimeType: null })).toEqual({
			avatarData: null,
			avatarMimeType: null
		})
	})
	it.each([
		{ avatarData: null, avatarMimeType: 'image/png' },
		{ avatarData: new Uint8Array([1]), avatarMimeType: null },
		{ avatarData: new Uint8Array(), avatarMimeType: 'image/png' },
		{ avatarData: new Uint8Array(MAX_AVATAR_BYTES + 1), avatarMimeType: 'image/png' },
		{ avatarData: new Uint8Array([1]), avatarMimeType: 'image/svg+xml' },
		{ avatarData: [1, 2], avatarMimeType: 'image/png' },
		{}
	])('rejects inconsistent or invalid stored avatar values %#', (values) => {
		expect(profileAvatarValuesSchema.safeParse(values).success).toBe(false)
	})
	it('accepts an upload above the stored-byte limit and strips unrelated fields without processing', () => {
		const file = new File([new Uint8Array(MAX_AVATAR_BYTES + 1)], 'photo.png', {
			type: 'image/png'
		})
		expect(profileAvatarFormSchema.parse({ action: 'upload', file, userId: 'injected' })).toEqual({
			action: 'upload',
			file
		})
	})
	it.each([
		new File([], 'empty.png', { type: 'image/png' }),
		new File(['svg'], 'photo.svg', { type: 'image/svg+xml' }),
		new File([new Uint8Array(MAX_AVATAR_UPLOAD_BYTES + 1)], 'large.png', { type: 'image/png' })
	])('rejects invalid file drafts %#', (file) => {
		expect(profileAvatarFormSchema.safeParse({ action: 'upload', file }).success).toBe(false)
	})
	it('accepts a removal draft and strips unrelated fields synchronously', () => {
		expect(profileAvatarFormSchema.parse({ action: 'remove', file: 'ignored' })).toEqual({
			action: 'remove'
		})
	})
})
