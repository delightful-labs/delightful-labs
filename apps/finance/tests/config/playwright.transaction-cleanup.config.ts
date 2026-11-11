import { defineConfig } from '@playwright/test'
import base from './base.js'

export default defineConfig({ ...base, grep: /@(transactions|bank-sync|categories|tags)\b/ })
