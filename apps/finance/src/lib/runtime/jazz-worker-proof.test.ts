import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadWasmModule } from '../../../node_modules/jazz-tools/dist/runtime/wasm-loader.js'
import { NativeRuntimeAdapter } from '../../../node_modules/jazz-tools/dist/runtime/native-runtime/native-runtime-adapter.js'

const appId = 'credential-recovery-regression'
const seed = Buffer.alloc(32, 17).toString('base64url')
const payloadSchema = z.object({ sub: z.string(), exp: z.number() })

async function fixture(
	lifetimeSeconds = 60,
	change: (proof: { token: string; appId: string; claimedAuthor: string }) => {
		token: string
		appId: string
		claimedAuthor: string
	} = (proof) => proof
) {
	const wasm = await loadWasmModule()
	const token = wasm.mintLocalFirstToken(
		seed,
		appId,
		lifetimeSeconds,
		BigInt(Math.floor(Date.now() / 1000))
	)
	const payload = payloadSchema.parse(
		JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
	)
	const claimedAuthor = JSON.stringify(['urn:jazz:local-first', payload.sub])
	const proof = { token, appId, claimedAuthor }
	const author = new TextEncoder().encode(claimedAuthor)
	const runtime = new NativeRuntimeAdapter(wasm.WasmDb, {}, new Uint8Array(16), author, 1, false, {
		selfSignedClientProof: change(proof)
	})
	return { runtime, proof, author, expires: payload.exp }
}

describe('native Jazz credential admission', () => {
	it('rejects an expired opening proof and admits the same identity after reopening with a fresh proof', async () => {
		// JWT seconds are rounded down. A one-second token can expire during
		// construction near a clock boundary, before this expiry scenario begins.
		const { runtime, proof, author, expires } = await fixture(3)
		try {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.max(0, expires * 1000 - Date.now()) + 100)
			)
			await expect(runtime.acceptPeer({}, undefined, author)).rejects.toThrow(/expired/)
			const fresh = await fixture()
			try {
				const peer = await fresh.runtime.acceptPeer({}, undefined, fresh.author)
				expect(peer).toBeDefined()
				expect(fresh.proof.claimedAuthor).toBe(proof.claimedAuthor)
				peer.close()
			} finally {
				await fresh.runtime.close()
			}
		} finally {
			await runtime.close()
		}
	})
	it.each(['application', 'author', 'signature'])(
		'rejects a mismatched %s without bypassing native verification',
		async (kind) => {
			await expect(
				fixture(60, (proof) => ({
					...proof,
					appId: kind === 'application' ? 'another-application' : proof.appId,
					claimedAuthor:
						kind === 'author'
							? JSON.stringify(['urn:jazz:local-first', 'other'])
							: proof.claimedAuthor,
					token: kind === 'signature' ? `${proof.token.slice(0, -8)}AAAAAAAA` : proof.token
				}))
			).rejects.toBeDefined()
		}
	)
})
