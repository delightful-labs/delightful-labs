import assert from 'node:assert/strict'
import { schema as s } from 'jazz-tools'
import { deploy, startLocalJazzServer, type LocalJazzServerHandle } from 'jazz-tools/testing'
import { assign, createActor, fromPromise, setup, toPromise } from 'xstate'

type Scenario = 'existence' | 'single-column-inheritance' | 'two-column-inheritance'
type Report =
	| { scenario: Scenario; outcome: 'published' }
	| { scenario: Scenario; outcome: 'rejected' | 'startup-failed' | 'cleanup-failed'; error: string }
type Context = { server: LocalJazzServerHandle | undefined; report: Report | undefined }

const app = s.defineApp({
	organizations: s.table({ name: s.string() }, {}),
	accounts: s.table(
		{ organizationId: s.uuid() },
		{ organization: s.rel('organizations', 'organizationId') }
	),
	grants: s.table(
		{ organizationId: s.uuid(), accountId: s.uuid(), userId: s.uuid() },
		{
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	),
	transactions: s.table(
		{ organizationId: s.uuid(), accountId: s.uuid() },
		{
			organization: s.rel('organizations', 'organizationId'),
			account: s.rel('accounts', 'accountId')
		}
	),
	links: s.table(
		{ transactionId: s.uuid(), fileId: s.uuid() },
		{ transaction: s.rel('transactions', 'transactionId'), file: s.rel('files', 'fileId') }
	),
	files: s.table({ name: s.string() }, {})
})

function permissionsFor(scenario: Scenario) {
	return s.definePermissions(app, ({ policy, session, allowedTo }) => {
		policy.transactions.allowRead.where((transaction) =>
			policy.grants.exists.where({
				accountId: transaction.accountId,
				userId: session.user.account,
				...(scenario === 'single-column-inheritance'
					? {}
					: { organizationId: transaction.organizationId })
			})
		)
		if (scenario === 'existence') {
			policy.links.allowRead.where((link) =>
				policy.transactions.exists.where({ id: link.transactionId })
			)
		} else {
			policy.links.allowRead.where(allowedTo.read('transaction'))
		}
		policy.files.allowRead.where(allowedTo.readReferencing(policy.links, 'file'))
	})
}

function message(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}
function requiredServer(context: Context) {
	assert(context.server, 'Missing owned server')
	return context.server
}

// The finite chart owns start -> publish -> stop, including publication failure cleanup.
function reproduction(scenario: Scenario) {
	const actors = {
		start: fromPromise(() => startLocalJazzServer({ inMemory: true })),
		publish: fromPromise(({ input }: { input: LocalJazzServerHandle }) =>
			deploy({
				appId: input.appId,
				serverUrl: input.url,
				adminSecret: input.adminSecret,
				schema: app,
				permissions: permissionsFor(scenario)
			})
		),
		stop: fromPromise(({ input }: { input: LocalJazzServerHandle }) => input.stop())
	}
	return setup<
		Context,
		{ type: 'unused' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		unknown,
		Report | undefined
	>({ actors }).createMachine({
		id: 'attachment-permission-reproduction',
		context: { server: undefined, report: undefined },
		initial: 'starting',
		output: ({ context }) => context.report,
		states: {
			starting: {
				invoke: {
					src: 'start',
					onDone: {
						target: 'publishing',
						actions: assign({ server: ({ event }) => event.output })
					},
					onError: {
						target: 'finished',
						actions: assign({
							report: ({ event }): Report => ({
								scenario,
								outcome: 'startup-failed',
								error: message(event.error)
							})
						})
					}
				}
			},
			publishing: {
				invoke: {
					src: 'publish',
					input: ({ context }) => requiredServer(context),
					onDone: {
						target: 'stopping',
						actions: assign({ report: (): Report => ({ scenario, outcome: 'published' }) })
					},
					onError: {
						target: 'stopping',
						actions: assign({
							report: ({ event }): Report => ({
								scenario,
								outcome: 'rejected',
								error: message(event.error)
							})
						})
					}
				}
			},
			stopping: {
				invoke: {
					src: 'stop',
					input: ({ context }) => requiredServer(context),
					onDone: 'finished',
					onError: {
						target: 'finished',
						actions: assign({
							report: ({ event }): Report => ({
								scenario,
								outcome: 'cleanup-failed',
								error: message(event.error)
							})
						})
					}
				}
			},
			finished: { type: 'final' }
		}
	})
}

const scenarios: Scenario[] = ['existence', 'single-column-inheritance', 'two-column-inheritance']
const results: Report[] = []
for (const scenario of scenarios) {
	const result = await toPromise(createActor(reproduction(scenario)).start())
	assert(result, 'Missing reproduction result')
	results.push(result)
}
console.log(JSON.stringify(results, null, 2))
assert.equal(results[0]?.outcome, 'published')
assert.equal(results[1]?.outcome, 'published')
const rejected = results[2]
assert(rejected?.outcome === 'rejected', 'Expected alpha.59 publication rejection')
assert.match(rejected.error, /UnknownColumn/)
assert.match(rejected.error, /accountId|organizationId/)
