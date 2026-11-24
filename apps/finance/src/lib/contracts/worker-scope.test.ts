import { expect, it } from 'vitest'
import { workerSelection } from './worker-scope.js'
const route = { workspaceId: '20000000-0000-4000-8000-000000000001', revision: 1 }
it('preserves bounded activation identity through the serialized selection envelope', () => {
	const activation = { attachment: 2, epoch: 3 }
	expect(workerSelection.parse({ ...route, activation })).toEqual({ ...route, activation })
	expect(workerSelection.parse(route)).toEqual(route)
})
it.each([
	{ attachment: 0, epoch: 1 },
	{ attachment: 1, epoch: 0 },
	{ attachment: -1, epoch: 1 },
	{ attachment: 1, epoch: 0.5 },
	{ attachment: Infinity, epoch: 1 },
	{ attachment: 1, epoch: NaN },
	{ attachment: Number.MAX_SAFE_INTEGER + 1, epoch: 1 },
	{ attachment: 1, epoch: 1, extra: 'ignored origin' }
])('refuses malformed activation identity %j', (activation) => {
	expect(workerSelection.safeParse({ ...route, activation }).success).toBe(false)
})
