import { app as testAppRestoreApp } from './jazz/jazz.generated.js'
export { testAppRestoreApp }
import permissions from './jazz/jazz.permissions.json' with { type: 'json' }
export { permissions as testAppRestorePermissions }

/** Ordinary notebook discovery excludes incomplete destinations; recovery reads use their fixed ID. */
export function activeTestAppDestinations(ownerId: string) {
	return testAppRestoreApp.restoreDestinations.where({ ownerId, status: 'active' })
}
