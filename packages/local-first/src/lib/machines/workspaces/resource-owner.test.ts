import { afterEach, describe, expect, it } from 'vitest'
import {
	createActor,
	createCallbackLogic,
	setup,
	types,
	type SnapshotFrom,
	type EventFromLogic,
	type ActorRefFrom
} from 'xstate'
import * as fc from 'fast-check'
import type {
	WorkspaceLease,
	WorkspaceSelectionObservation,
	WorkspaceSelectionRequest
} from '../../contracts/workspace-selection.js'
import { createWorkspaceResourceOwner } from './resource-owner.js'
import { createWorkspaceSelectionMachine } from './selection.js'

const actors = new Set<{ stop(): void }>()
afterEach(() => {
	for (const actor of actors) actor.stop()
	actors.clear()
})
function fixture(onAcquire?: () => void, failSelectorOnReplacement = false) {
	type Input = { lease: WorkspaceLease; native: string }
	type Result = { clean: boolean } | undefined
	const acquired: WorkspaceLease[] = [],
		shutdown: WorkspaceLease[] = [],
		disposed: WorkspaceLease[] = []
	const work: { lease: WorkspaceLease; value: number }[] = []
	const refused: string[] = []
	const native = createCallbackLogic<never, Input>(({ input }) => () => {
		disposed.push(input.lease)
	})
	const resource = setup({
		schemas: {
			input: types<Input>(),
			context: types<Input & { version: number; result: Result }>(),
			output: types<Result>(),
			events: {
				SHUTDOWN: types(),
				WORK: types<{ value: number }>(),
				OWNED: types<{ release: () => void }>(),
				RELEASE: types<{ receipt: 'released' | 'unresolved' | 'missing' }>(),
				FAIL: types(),
				CRASH: types()
			}
		},
		actors: { native }
	}).createMachine({
		initial: 'working',
		context: ({ input }) => ({ ...input, version: 0, result: undefined }),
		output: ({ context }) => context.result,
		entry: ({ context, self }, enq) =>
			enq(() => {
				acquired.push(context.lease)
				resources.set(context.lease, self)
				onAcquire?.()
			}),
		invoke: { src: 'native', input: ({ context }) => context },
		on: {
			OWNED: ({ event }, enq) => enq(event.release),
			WORK: ({ context, event }, enq) => {
				enq(() => work.push({ lease: context.lease, value: event.value }))
				return { context: { version: event.value } }
			},
			RELEASE: ({ event }) => ({
				target: '.closed',
				context: {
					result: event.receipt === 'missing' ? undefined : { clean: event.receipt === 'released' }
				}
			})
		},
		states: {
			working: {
				on: {
					SHUTDOWN: ({ context }, enq) => {
						enq(() => shutdown.push(context.lease))
						return { target: 'draining' }
					},
					FAIL: { target: 'failed' },
					CRASH: (_, enq) =>
						enq(() => {
							throw new Error('Resource crashed')
						})
				}
			},
			draining: { on: { SHUTDOWN: ({ context }, enq) => enq(() => shutdown.push(context.lease)) } },
			failed: { on: { SHUTDOWN: ({ context }, enq) => enq(() => shutdown.push(context.lease)) } },
			closed: { type: 'final' }
		}
	})
	const resources = new Map<WorkspaceLease, Pick<ActorRefFrom<typeof resource>, 'send'>>()
	const owner = createWorkspaceResourceOwner<
		{ native: string },
		Input,
		EventFromLogic<typeof resource>,
		SnapshotFrom<typeof resource>,
		{ version: number; native: string }
	>({
		resource,
		input: (lease, binding: { native: string }) => ({ lease, native: binding.native }),
		shutdown: { type: 'SHUTDOWN' },
		view: (snapshot) => ({ version: snapshot.context.version, native: snapshot.context.native }),
		failed: (snapshot) => snapshot.matches('failed'),
		settlement: (output) => (output?.clean === true ? 'released' : 'unresolved'),
		refused: (command) => {
			refused.push(command.type)
			if (command.type === 'OWNED') command.release()
		}
	})
	const scope = { binding: {}, attachment: {} }
	const ownerLogic = failSelectorOnReplacement
		? owner.logic.provide({
				actors: {
					selection: createWorkspaceSelectionMachine().provide({
						guards: {
							freshSelection: () => {
								if (acquired.length) throw new Error('Selector failed')
								return true
							}
						}
					})
				}
			})
		: owner.logic
	const actor = createActor(ownerLogic, { input: { scope, binding: { native: 'bound native' } } })
	actors.add(actor)
	let request: WorkspaceSelectionRequest = { workspaceId: 'A', attempt: 0 }
	function select(workspaceId = 'A') {
		request = { workspaceId, attempt: request.attempt + 1 }
		actor.send({ type: 'SELECT', scope, request })
		return request
	}
	function observation(
		access: WorkspaceSelectionObservation['access'] = 'allowed',
		generation = 0
	): WorkspaceSelectionObservation {
		return { scope, request, generation, access, directory: { status: 'available', entries: [] } }
	}
	function observe(access: WorkspaceSelectionObservation['access'] = 'allowed', generation = 0) {
		actor.send({ type: 'OBSERVED', observation: observation(access, generation) })
	}
	function latest() {
		const value = acquired.at(-1)
		if (!value) throw new Error('Missing acquired resource')
		return value
	}
	function child(lease = latest()) {
		const value = resources.get(lease)
		if (!value) throw new Error('Missing resource')
		return value
	}
	function release(receipt: 'released' | 'unresolved' | 'missing' = 'released', lease = latest()) {
		child(lease).send({ type: 'RELEASE', receipt })
	}
	function command(value: number, lease = latest()) {
		actor.send({ type: 'RESOURCE_COMMAND', lease, command: { type: 'WORK', value } })
	}
	const report = () => owner.selectReport(actor.getSnapshot())
	actor.start()
	return {
		actor,
		owner,
		scope,
		select,
		observe,
		observation,
		report,
		acquired,
		shutdown,
		disposed,
		work,
		refused,
		latest,
		child,
		release,
		command,
		activate: (workspaceId = 'A') => {
			select(workspaceId)
			observe()
		}
	}
}

describe('shared workspace resource custody', () => {
	it('closes without allocating a resource when shutdown precedes selection', () => {
		const f = fixture()
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.acquired).toEqual([])
		expect(f.report().status).toBe('closed')
		expect(f.actor.getSnapshot().output).toEqual({ outcome: 'closed' })
	})
	it('waits for target evidence and permits local access absent from the directory', () => {
		const f = fixture()
		f.select()
		f.observe('unknown')
		expect(f.acquired).toEqual([])
		f.observe('denied', 1)
		expect(f.acquired).toEqual([])
		f.observe('allowed', 2)
		expect(f.acquired).toHaveLength(1)
		expect(f.report()).toMatchObject({ status: 'active', view: { native: 'bound native' } })
	})
	it('retains one lease across current access updates and rejects foreign commands', () => {
		const f = fixture()
		f.activate()
		const lease = f.latest()
		f.observe('allowed', 1)
		f.command(7)
		f.command(90, { ...lease, epoch: lease.epoch + 1 })
		f.command(91, { ...lease, scope: { ...lease.scope, attachment: {} } })
		f.command(92, { ...lease, request: { ...lease.request, attempt: lease.request.attempt + 1 } })
		f.command(93, { ...lease, request: { ...lease.request, workspaceId: 'foreign' } })
		expect(f.acquired).toHaveLength(1)
		expect(f.work).toEqual([{ lease, value: 7 }])
		expect(f.report()).toMatchObject({ status: 'active', view: { version: 7 } })
	})
	it('drains once and admits only the latest request after real release', () => {
		const f = fixture()
		f.activate()
		const a = f.latest()
		f.select('B')
		f.observe()
		f.select('C')
		const c = f.observation()
		f.observe()
		f.command(8, a)
		expect(f.report().status).toBe('draining')
		expect(f.acquired).toEqual([a])
		expect(f.shutdown).toEqual([a])
		expect(f.work).toEqual([])
		f.release('released', a)
		expect(f.acquired.map((x) => x.request.workspaceId)).toEqual(['A', 'C'])
		expect(f.disposed).toEqual([a])
		expect(f.report().status).toBe('active')
		f.actor.send({
			type: 'OBSERVED',
			observation: {
				...c,
				generation: 0,
				request: { workspaceId: 'B', attempt: c.request.attempt - 1 }
			}
		})
		expect(f.acquired).toHaveLength(2)
	})
	it('rejects old A after A → B → A without reviving its command capability', () => {
		const f = fixture()
		f.activate()
		const old = f.latest()
		f.select('B')
		f.observe()
		f.release()
		f.select('A')
		f.observe()
		f.release()
		const current = f.latest()
		f.command(10, old)
		f.command(11, current)
		expect(current.epoch).toBeGreaterThan(old.epoch)
		expect(f.work).toEqual([{ lease: current, value: 11 }])
	})
	it('gives shutdown priority over replacement while retaining the original resource', () => {
		const f = fixture()
		f.activate()
		const a = f.latest()
		f.select('B')
		f.observe()
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'SHUTDOWN' })
		f.select('C')
		f.observe()
		f.release('released', a)
		expect(f.acquired).toEqual([a])
		expect(f.shutdown).toEqual([a])
		expect(f.report().status).toBe('closed')
	})
	it.each(['unresolved', 'missing'])(
		'retains an %s terminal receipt without replacement or clean close',
		(receipt) => {
			const f = fixture()
			f.activate()
			const a = f.latest()
			f.select('B')
			f.observe()
			f.release(receipt === 'missing' ? 'missing' : 'unresolved')
			f.actor.send({ type: 'SHUTDOWN' })
			f.select('C')
			f.observe()
			expect(f.report()).toMatchObject({
				status: 'unresolved',
				lease: a,
				completion: { settlement: 'unresolved' }
			})
			expect(f.acquired).toEqual([a])
			expect(f.actor.getSnapshot().output).toBeUndefined()
		}
	)
	it('retains an active failed resource rather than stopping its descendants or waiting for a dead receipt', () => {
		const f = fixture()
		f.activate()
		const a = f.latest()
		f.child().send({ type: 'FAIL' })
		f.command(99, a)
		f.actor.send({ type: 'SHUTDOWN' })
		f.select('B')
		f.observe()
		expect(f.report()).toMatchObject({ status: 'unresolved', lease: a })
		expect(f.work).toEqual([])
		expect(f.disposed).toEqual([])
		expect(f.shutdown).toEqual([])
		expect(f.acquired).toEqual([a])
		f.release()
		expect(f.report().status).toBe('unresolved')
		expect(f.actor.getSnapshot().output).toBeUndefined()
	})
	it('refuses replacement and clean close after a resource crash', () => {
		const f = fixture()
		f.activate()
		const a = f.latest()
		f.child().send({ type: 'CRASH' })
		f.select('B')
		f.observe()
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.report().status).toBe('unresolved')
		expect(f.acquired).toEqual([a])
		expect(f.actor.getSnapshot().output).toBeUndefined()
	})
	it('requires explicit retry after unsolicited clean completion', () => {
		const f = fixture()
		f.activate()
		f.release()
		expect(f.report()).toMatchObject({ status: 'waiting', selection: { status: 'drainFailed' } })
		f.select('B')
		f.observe()
		expect(f.acquired).toHaveLength(1)
		f.actor.send({ type: 'RETRY', observation: f.observation('allowed', 1) })
		expect(f.acquired).toHaveLength(2)
	})
	it('drains a resource if shutdown is requested during its acquisition effect', () => {
		let close = () => {}
		const f = fixture(() => close())
		close = () => f.actor.send({ type: 'SHUTDOWN' })
		f.activate()
		expect(f.acquired).toHaveLength(1)
		expect(f.shutdown).toHaveLength(1)
		f.release()
		expect(f.report().status).toBe('closed')
	})

	it('withdraws a revoked lease and reopens only after release and fresh local evidence', () => {
		const f = fixture()
		f.activate()
		const old = f.latest()
		f.observe('unknown', 1)
		f.observe('denied', 2)
		expect(f.shutdown).toEqual([old])
		expect(f.acquired).toEqual([old])
		f.command(9, old)
		f.release()
		expect(f.report()).toMatchObject({ status: 'waiting', selection: { status: 'denied' } })
		f.observe('allowed', 3)
		expect(f.acquired).toHaveLength(2)
		f.command(10, old)
		expect(f.work).toEqual([])
		expect(f.latest().epoch).toBeGreaterThan(old.epoch)
	})
	it('retains the invoked resource after the real selector crashes', () => {
		const f = fixture(undefined, true)
		f.activate()
		const original = f.latest()
		f.select('B')
		expect(f.report()).toMatchObject({
			status: 'unresolved',
			lease: original,
			failure: { reason: 'selectorFailed' }
		})
		expect(f.disposed).toEqual([])
		expect(f.acquired).toEqual([original])
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.disposed).toEqual([])
		expect(f.actor.getSnapshot().output).toBeUndefined()
	})
	it('fails custody after unsolicited selector closure without dropping an issued resource early', () => {
		const f = fixture()
		f.activate()
		const original = f.latest()
		f.actor.getSnapshot().children.selection?.send({ type: 'SHUTDOWN' })
		expect(f.shutdown).toEqual([original])
		expect(f.disposed).toEqual([])
		f.release()
		expect(f.report().status).toBe('unresolved')
		expect(f.acquired).toEqual([original])
	})
	it('does not interpret forced owner stop as a clean receipt', () => {
		const f = fixture()
		f.activate()
		f.actor.stop()
		expect(f.report().status).toBe('unresolved')
		expect(f.actor.getSnapshot().output).toBeUndefined()
	})

	it('preserves shutdown through a parent burst of target and access messages', () => {
		const f = fixture()
		f.actor.stop()
		const scope = { binding: {}, attachment: {} },
			request = { workspaceId: 'A', attempt: 1 }
		const closed: { outcome: 'closed' }[] = []
		const parent = setup({ actors: { owner: f.owner.logic } }).createMachine({
			invoke: {
				id: 'owner',
				src: 'owner',
				input: { scope, binding: { native: 'parent native' } },
				onDone: ({ event }, enq) => enq(() => closed.push(event.output))
			},
			entry: (_, enq) => {
				enq.sendTo('owner', { type: 'SELECT', scope, request })
				enq.sendTo('owner', {
					type: 'OBSERVED',
					observation: {
						scope,
						request,
						generation: 0,
						access: 'allowed',
						directory: { status: 'available', entries: [] }
					}
				})
				enq.sendTo('owner', { type: 'SHUTDOWN' })
			}
		})
		const actor = createActor(parent).start()
		actors.add(actor)
		expect(f.acquired.length).toBeLessThanOrEqual(1)
		expect(f.shutdown).toEqual(f.acquired)
		if (f.acquired.length) f.release()
		expect(closed).toEqual([{ outcome: 'closed' }])
	})

	it.each(['selection', 'access'])(
		'rejects an old command queued by a parent immediately after %s invalidation',
		(mode) => {
			const f = fixture()
			f.actor.stop()
			const scope = { binding: {}, attachment: {} },
				a = { workspaceId: 'A', attempt: 1 },
				b = { workspaceId: 'B', attempt: 2 }
			const parent = setup({
				schemas: { events: { BURST: types<{ lease: WorkspaceLease }>() } },
				actors: { owner: f.owner.logic }
			}).createMachine({
				invoke: {
					id: 'owner',
					src: 'owner',
					input: { scope, binding: { native: 'burst native' } }
				},
				on: {
					BURST: ({ event }, enq) => {
						if (mode === 'selection') {
							enq.sendTo('owner', { type: 'SELECT', scope, request: b })
							enq.sendTo('owner', {
								type: 'OBSERVED',
								observation: {
									scope,
									request: b,
									generation: 0,
									access: 'allowed',
									directory: { status: 'available', entries: [] }
								}
							})
						} else
							enq.sendTo('owner', {
								type: 'OBSERVED',
								observation: {
									scope,
									request: a,
									generation: 1,
									access: 'denied',
									directory: { status: 'available', entries: [] }
								}
							})
						enq.sendTo('owner', {
							type: 'RESOURCE_COMMAND',
							lease: event.lease,
							command: { type: 'WORK', value: 77 }
						})
					}
				}
			})
			const actor = createActor(parent).start()
			actors.add(actor)
			const owner = actor.getSnapshot().children.owner
			if (!owner) throw new Error('Missing owner')
			owner.send({ type: 'SELECT', scope, request: a })
			owner.send({
				type: 'OBSERVED',
				observation: {
					scope,
					request: a,
					generation: 0,
					access: 'allowed',
					directory: { status: 'available', entries: [] }
				}
			})
			const lease = f.latest()
			actor.send({ type: 'BURST', lease })
			expect(f.work).toEqual([])
			expect(f.shutdown).toEqual([lease])
			expect(f.acquired).toEqual([lease])
		}
	)

	it('preserves close intent when unsolicited resource completion and host close are queued together', () => {
		const f = fixture()
		f.actor.stop()
		const scope = { binding: {}, attachment: {} },
			request = { workspaceId: 'A', attempt: 1 },
			closed: { outcome: 'closed' }[] = []
		const parent = setup({
			schemas: { events: { CLOSE: types() } },
			actors: { owner: f.owner.logic }
		}).createMachine({
			invoke: {
				id: 'owner',
				src: 'owner',
				input: { scope, binding: { native: 'close native' } },
				onDone: ({ event }, enq) => enq(() => closed.push(event.output))
			},
			on: {
				CLOSE: (_, enq) => {
					enq.sendTo(f.child(), { type: 'RELEASE', receipt: 'released' })
					enq.sendTo('owner', { type: 'SHUTDOWN' })
				}
			}
		})
		const actor = createActor(parent).start()
		actors.add(actor)
		const owner = actor.getSnapshot().children.owner
		if (!owner) throw new Error('Missing owner')
		owner.send({ type: 'SELECT', scope, request })
		owner.send({
			type: 'OBSERVED',
			observation: {
				scope,
				request,
				generation: 0,
				access: 'allowed',
				directory: { status: 'available', entries: [] }
			}
		})
		actor.send({ type: 'CLOSE' })
		expect(f.acquired).toHaveLength(1)
		expect(f.disposed).toEqual(f.acquired)
		expect(closed).toEqual([{ outcome: 'closed' }])
	})

	it('releases an owned command exactly once when waiting, invalidated, closing or unresolved', () => {
		const active = fixture()
		active.activate()
		let acceptedRelease = 0
		active.actor.send({
			type: 'RESOURCE_COMMAND',
			lease: active.latest(),
			command: {
				type: 'OWNED',
				release: () => {
					acceptedRelease += 1
				}
			}
		})
		expect(acceptedRelease).toBe(1)
		expect(active.refused).toEqual([])
		active.actor.stop()
		for (const phase of ['waiting', 'invalidated', 'closing', 'unresolved']) {
			const f = fixture()
			let releases = 0
			let lease: WorkspaceLease = {
				scope: f.scope,
				request: { workspaceId: 'A', attempt: 1 },
				epoch: 1
			}
			if (phase !== 'waiting') {
				f.activate()
				lease = f.latest()
				if (phase === 'invalidated') {
					f.select('B')
					f.observe()
				}
				if (phase === 'closing') f.actor.send({ type: 'SHUTDOWN' })
				if (phase === 'unresolved') f.child().send({ type: 'FAIL' })
			}
			f.actor.send({
				type: 'RESOURCE_COMMAND',
				lease,
				command: {
					type: 'OWNED',
					release: () => {
						releases += 1
					}
				}
			})
			expect(releases).toBe(1)
			expect(f.refused).toEqual(['OWNED'])
			f.actor.stop()
		}
	})
	it('holds every generated pending request schedule behind the original receipt', () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 0, max: 2 }), { minLength: 1, maxLength: 20 }),
				(requests) => {
					const f = fixture()
					f.activate()
					const original = f.latest()
					for (const request of requests) {
						f.select(['A', 'B', 'C'][request] ?? 'A')
						f.observe()
						expect(f.acquired).toEqual([original])
						expect(f.shutdown).toEqual([original])
					}
					f.release()
					expect(f.acquired).toHaveLength(2)
					expect(f.latest().request.workspaceId).toBe(['A', 'B', 'C'][requests.at(-1) ?? 0])
					f.actor.stop()
				}
			),
			{ seed: 20261124, numRuns: 100 }
		)
	})
})
