import type {} from '../../helpers/workspace.js'
import type {} from '../../permissions.e2e.js'
import type {} from '../../authentication.e2e.js'
import type {} from '../../pagination.e2e.js'
type FixtureWindow = Pick<
	Window,
	'workspaceSettingsTest' | 'workspacePermissionTest' | 'authFailureTest' | 'paginationBatchGate'
>
const state: Partial<FixtureWindow> = {}
function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Fixture state has not been installed')
	return value
}
/** Native fixture slots replace test-owned Window slots; no SDK handle crosses to Window. */
export const fixtureWindow = {
	get workspaceSettingsTest() {
		return required(state.workspaceSettingsTest)
	},
	set workspaceSettingsTest(value: FixtureWindow['workspaceSettingsTest']) {
		state.workspaceSettingsTest = value
	},
	get workspacePermissionTest() {
		return required(state.workspacePermissionTest)
	},
	set workspacePermissionTest(value: FixtureWindow['workspacePermissionTest']) {
		state.workspacePermissionTest = value
	},
	get authFailureTest() {
		return required(state.authFailureTest)
	},
	set authFailureTest(value: FixtureWindow['authFailureTest']) {
		state.authFailureTest = value
	},
	get paginationBatchGate() {
		return required(state.paginationBatchGate)
	},
	set paginationBatchGate(value: FixtureWindow['paginationBatchGate']) {
		state.paginationBatchGate = value
	}
}
