import { ReadTier } from 'jazz-tools'
import type { JazzClient } from 'jazz-tools/client'
import type { RootAccess } from '../../contracts/account.js'
import type { createLibraryCapability } from './library.js'
import { createLibraryRecords } from './records.js'
import { readConnection } from './read-connection.js'
import { app } from './jazz.generated.js'

/** Native construction only. Return capabilities, never the Db or SDK session. */
export function createLibraryBinding(
	input: Readonly<{
		db: JazzClient['db']
		identityId: string
		isCurrent: () => boolean
		libraryFactory: typeof createLibraryCapability
		cacheNamespace: string
	}>
) {
	const { db, identityId } = input
	const isCurrent = () => {
		try {
			return input.isCurrent()
		} catch {
			return false
		}
	}
	const admitted = () => {
		if (!isCurrent()) throw new Error('Account scope expired')
	}
	const root: RootAccess = {
		read: async () => {
			admitted()
			const row = await db.one(app.libraries.where({ id: identityId }), {
				tier: ReadTier.LocalFirst
			})
			if (!row) return 'missing'
			return row.ownerId === identityId && row.bootstrapVersion === '1'
				? 'compatible'
				: 'incompatible'
		},
		ensure: () => {
			admitted()
			const write = db.upsert(app.libraries, identityId, {
				ownerId: identityId,
				bootstrapVersion: '1'
			})
			return {
				local: () => write.wait({ tier: 'local' }),
				global: () => write.wait({ tier: 'global' })
			}
		}
	}
	const createRecords = (live: () => boolean = () => true) => {
		admitted()
		return createLibraryRecords(db, identityId, () => isCurrent() && live(), readConnection(db))
	}
	return {
		root,
		createRecords,
		capture: createLibraryCapture(db, isCurrent),
		createLibrary: (live: () => boolean = () => true) => {
			admitted()
			return input.libraryFactory(
				createRecords(live),
				identityId,
				createLibraryCapture(db, () => isCurrent() && live()),
				input.cacheNamespace
			)
		}
	}
}

/** Guests use the admitted Db's native proof; backend users use same-origin cookies. */
export function createLibraryCapture(
	db: Pick<JazzClient['db'], 'getConfig'>,
	isCurrent: () => boolean
) {
	return async (
		operation: 'resolve' | 'extract' | 'asset',
		body: unknown,
		signal?: AbortSignal
	) => {
		if (!isCurrent()) throw new Error('Account scope expired')
		const token = db.getConfig().jwtToken
		const response = await fetch(`/api/capture/${operation}`, {
			method: 'POST',
			credentials: 'same-origin',
			redirect: 'error',
			cache: 'no-store',
			signal: signal ?? null,
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(body)
		})
		if (!isCurrent()) {
			await response.body?.cancel()
			throw new Error('Account scope expired')
		}
		return response
	}
}
