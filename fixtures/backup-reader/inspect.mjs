import { createActor, toPromise } from 'xstate'
import { prepareArchiveInspection } from 'delightful-local-first/backup/inspection'
import { createArchiveInspectionMachine } from 'delightful-local-first/backup/inspection/workflow'
import { fileSource, stdinPassword } from './io.mjs'

const args = process.argv.slice(2)
const path = args[0]
const valid =
	path &&
	!path.startsWith('--') &&
	(args.length === 1 || (args.length === 2 && args[1] === '--password-stdin'))
process.stdout.on('error', () => {
	process.exitCode = 1
})
if (!valid) {
	process.stdout.write(
		JSON.stringify({
			outcome: 'failed',
			code: 'usage',
			command: 'pnpm backup:inspect <file> [--password-stdin]'
		}) + '\n'
	)
	process.exitCode = args.length === 1 && path === '--help' ? 0 : 1
} else {
	const request = prepareArchiveInspection({
		source: fileSource(path),
		...(args[1] === '--password-stdin' ? { password: stdinPassword() } : {})
	})
	const actor = createActor(createArchiveInspectionMachine(), { input: { request } })
	const cancel = () => actor.send({ type: 'CANCEL' })
	const close = () => actor.send({ type: 'SHUTDOWN' })
	process.once('SIGINT', cancel)
	process.once('SIGTERM', close)
	try {
		actor.start()
		const result = await toPromise(actor)
		if ('report' in result) {
			try {
				process.stdout.write(
					JSON.stringify({ outcome: result.outcome, summary: result.report.readSummary() }) + '\n'
				)
			} finally {
				result.report.release()
			}
			process.exitCode = result.outcome === 'profileInvalid' ? 1 : 0
		} else {
			process.stdout.write(JSON.stringify(result) + '\n')
			process.exitCode = result.outcome === 'passwordRequired' ? 2 : 1
		}
	} catch {
		process.stdout.write(JSON.stringify({ outcome: 'failed', code: 'inspectionFailed' }) + '\n')
		process.exitCode = 1
	} finally {
		request.release()
		actor.stop()
		process.removeListener('SIGINT', cancel)
		process.removeListener('SIGTERM', close)
	}
}
