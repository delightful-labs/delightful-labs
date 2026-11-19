/// <reference types="vite/client" />
import './sdk-session.js'
import './image-job.js'
import type { Operation, Reply } from './bindings.worker.js'

type Result = Exclude<Reply, { type: 'READY' }>
const workers = new Map<string, Worker>()
const pending = new Map<
	number,
	{
		resolve: (value: Result) => void
		reject: (error: Error) => void
		timer: ReturnType<typeof setTimeout>
	}
>()
let sequence = 0
function request(name: string, operation: Operation) {
	const worker = workers.get(name)
	if (!worker) throw new Error('Fixture worker missing')
	const id = ++sequence
	return new Promise<Result>((resolve, reject) => {
		const timer = setTimeout(() => {
			pending.delete(id)
			reject(new Error('Fixture command deadline exceeded'))
		}, 5000)
		pending.set(id, { resolve, reject, timer })
		worker.postMessage({ id, operation })
	})
}
const fixture = {
	async create(name: string) {
		if (workers.has(name)) throw new Error('Fixture worker already open')
		const worker = new Worker(new URL('./bindings.worker.ts', import.meta.url), { type: 'module' })
		workers.set(name, worker)
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Fixture worker startup exceeded')), 5000)
			worker.onerror = () => {
				clearTimeout(timer)
				reject(new Error('Fixture worker failed'))
				for (const [id, call] of pending) {
					pending.delete(id)
					clearTimeout(call.timer)
					call.reject(new Error('Fixture worker failed'))
				}
			}
			worker.onmessage = ({ data }: MessageEvent<Reply>) => {
				if (data.type === 'READY') {
					clearTimeout(timer)
					resolve()
					return
				}
				const call = pending.get(data.id)
				if (!call) return
				pending.delete(data.id)
				clearTimeout(call.timer)
				call.resolve(data)
			}
		})
	},
	request
}
declare global {
	interface Window {
		financeBindingFixture: typeof fixture
	}
}
window.financeBindingFixture = fixture
