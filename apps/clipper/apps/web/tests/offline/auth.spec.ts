import { openArticleActions } from '../article-actions.js'
import { expectLibrarySynced, openAccountSettings, expectSignedInAccount } from '../account-ui.js'
import { authenticateGateway } from '../../src/lib/server/gateway-auth.js'
import { handleConfiguredAuth } from '../../src/lib/server/auth/completion-handler.js'
import { handlePreviewRequest } from '../../src/lib/server/publication/request.js'
import { handlePublicationPublish } from '../../src/lib/server/publication/publish.js'
import { createGatewayMachine } from '../../src/lib/machines/capture/gateway.js'
import { cidSchema } from '../../src/lib/annotations/publication-link.js'
import { publicationSchema } from '../../src/lib/annotations/publication.js'
import { firstPublicationWriteSchema } from '../../src/lib/server/publication/first-write.js'
import { chromium, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSignature } from 'better-auth/crypto'
import { acceptDeviceAccounts } from 'jazz-tools/backend'
import { createAuthServer } from '../../src/lib/server/auth/server.js'
import { app } from '../../src/lib/backend/jazz/jazz.generated.js'
import { startJazzAuthority } from '../jazz-authority.js'
import { staticShellServer } from './server.js'
import { openAddLink } from '../add-link.js'
import { readingControls } from '../reader-ui.js'

// Synthetic provider identity, real Better Auth session verification, real Jazz
// storage/authentication, built worker/UI and persistent browser profile.
for (const mode of ['linked', 'existing', 'expired'])
	test(`native ${mode} account survives two full offline browser restarts and reconnects`, async () => {
		const started = performance.now()
		const checkpoint = (stage: string) =>
			console.info(
				JSON.stringify({ mode, stage, elapsedMs: Math.round(performance.now() - started) })
			)
		const directory = await mkdtemp(join(tmpdir(), 'clipper-auth-offline-'))
		let profile = join(directory, 'profile')
		const origin = 'http://127.0.0.1:5190'
		const secret = 'native-auth-offline-fixture-secret-at-least-32'
		const ui = staticShellServer(
			fileURLToPath(new URL('../../.offline-test-builds/a/', import.meta.url))
		)
		const publicRecords = new Map<string, unknown>()
		let publicWrites = 0
		let publicRemovals = 0
		const publicCid = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'
		let publishedUri: string | undefined
		const signOutResponses: number[] = []
		let auth: ReturnType<typeof createAuthServer>
		const sourceGateway = createGatewayMachine({
			resolve: async () => ({ address: '93.184.216.34', family: 4 }),
			fetch: async () => ({
				status: 200,
				location: undefined,
				body: new TextEncoder().encode(
					'<nav>Original page menu.</nav><p>Readable native backend capture.</p><footer>Original footer.</footer>'
				),
				mediaType: 'text/html; charset=utf-8'
			}),
			extract: async () => {
				throw new Error('Source verification must use the original response')
			}
		})
		const start = async () => {
			const authority = await startJazzAuthority({
				port: 5191,
				origin,
				dataDir: directory,
				authenticate: async (request) => {
					const session = await auth.api.getSession({ headers: request.headers })
					return session
						? {
								userId: session.user.id,
								expiresAt: Math.floor(session.session.expiresAt.getTime() / 1000)
							}
						: acceptDeviceAccounts(request)
				}
			})
			auth = createAuthServer({ db: () => authority.backend.db, schema: app }, { origin, secret })
			ui.useAuth(async (request) => {
				if (new URL(request.url).pathname === '/api/publication/preview')
					return handlePreviewRequest(auth, authority.backend, request, origin, sourceGateway)
				if (
					[
						'/api/publication/publish',
						'/api/publication/unpublish',
						'/api/publication/cleanup'
					].includes(new URL(request.url).pathname)
				) {
					const publicationAuth = {
						api: {
							getSession: auth.api.getSession,
							getAtprotoClient: async () => ({
								session: {
									did: 'did:plc:offlinefixture',
									getTokenInfo: async () => ({
										sub: 'did:plc:offlinefixture',
										scope: 'atproto repo:at.margin.note'
									}),
									handle: async (path: string, init?: RequestInit) => {
										if (path === '/xrpc/com.atproto.repo.putRecord') {
											const write = firstPublicationWriteSchema.parse(
												JSON.parse(String(init?.body))
											)
											const uri = 'at://' + write.repo + '/' + write.collection + '/' + write.rkey
											const rows = await authority.backend.db.all(
												app.publications.where({ publishingDid: write.repo })
											)
											expect(
												rows.find((row) => 'uri' in row.lifecycle && row.lifecycle.uri === uri)
													?.lifecycle
											).toEqual({
												state: 'issued',
												uri,
												record: write.record
											})
											expect(publicRecords.has(uri)).toBe(false)
											publicRecords.set(uri, write.record)
											publicWrites++
											return Response.json({ uri, cid: 'unused-synthetic-write-receipt' })
										}
										if (path === '/xrpc/com.atproto.repo.deleteRecord') {
											const removal = firstPublicationWriteSchema
												.pick({ repo: true, collection: true, rkey: true })
												.extend({ swapRecord: cidSchema })
												.parse(JSON.parse(String(init?.body)))
											const uri =
												'at://' + removal.repo + '/' + removal.collection + '/' + removal.rkey
											const rows = await authority.backend.db.all(
												app.publications.where({ publishingDid: removal.repo })
											)
											expect(
												rows.find((row) => 'uri' in row.lifecycle && row.lifecycle.uri === uri)
													?.lifecycle
											).toEqual({
												state: 'unpublishing',
												uri,
												cid: publicCid
											})
											expect(removal.swapRecord).toBe(publicCid)
											publicRecords.delete(uri)
											publicRemovals++
											return Response.json({})
										}
										const params = new URL(path, origin).searchParams
										const uri =
											'at://' +
											params.get('repo') +
											'/' +
											params.get('collection') +
											'/' +
											params.get('rkey')
										return publicRecords.has(uri)
											? Response.json({ uri, value: publicRecords.get(uri), cid: publicCid })
											: Response.json({ error: 'RecordNotFound' }, { status: 400 })
									}
								}
							})
						}
					}
					const path = new URL(request.url).pathname
					return handlePublicationPublish(
						publicationAuth,
						authority.backend,
						request,
						origin,
						path.endsWith('/unpublish')
							? 'unpublish'
							: path.endsWith('/cleanup')
								? 'cleanup'
								: 'publish',
						sourceGateway
					)
				}
				const response = await handleConfiguredAuth(auth, request, { origin, secret })
				if (new URL(request.url).pathname === '/api/auth/sign-out')
					signOutResponses.push(response.status)
				return response
			})
			await ui.useJazz(authority.backend)
			return authority
		}
		let authority = await start()
		let authorityUp = true
		let context = await chromium.launchPersistentContext(profile, { headless: true })
		try {
			await ui.start()
			let page = await context.newPage()
			await page.goto(origin)
			await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible({
				timeout: 30000
			})
			await expectLibrarySynced(page)
			checkpoint('local library ready')
			await expect
				.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
				.toBe('activated')
			await page.route('**/api/capture/*', (route) => route.abort())
			await openAddLink(page)
			await page
				.getByLabel('Article URL', { exact: true })
				.fill('https://example.invalid/native-auth-before')
			await page
				.getByRole('dialog', { name: 'Add link', exact: true })
				.getByRole('button', { name: 'Add link', exact: true })
				.click()
			const article = page
				.locator('[data-article-id]')
				.filter({ hasText: 'https://example.invalid/native-auth-before' })
			await expect(article).toBeVisible()
			const id = await article.getAttribute('data-article-id')

			// Use Better Auth's own adapter and signing primitive; no app test route or
			// alternate production identity provider is added.
			const authContext = await auth!.$context
			const user = await authContext.internalAdapter.createUser(
				{
					name: 'Offline AT fixture',
					email: 'offline@example.invalid',
					emailVerified: true
				},
				{
					method: 'oauth',
					oauth: { providerId: 'atproto', profile: { did: 'did:plc:offlinefixture' } }
				}
			)
			if (mode === 'linked') {
				await authority.backend.db
					.update(app.better_auth_user, user.id, { atprotoDid: 'did:plc:offlinefixture' })
					.wait({ tier: 'global' })
				await authContext.internalAdapter.linkAccount({
					userId: user.id,
					providerId: 'atproto',
					accountId: 'did:plc:offlinefixture',
					scope: 'atproto'
				})
			}
			const issueSession = async () => {
				const session = await (await auth!.$context).internalAdapter.createSession(user.id)
				await context.addCookies([
					{
						name: (await auth!.$context).authCookies.sessionToken.name,
						value: encodeURIComponent(
							session.token + '.' + (await makeSignature(session.token, secret))
						),
						url: origin,
						expires: Math.floor(session.expiresAt.getTime() / 1000),
						httpOnly: true,
						sameSite: 'Lax'
					}
				])
			}
			await issueSession()
			const verificationCookies = await context.cookies(origin)
			expect(
				(
					await auth!.api.getSession({
						headers: new Headers({
							cookie: verificationCookies
								.map((cookie) => cookie.name + '=' + cookie.value)
								.join('; ')
						})
					})
				)?.user.id
			).toBe(user.id)
			await page.reload()
			await expectSignedInAccount(page)
			checkpoint('signed in')
			await expect(page.locator(`[data-article-id="${id}"]`)).toBeVisible()
			const cookies = await context.cookies(origin)
			const request = new Request(origin + '/api/auth/get-session', {
				headers: { cookie: cookies.map((cookie) => cookie.name + '=' + cookie.value).join('; ') }
			})
			expect((await auth!.api.getSession({ headers: request.headers }))?.user.id).toBe(user.id)
			const accountId = await authority.backend.accountFor(request)
			expect(accountId).toBeTruthy()
			if (!accountId) throw new Error('Expected authenticated library')
			await expect
				.poll(() =>
					authority.backend.db
						.all(app.libraryDocuments.where({ libraryId: accountId }))
						.then((rows) => rows.map((row) => row.id))
				)
				.toContain(id)

			await page.unroute('**/api/capture/*')
			await page.route('**/api/capture/*', async (route) => {
				const headers = await route.request().allHeaders()
				expect(headers.authorization).toBeUndefined()
				expect(
					await authenticateGateway(
						new Request(route.request().url(), { headers }),
						authority.backend
					)
				).toEqual({ accountId })
				const body: { operationId: string; url: string } = route.request().postDataJSON()
				const base = { operationId: body.operationId, finalUrl: body.url }
				await route.fulfill({
					json: route.request().url().endsWith('/resolve')
						? base
						: {
								...base,
								provenance: {
									submittedUrl: body.url,
									redirects: [],
									resolvedAt: new Date().toISOString()
								},
								candidate: {
									title: 'Native authorized article',
									text: 'Readable native backend capture.',
									html: '<p>Readable native backend capture.</p>',
									assetCandidates: [],
									partialEvidence: [],
									parserVersion: 'fixture',
									normalizationVersion: '1'
								}
							}
				})
			})
			await (
				await openArticleActions(page.locator(`[data-article-id="${id}"]`))
			)
				.getByRole('button', { name: 'Retry', exact: true })
				.click()
			await expect(
				page.getByRole('link', { name: 'Native authorized article', exact: true })
			).toBeVisible({ timeout: 30000 })
			await expect
				.poll(() =>
					authority.backend.db
						.one(app.libraryDocuments.where({ id: id! }))
						.then((row) => Boolean(row?.attachmentId))
				)
				.toBe(true)

			if (mode === 'existing') {
				const persistentCookies = await context.cookies(origin)
				await context.close()
				profile = join(directory, 'existing-profile')
				context = await chromium.launchPersistentContext(profile, { headless: true })
				await context.addCookies(persistentCookies)
				page = await context.newPage()
				await page.goto(origin)
				await expect(page.locator(`[data-article-id="${id}"]`)).toBeVisible({ timeout: 30000 })
				await expectSignedInAccount(page)
				await expect
					.poll(() =>
						page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)
					)
					.toBe('activated')
			}
			await page.getByRole('link', { name: 'Native authorized article', exact: true }).click()
			await expect(page.getByRole('article')).toContainText('Readable native backend capture.')
			await readingControls(page)
			if (mode === 'linked') {
				await page.getByRole('button', { name: 'Add note', exact: true }).click()
				const note = page
					.getByRole('textbox', { name: 'note', exact: true })
					.and(page.locator(':not([readonly])'))
				await note.fill('Preview my café 🦊 note.')
				await expect(page.getByText('note synced', { exact: true })).toBeVisible()
				const entered = Promise.withResolvers<void>(),
					gate = Promise.withResolvers<void>()
				await page.route(
					'**/api/publication/preview',
					async (route) => {
						entered.resolve()
						await gate.promise
						await route.continue()
					},
					{ times: 1 }
				)
				const preview = page.getByRole('dialog', { name: 'Preview', exact: true })
				const trigger = page.getByRole('button', { name: 'Preview sharing', exact: true })
				const response = page.waitForResponse((response) =>
					response.url().endsWith('/api/publication/preview')
				)
				try {
					await trigger.click()
					await entered.promise
					await expect(preview.getByText('Preparing…', { exact: true })).toBeVisible()
					await expect(
						page.getByRole('region', { name: 'highlights', exact: true })
					).toHaveAttribute('aria-busy', 'false')
				} finally {
					gate.resolve()
				}
				const result = await response
				expect(result.status()).toBe(200)
				expect(result.headers()['cache-control']).toBe('private, no-store')
				await expect(preview.getByRole('textbox', { name: 'note', exact: true })).toHaveValue(
					'Preview my café 🦊 note.'
				)
				await expect(preview.getByText('did:plc:offlinefixture', { exact: true })).toBeVisible()
				await expect(
					preview.getByRole('heading', { name: 'Sharing preview', exact: true })
				).toHaveCount(0)
				await expect(preview.getByText('This is a preview.', { exact: false })).toHaveCount(0)
				await page.keyboard.press('Escape')
				await expect(preview).not.toBeVisible()
				await expect(trigger).toBeFocused()
				await trigger.click()
				await expect(preview.getByRole('textbox', { name: 'note', exact: true })).toHaveValue(
					'Preview my café 🦊 note.'
				)
				if (!accountId || !id) throw new Error('Missing signed-in reader identity')
				const savedNote = await authority.backend.db.one(
					app.notes.where({ libraryId: accountId, documentId: id, highlightId: null })
				)
				if (!savedNote) throw new Error('Missing preview note')
				await authority.backend.db
					.update(app.notes, savedNote.id, { text: 'Changed on another device.' })
					.wait({ tier: 'global' })
				await expect(preview).not.toBeVisible()
				await expect(note).toHaveValue('Changed on another device.')
				await trigger.click()
				await expect(preview.getByRole('textbox', { name: 'note', exact: true })).toHaveValue(
					'Changed on another device.'
				)
				await preview.getByRole('button', { name: 'Close', exact: true }).click()
				await expect(preview).not.toBeVisible()
				await expect(trigger).toBeFocused()
				// Fail only the preview request: taking the whole account offline can
				// replace its attachment on reconnect, which intentionally dismisses it.
				await page.route('**/api/publication/preview', (route) => route.abort(), { times: 1 })
				await trigger.click()
				await expect(
					preview.getByText(
						'Sharing preview is unavailable. Check your AT Protocol sign-in and saved note, then try again.',
						{ exact: true }
					)
				).toBeVisible()
				await preview.getByRole('button', { name: 'Retry', exact: true }).click()
				await expect(preview.getByRole('textbox', { name: 'note', exact: true })).toHaveValue(
					'Changed on another device.'
				)
				await preview.getByRole('button', { name: 'Close', exact: true }).click()
				await expect(preview).not.toBeVisible()
				checkpoint('authenticated sharing preview verified')
				await page.getByRole('button', { name: 'Preview sharing', exact: true }).click()
				await expect(preview.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
				// A failed submission stays retryable and never claims publication.
				await page.route('**/api/publication/publish', (route) => route.abort(), { times: 1 })
				await preview.getByRole('button', { name: 'Publish', exact: true }).click()
				await expect(
					preview.getByText('Publishing could not be confirmed. Try again.', { exact: true })
				).toBeVisible()
				expect(publicWrites).toBe(0)
				const release = Promise.withResolvers<void>()
				await page.route(
					'**/api/publication/publish',
					async (route) => {
						await release.promise
						await route.continue()
					},
					{ times: 1 }
				)
				const publishedResponse = page.waitForResponse((response) =>
					response.url().endsWith('/api/publication/publish')
				)
				await preview.getByRole('button', { name: 'Publish', exact: true }).click()
				await expect(preview.getByText('Preparing…', { exact: true })).toBeVisible()
				await expect(preview.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
				release.resolve()
				const publicationResponse = await publishedResponse
				expect(publicationResponse.status()).toBe(200)
				const value: unknown = await publicationResponse.json()
				const published = publicationSchema.parse(value)
				if (published.state !== 'published') throw new Error('Expected confirmed publication')
				publishedUri = published.uri
				expect(publicWrites).toBe(1)
				await expect(preview.getByText('Published', { exact: true })).toBeVisible()
				await expect(preview.getByText(published.uri, { exact: true })).toBeVisible()
				await expect(preview.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
				await preview.getByRole('button', { name: 'Close', exact: true }).click()
				await expect(preview).not.toBeVisible()
				await page.getByRole('button', { name: 'Preview sharing', exact: true }).click()
				await expect(preview.getByText('Published', { exact: true })).toBeVisible()
				await expect(preview.getByText(published.uri, { exact: true })).toBeVisible()
				await expect(preview.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
				expect(publicWrites).toBe(1)
				await preview.getByRole('button', { name: 'Unpublish', exact: true }).click()
				await expect(preview.getByText('Unpublished', { exact: true })).toBeVisible()
				await expect(preview.getByText(published.uri, { exact: true })).toHaveCount(0)
				expect(publicRecords.size).toBe(0)
				expect(publicRemovals).toBe(1)
				expect((await authority.backend.db.one(app.notes.where({ id: savedNote.id })))?.text).toBe(
					'Changed on another device.'
				)
				await preview.getByRole('button', { name: 'Publish', exact: true }).click()
				await expect(preview.getByText('Published', { exact: true })).toBeVisible()
				await expect(preview.getByText(published.uri, { exact: true })).toBeVisible()
				expect(publicWrites).toBe(2)
				expect(publicRecords.size).toBe(1)
				await preview.getByRole('button', { name: 'Close', exact: true }).click()
				await expect(preview).not.toBeVisible()
				checkpoint('authenticated publish, unpublish and republish verified')
			}
			await page.getByRole('link', { name: 'Open library', exact: true }).click()

			// A fresh authenticated replica must support opening the saved reader URL
			// without visiting the library or caching its content first.
			const coldBrowser = await chromium.launch({ headless: true })
			try {
				const coldContext = await coldBrowser.newContext()
				await coldContext.addCookies(await context.cookies(origin))
				const coldReader = await coldContext.newPage()
				const readerResponse = await coldReader.goto(origin + '/articles/' + id)
				expect(readerResponse?.status()).toBe(200)

				await expect(coldReader.getByRole('article')).toContainText(
					'Readable native backend capture.',
					{ timeout: 30000 }
				)
			} finally {
				await coldBrowser.close()
			}

			checkpoint('cold authenticated reader verified')
			if (mode === 'expired') {
				const sessions = await authority.backend.db.all(
					app.better_auth_session.where({ userId: user.id })
				)
				for (const stored of sessions)
					await authority.backend.db
						.update(app.better_auth_session, stored.id, { expiresAt: new Date(Date.now() - 60000) })
						.wait({ tier: 'global' })
			}

			await context.close()
			await ui.stop()
			await authority.stop()
			authorityUp = false
			for (let restart = 0; restart < 2; restart++) {
				context = await chromium.launchPersistentContext(profile, { headless: true })
				await context.setOffline(true)
				page = await context.newPage()
				const cdp = await context.newCDPSession(page)
				await cdp.send('Network.enable')
				await cdp.send('Network.clearBrowserCache')
				await cdp.detach()
				await page.goto(origin)
				const saved = page.locator(`[data-article-id="${id}"]`)
				await expect(saved).toBeVisible({ timeout: 30000 })
				await expectSignedInAccount(page)
				await openAccountSettings(page)
				const settingsResponse = await page.reload()
				expect(settingsResponse?.fromServiceWorker()).toBe(true)
				await expectSignedInAccount(page)
				checkpoint('offline account ready ' + restart)
				if (restart === 0) {
					await (
						await openArticleActions(saved)
					)
						.getByRole('button', { name: 'Favorite', exact: true })
						.click()
					await expect(
						(await openArticleActions(saved)).getByRole('button', {
							name: 'Remove favorite',
							exact: true
						})
					).toBeEnabled()
				} else {
					await expect(
						(await openArticleActions(saved)).getByRole('button', {
							name: 'Remove favorite',
							exact: true
						})
					).toBeVisible()
				}
				await page.getByRole('link', { name: 'Native authorized article', exact: true }).click()
				await expect(page.getByRole('article')).toContainText('Readable native backend capture.')
				await readingControls(page)
				if (mode === 'linked') {
					if (restart === 0) {
						await page.getByRole('button', { name: 'Remove note', exact: true }).click()
						await expect(
							page.getByRole('button', { name: 'Remove note', exact: true })
						).toHaveCount(0)
						expect(publicRecords.size).toBe(1)
						expect(publicRemovals).toBe(1)
					} else {
						await expect(
							page.getByRole('button', { name: 'Remove note', exact: true })
						).toHaveCount(0)
					}
				}
				await page.getByRole('link', { name: 'Open library', exact: true }).click()

				checkpoint('offline reader verified ' + restart)
				if (restart === 0) await context.close()
			}
			authority = await start()
			authorityUp = true
			await ui.start()
			await context.setOffline(false)
			await page.reload()
			if (mode === 'expired') {
				await openAccountSettings(page)
				await expect(
					page.getByRole('button', { name: 'Sign in with AT Protocol', exact: true })
				).toBeVisible({ timeout: 30000 })
				await issueSession()
				await page.reload()
			}
			await expectSignedInAccount(page)

			await expect(
				(await openArticleActions(page.locator(`[data-article-id="${id}"]`))).getByRole('button', {
					name: 'Remove favorite',
					exact: true
				})
			).toBeVisible({ timeout: 30000 })
			await expect
				.poll(() =>
					authority.backend.db
						.all(app.organizationOperations.where({ libraryId: accountId }))
						.then((rows) => rows.length)
				)
				.toBeGreaterThan(0)
			checkpoint('reconnected and reconciled')
			if (mode === 'linked') {
				const publications = await authority.backend.db.all(
					app.publications.where({ libraryId: accountId })
				)
				expect(publications).toHaveLength(1)
				await expect
					.poll(
						async () =>
							(await authority.backend.db.all(app.publications.where({ libraryId: accountId })))[0]
								?.lifecycle,
						{ timeout: 15_000 }
					)
					.toEqual({ state: 'unpublished', uri: publishedUri })
				expect(publications).toHaveLength(1)
				expect(publicWrites).toBe(2)
				expect(publicRemovals).toBe(2)
				expect(publicRecords.size).toBe(0)
				checkpoint('offline note deletion removed the retained public record after reconnect')
				await page.getByRole('link', { name: 'Native authorized article', exact: true }).click()
				checkpoint('highlight reader opened')
				const quote = await page
					.getByRole('article')
					.getByRole('paragraph')
					.evaluate((node) => {
						const text = node.firstChild
						if (!(text instanceof Text)) throw new Error('Expected reader paragraph text')
						const range = document.createRange()
						range.selectNodeContents(text)
						const selection = window.getSelection()
						if (!selection) throw new Error('Selection unavailable')
						selection.removeAllRanges()
						selection.addRange(range)
						return range.toString()
					})
				await page.getByRole('button', { name: 'Add highlight', exact: true }).click()
				const highlight = page.getByRole('group', { name: 'highlight', exact: true })
				await expect(highlight.getByRole('blockquote')).toHaveText(quote)
				checkpoint('highlight saved')
				const highlightPreview = page.waitForResponse((response) =>
					response.url().endsWith('/api/publication/preview')
				)
				await highlight.getByRole('button', { name: 'Preview sharing', exact: true }).click()
				expect((await highlightPreview).status()).toBe(200)
				checkpoint('source highlight preview verified')
				const preview = page.getByRole('dialog', { name: 'Preview', exact: true })
				await expect(preview.getByRole('blockquote')).toHaveText(quote)
				await preview.getByRole('button', { name: 'Publish', exact: true }).click()
				await expect(preview.getByText('Published', { exact: true })).toBeVisible()
				const [highlightUri, highlightRecord] = [...publicRecords.entries()][0] ?? []
				expect(highlightUri).toBeDefined()
				expect(highlightRecord).toMatchObject({
					motivation: 'highlighting',
					target: { selector: { type: 'TextQuoteSelector', exact: quote } }
				})
				await preview.getByRole('button', { name: 'Unpublish', exact: true }).click()
				await expect(preview.getByText('Unpublished', { exact: true })).toBeVisible()
				await preview.getByRole('button', { name: 'Close', exact: true }).click()
				await highlight.getByRole('button', { name: 'Add note', exact: true }).click()
				await highlight
					.getByRole('textbox', { name: 'note', exact: true })
					.fill('A public highlight note.')
				await expect(page.getByText('note synced', { exact: true })).toBeVisible()
				await highlight.getByRole('button', { name: 'Preview sharing', exact: true }).click()
				await preview.getByRole('button', { name: 'Publish', exact: true }).click()
				await expect(preview.getByText('Published', { exact: true })).toBeVisible()
				expect(publicRecords.size).toBe(1)
				expect(publicRecords.get(highlightUri ?? '')).toMatchObject({
					motivation: 'commenting',
					body: { format: 'text/plain', value: 'A public highlight note.' },
					target: { selector: { type: 'TextQuoteSelector', exact: quote } }
				})
				await preview.getByRole('button', { name: 'Close', exact: true }).click()
				await highlight.getByRole('button', { name: 'Remove highlight', exact: true }).click()
				await expect(highlight).toHaveCount(0)
				await expect.poll(() => publicRecords.size).toBe(0)
				await expect
					.poll(async () => {
						const rows = await authority.backend.db.all(
							app.publications.where({ libraryId: accountId })
						)
						return rows.find((row) => row.highlightId !== null)?.lifecycle
					})
					.toEqual({ state: 'unpublished', uri: highlightUri })
				expect(publicWrites).toBe(4)
				expect(publicRemovals).toBe(4)
				checkpoint('highlight publish, commentary republish and deletion cleanup verified')
				checkpoint('signing out')
				await test.step('sign out through the real auth handler', async () => {
					const previous = signOutResponses.length
					console.info(
						JSON.stringify({
							mode,
							openPopovers: await page.locator('[popover]:popover-open').count()
						})
					)
					await openAccountSettings(page)
					checkpoint('account navigation ready for sign-out')
					await page
						.getByRole('button', { name: 'Sign out', exact: true })
						.click({ timeout: 10000 })
					await expect.poll(() => signOutResponses.slice(previous)).toEqual([200])
					checkpoint('provider signed out')
				})
				await expect(
					page.getByRole('button', { name: 'Sign in with AT Protocol', exact: true })
				).toBeVisible({ timeout: 30000 })
				await page.getByRole('link', { name: 'All articles', exact: true }).click()
				await expect(page).toHaveURL(origin + '/')
				await expect(page.locator(`[data-article-id="${id}"]`)).toHaveCount(0)
				const signedOutCookies = await context.cookies(origin)
				expect(
					await auth!.api.getSession({
						headers: new Headers({
							cookie: signedOutCookies.map((cookie) => cookie.name + '=' + cookie.value).join('; ')
						})
					})
				).toBeNull()
				await context.close()
				await ui.stop()
				await authority.stop()
				authorityUp = false
				context = await chromium.launchPersistentContext(profile, { headless: true })
				await context.setOffline(true)
				const afterSignOut = await context.newPage()
				await afterSignOut.goto(origin)
				await expect(
					afterSignOut.getByRole('region', { name: 'Saved articles', exact: true })
				).toBeVisible({ timeout: 30000 })
				await expect(afterSignOut.locator(`[data-article-id="${id}"]`)).toHaveCount(0)
				await openAccountSettings(afterSignOut)
				await expect(
					afterSignOut.getByRole('button', { name: 'Sign out', exact: true })
				).toHaveCount(0)
			}
		} finally {
			checkpoint('closing browser')
			await context.close()
			checkpoint('stopping UI server')
			await ui.stop()
			checkpoint('stopping authority')
			if (authorityUp) await authority.stop()
			checkpoint('cleanup settled')
			await rm(directory, { recursive: true, force: true })
		}
	})
