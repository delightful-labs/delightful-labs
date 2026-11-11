import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({ ...base, testMatch: ['expense-overview.e2e.ts'] })
