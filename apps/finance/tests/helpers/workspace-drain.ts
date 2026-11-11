import { expect, type Page } from '@playwright/test'

/** Hold the acknowledgement of a real, already locally persisted SDK write. */
export async function holdWorkspaceWrite(page: Page, kind: 'transfer' | 'bank') {
	return page.evaluateHandle(async (kind) => {
		const sessionPath = '/src/lib/runtime/jazz-session.ts'
		const schemaPath = '/src/lib/schema.ts'
		const { getCurrentJazzSession }: typeof import('../../src/lib/runtime/jazz-session.js') =
			await import(sessionPath)
		const { app }: typeof import('../../src/lib/schema.js') = await import(schemaPath)
		const session = getCurrentJazzSession()
		const db = session?.getSnapshot().client?.db
		if (!session || !db) throw new Error('Missing SDK session')
		const gate = Promise.withResolvers<void>()
		let started = false
		let restores = 0
		let restoring = false
		// Observe the SDK's public operation transition, as the authentication fixtures do.
		// Do not replace a method on a session facade that may delegate to another owner.
		const unsubscribe = session.subscribe(() => {
			const next = session.getSnapshot().pending === 'restoreLocalFirst'
			if (next && !restoring) restores += 1
			restoring = next
		})
		const begin = db.beginTransaction.bind(db)
		const descriptor = Object.getOwnPropertyDescriptor(db, 'insert')
		const insert = db.insert
		let armed = true
		if (kind === 'transfer') {
			Object.defineProperty(db, 'beginTransaction', {
				configurable: true,
				writable: true,
				value: (...args: Parameters<typeof begin>) => {
					const transaction = begin(...args)
					if (!armed) return transaction
					armed = false
					const commit = transaction.commit.bind(transaction)
					transaction.commit = (...args) => {
						const handle = commit(...args)
						const wait = handle.wait.bind(handle)
						handle.wait = async (...options) => {
							const [option] = options
							const result = await wait({ tier: option.tier })
							started = true
							await gate.promise
							return result
						}
						return handle
					}
					return transaction
				}
			})
		} else {
			Object.defineProperty(db, 'insert', {
				configurable: true,
				writable: true,
				value: function (this: object, ...args: unknown[]): unknown {
					const handle: unknown = Reflect.apply(insert, this, args)
					if (!armed || args[0] !== app.transactions) return handle
					armed = false
					if (
						!handle ||
						typeof handle !== 'object' ||
						!('wait' in handle) ||
						typeof handle.wait !== 'function'
					)
						throw new Error('Missing SDK write acknowledgement')
					const wait = handle.wait
					Object.defineProperty(handle, 'wait', {
						configurable: true,
						writable: true,
						value: async (...options: unknown[]) => {
							const result: unknown = await Reflect.apply(wait, handle, options)
							started = true
							await gate.promise
							return result
						}
					})
					return handle
				}
			})
		}
		return {
			get started() {
				return started
			},
			get restores() {
				return restores
			},
			snapshot: () => {
				const value = session.getSnapshot()
				return {
					status: value.status,
					pending: value.pending ?? null,
					hasClient: Boolean(value.client),
					errorName: value.error?.name ?? null
				}
			},
			release: () => gate.resolve(),
			restore: () => {
				Object.defineProperty(db, 'beginTransaction', {
					configurable: true,
					writable: true,
					value: begin
				})
				if (descriptor) Object.defineProperty(db, 'insert', descriptor)
				else Reflect.deleteProperty(db, 'insert')
				unsubscribe()
				gate.resolve()
			}
		}
	}, kind)
}

export function machineErrors(page: Page) {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'warning' && message.text().includes('sent to stopped actor'))
			errors.push(message.text())
	})
	return errors
}

export async function ownRecoveryPhrase(page: Page) {
	const { navigateSidebar } = await import('./ui.js')
	await navigateSidebar(page, 'Account')
	await page.getByRole('button', { name: 'Show Recovery phrase', exact: true }).click()
	const phrase = await page.getByLabel('Your recovery phrase', { exact: true }).inputValue()
	await page.getByRole('button', { name: 'Close', exact: true }).click()
	return phrase
}

export async function requestRecovery(page: Page, phrase: string) {
	const { navigateSidebar } = await import('./ui.js')
	await navigateSidebar(page, 'Login')
	const input = page.getByLabel('Recovery phrase', { exact: true })
	await input.fill(phrase)
	await page.getByRole('button', { name: 'Login', exact: true }).click()
	// Recovery shuts down the coordinator and unmounts the route while its writes drain.
	await expect(input).toHaveCount(0)
	await expect(
		page.getByRole('status').filter({ hasText: 'Getting your workspaces ready…' })
	).toBeVisible()
}
