import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadWasmModule } from '../../../node_modules/jazz-tools/dist/runtime/wasm-loader.js'
import { NativeRuntimeAdapter } from '../../../node_modules/jazz-tools/dist/runtime/native-runtime/native-runtime-adapter.js'

const appId = 'credential-recovery-regression'
const seed = Buffer.alloc(32, 17).toString('base64url')
const payloadSchema = z.object({ sub: z.string(), exp: z.number() })

async function fixture() {
	const wasm = await loadWasmModule()
	const token = wasm.mintLocalFirstToken(seed, appId, 1, BigInt(Math.floor(Date.now() / 1000)))
	const payload = payloadSchema.parse(
		JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString())
	)
	const claimedAuthor = JSON.stringify(['urn:jazz:local-first', payload.sub])
	const proof = { token, appId, claimedAuthor }
	const author = new TextEncoder().encode(claimedAuthor)
	const runtime = new NativeRuntimeAdapter(wasm.WasmDb, {}, new Uint8Array(16), author, 1, false, {
		selfSignedClientProof: proof
	})
	return { runtime, wasm, proof, author, expires: payload.exp }
}

describe('retained Jazz worker credential admission', () => {
	it('accepts a fresh same-identity proof after the opening proof expires', async () => {
		const { runtime, wasm, proof, author, expires } = await fixture()
		try {
			await new Promise((resolve) =>
				setTimeout(resolve, Math.max(0, expires * 1000 - Date.now()) + 100)
			)
			await expect(runtime.acceptPeer({}, undefined, author)).rejects.toThrow(/expired/)
			const fresh = {
				...proof,
				token: wasm.mintLocalFirstToken(seed, appId, 60, BigInt(Math.floor(Date.now() / 1000)))
			}
			const peer = await runtime.acceptPeer({}, undefined, author, fresh)
			expect(peer).toBeDefined()
			peer.close()
		} finally {
			await runtime.close()
		}
	})
	it.each(['application', 'author', 'signature'])(
		'rejects a mismatched %s without bypassing native verification',
		async (kind) => {
			const { runtime, proof, author } = await fixture()
			try {
				const candidate = {
					...proof,
					appId: kind === 'application' ? 'another-application' : proof.appId,
					claimedAuthor:
						kind === 'author'
							? JSON.stringify(['urn:jazz:local-first', 'other'])
							: proof.claimedAuthor,
					token: kind === 'signature' ? `${proof.token.slice(0, -8)}AAAAAAAA` : proof.token
				}
				await expect(runtime.acceptPeer({}, undefined, author, candidate)).rejects.toBeDefined()
			} finally {
				await runtime.close()
			}
		}
	)
})
