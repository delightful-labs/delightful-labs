import type { qualifyProviderJob } from './provider-job.js'
async function qualifyInWorker(mode: Parameters<typeof qualifyProviderJob>[0]) {
	const worker = new Worker(new URL('./provider-job.worker.ts', import.meta.url), {
		type: 'module'
	})
	try {
		return await new Promise<
			Awaited<ReturnType<typeof qualifyProviderJob>> & { windowPresent: boolean }
		>((resolve, reject) => {
			worker.onerror = () => reject(new Error('Provider fixture worker failed'))
			worker.onmessage = ({ data }) => resolve(data)
			worker.postMessage(mode)
		})
	} finally {
		worker.terminate()
	}
}
declare global {
	interface Window {
		qualifyProviderJob: typeof qualifyInWorker
	}
}
window.qualifyProviderJob = qualifyInWorker
