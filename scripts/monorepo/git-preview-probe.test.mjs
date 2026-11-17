import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
try {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./vercel-ignore.mjs', import.meta.url))], { stdio: 'inherit' })
  console.info('PROBE selector exit', result.status)
} finally {
  console.info('PROBE stopping before install; exit 0')
  process.exitCode = 0
}
