import { createActor, toPromise, waitFor } from 'xstate'
import { expect, it } from 'vitest'
import { signOutMachine, signOutInput } from './sign-out.js'
import { nativeSessionFixture, readyAccount } from './session.test-support.js'

async function fixture(signOut: () => Promise<void>) {
	const observation = readyAccount()
	const native = nativeSessionFixture(observation)
	native.owner.start()
	await waitFor(native.owner, (s) => s.context.observation?.status === 'ready')
	return {
		native,
		actor: createActor(signOutMachine, {
			input: signOutInput({ ...native.input, signOut }, observation, 1)
		})
	}
}
it('waits for provider cookie clearance before native Jazz logout', async () => {
	const cleared = Promise.withResolvers<void>()
	const f = await fixture(() => cleared.promise)
	try {
		const done = toPromise(f.actor.start())
		expect(f.native.change).not.toHaveBeenCalled()
		cleared.resolve()
		expect(await done).toEqual({ outcome: 'completed' })
		expect(f.native.change).toHaveBeenCalledOnce()
	} finally {
		cleared.resolve()
		f.actor.stop()
		f.native.owner.stop()
	}
})
it('does not log Jazz out after a provider sign-out failure', async () => {
	const f = await fixture(async () => {
		throw new Error('Provider unavailable')
	})
	try {
		expect(await toPromise(f.actor.start())).toEqual({ outcome: 'failed', stage: 'provider' })
		expect(f.native.change).not.toHaveBeenCalled()
	} finally {
		f.actor.stop()
		f.native.owner.stop()
	}
})
