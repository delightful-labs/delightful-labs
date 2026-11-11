import { defineConfig } from 'vite'
import config from './vite.config.js'

// Disposable agent data; the backend is shared by HTTP and WebSocket requests.
process.env.FINANCE_EPHEMERAL_JAZZ = 'true'
export default defineConfig(config)
