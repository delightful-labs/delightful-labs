import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({ ...base, workers: 1, timeout: 60_000, grep: /@identity\b/ })
