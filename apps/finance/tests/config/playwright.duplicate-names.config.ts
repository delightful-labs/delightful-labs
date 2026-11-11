import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({ ...base, testMatch: ['duplicate-names.e2e.ts'] })
