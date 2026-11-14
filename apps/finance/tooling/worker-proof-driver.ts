/** Build-only export. No page, layout or application startup imports this driver. */
export function openWorkerImportProof() {
	return new Worker(new URL('../src/lib/runtime/worker/application.worker.ts', import.meta.url), {
		type: 'module'
	})
}
