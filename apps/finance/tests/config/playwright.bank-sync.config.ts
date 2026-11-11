import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({
	...base,
	testMatch: ['bank-sync.e2e.ts', 'bank-sync-offline.e2e.ts', 'readiness.e2e.ts']
})
