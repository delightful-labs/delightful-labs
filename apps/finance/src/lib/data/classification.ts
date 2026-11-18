import type { Db } from 'jazz-tools'
import { app, type Category, type Tag } from '../schema.js'
import { appCategorySchema } from '../validation/categories.js'
import { appTagSchema } from '../validation/tags.js'

export function createCategory(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Category['kind']
) {
	const category = appCategorySchema.parse({ organizationId, name, kind })
	return db.insert(app.categories, category).wait({ tier: 'local' })
}

export function archiveCategory(db: Pick<Db, 'update'>, categoryId: Category['id']) {
	return db.update(app.categories, categoryId, { archivedAt: new Date() }).wait({ tier: 'local' })
}

export function createTag(
	db: Pick<Db, 'insert'>,
	organizationId: string,
	name: string,
	kind: Category['kind'],
	categoryId: string | null
) {
	const tag = appTagSchema.parse({ organizationId, name, kind, categoryId })
	return db.insert(app.tags, tag).wait({ tier: 'local' })
}

export function archiveTag(db: Pick<Db, 'update'>, tagId: Tag['id']) {
	return db.update(app.tags, tagId, { archivedAt: new Date() }).wait({ tier: 'local' })
}
