import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({ ...base, testMatch: ['pagination.e2e.ts'] })
