import { defineConfig, mergeConfig } from 'vite'
import config from './vite.config.js'
import { workerFixtureConfig } from './tests/fixtures/worker/plugin.js'

// Disposable agent data; the backend is shared by HTTP and WebSocket requests.
process.env.FINANCE_EPHEMERAL_JAZZ = 'true'
export default defineConfig(mergeConfig(config, workerFixtureConfig()))
