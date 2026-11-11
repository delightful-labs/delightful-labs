// Public ESM import works without SvelteKit environment modules or browser globals.
import { createLogger } from 'delightful-local-first/diagnostics/logger'

/** @type {string[]} */
const messages = []
/** @type {import('delightful-local-first/diagnostics/logger').LogSink} */
const sink = {
	info: (message) => messages.push(message),
	warn: (message) => messages.push(message),
	error: (message) => messages.push(message)
}
const enabled = createLogger('consumer', { enabled: true, sink })
const disabled = createLogger('quiet', { enabled: false, sink })
enabled.info('started')
disabled.error('hidden')
if (messages.length !== 1 || messages[0] !== '[consumer] started') {
	throw new Error('Packaged logger did not preserve scoped opt-in output')
}
