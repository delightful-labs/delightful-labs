import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({ ...base, testMatch: ['multiple-workspaces.e2e.ts'] })
