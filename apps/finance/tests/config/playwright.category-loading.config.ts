import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({ ...base, testMatch: ['category-loading.e2e.ts'] })
