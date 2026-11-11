import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({ ...base, grep: /@workflow-completion\b/ })
