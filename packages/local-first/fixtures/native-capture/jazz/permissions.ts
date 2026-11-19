import { schema } from './schema.js'
const { definePermissions } = schema
export const permissions = definePermissions({
	workspaces: {
		read: { visible: true },
		insert: { allowed: true },
		update: { allowed: true },
		delete: true
	},
	entries: { read: true, insert: true, update: true, delete: true },
	files: { read: true, insert: true, update: true, delete: true },
	parts: { read: true, insert: true, update: true, delete: true }
})
