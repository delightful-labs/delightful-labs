import { spawnSync } from 'node:child_process'
const run = (args) => spawnSync('git', args, { encoding: 'utf8', timeout: 5000 })
const sha = (text) => /^[a-f0-9]{40,64}$/u.test(text.trim()) ? text.trim() : 'unavailable'
try {
  const head = run(['rev-parse', '--verify', 'HEAD'])
  console.info('PROBE checkout', JSON.stringify({ actual: sha(head.stdout ?? ''), provided: sha(process.env.VERCEL_GIT_COMMIT_SHA ?? ''), environment: process.env.VERCEL_ENV, hasPrevious: Boolean(process.env.VERCEL_GIT_PREVIOUS_SHA) }))
  const refs = run(['for-each-ref', '--format=%(refname) %(objectname)'])
  console.info('PROBE refs', refs.stdout)
  const url = run(['config', '--get', 'remote.origin.url']).stdout?.trim() ?? ''
  let origin = { present: Boolean(url), protocol: 'unknown' }
  try { const parsed = new URL(url); origin = { present: true, protocol: parsed.protocol, hostname: parsed.hostname, hasCredentials: Boolean(parsed.username || parsed.password) } } catch {}
  console.info('PROBE origin', JSON.stringify(origin))
  const fetched = run(['fetch', '--no-tags', '--depth=1', 'origin', 'refs/heads/main'])
  const stderr = fetched.stderr ?? ''
  const patterns = { authentication: /authentication|username|could not read from remote|terminal prompts|publickey/iu, permission: /permission denied|read.only|operation not permitted/iu, absentRemote: /no such remote|does not appear to be a git repository/iu, absentMain: /couldn.t find remote ref/iu, network: /resolve host|unable to access|connect|timed out/iu, shallow: /shallow/iu, missingPath: /no such file or directory/iu }
  console.info('PROBE fetch', JSON.stringify({ status: fetched.status, signal: fetched.signal, categories: Object.entries(patterns).filter(([, pattern]) => pattern.test(stderr)).map(([name]) => name), stderrBytes: stderr.length }))
  const main = run(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])
  console.info('PROBE fetched', JSON.stringify({ status: main.status, sha: sha(main.stdout ?? '') }))
} catch {
  console.info('PROBE diagnostic failed')
} finally {
  console.info('PROBE stopping before install; exit 0')
  process.exitCode = 0
}
