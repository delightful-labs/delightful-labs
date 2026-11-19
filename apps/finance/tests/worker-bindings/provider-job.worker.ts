/// <reference lib="webworker" />
import { qualifyProviderJob } from './provider-job.js'
self.onmessage = async ({ data }: MessageEvent<Parameters<typeof qualifyProviderJob>[0]>) => {
	try {
		self.postMessage({
			...(await qualifyProviderJob(data)),
			windowPresent: typeof window !== 'undefined'
		})
	} catch {
		self.postMessage({ kind: 'fixture-failed' })
	}
}
