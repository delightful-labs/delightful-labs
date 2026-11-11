import { defineConfig } from '@playwright/test'
export default defineConfig({
 testDir: '.',
 testMatch: '**/*.e2e.{ts,js}',
 testIgnore: '**/tests/pwa.e2e.ts',
 workers: 1,
 timeout: 120_000,
 expect: { timeout: 15_000 },
 outputDir: 'test-results/full-final',
 use: { baseURL: 'http://127.0.0.1:5181', trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
