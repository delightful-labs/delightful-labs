import { defineEnvVars } from '@sveltejs/kit/env'
import { z } from 'zod'

export const variables = defineEnvVars({
	PUBLIC_DEBUG: {
		public: true,
		static: true,
		schema: z.enum(['true', 'false']).default('false')
	},
	PUBLIC_FAKE_DATA: {
		public: true,
		static: true,
		schema: z.enum(['true', 'false']).default('false')
	},
	PUBLIC_SIMPLEFIN_DEMO: {
		public: true,
		static: true,
		schema: z.enum(['true', 'false']).default('false')
	},
	PUBLIC_JAZZ_APP_ID: { public: true, static: true, schema: z.string().default('') },
	PUBLIC_JAZZ_SERVER_URL: { public: true, static: true, schema: z.string().default('') }
})
