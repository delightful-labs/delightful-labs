/** Keep Jazz's account registry in one module instance. Split worker chunks can
 * import their entry again, which affected WebKit builds evaluate a second time. */
export function jazzWorkerOptions(assetFileNames?: string): {
	format: 'es'
	rolldownOptions: { output: { codeSplitting: false; assetFileNames?: string } }
} {
	return {
		format: 'es',
		rolldownOptions: {
			output: {
				codeSplitting: false,
				...(assetFileNames === undefined ? {} : { assetFileNames })
			}
		}
	}
}
