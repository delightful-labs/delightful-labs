import { expect, it } from 'vitest'
import {
	retainResourceRelease,
	type WorkspaceResourceRelease
} from './workspace-resource-release.js'

it.each([
	['released', 'released', 'released'],
	['released', 'releasedWithFailure', 'releasedWithFailure'],
	['releasedWithFailure', 'released', 'releasedWithFailure'],
	['releasedWithFailure', 'releasedWithFailure', 'releasedWithFailure'],
	['released', 'unresolved', 'unresolved'],
	['unresolved', 'released', 'unresolved'],
	['releasedWithFailure', 'unresolved', 'unresolved'],
	['unresolved', 'releasedWithFailure', 'unresolved'],
	['unresolved', 'unresolved', 'unresolved']
] satisfies [
	WorkspaceResourceRelease['outcome'],
	WorkspaceResourceRelease['outcome'],
	WorkspaceResourceRelease['outcome']
][])('retains %s followed by %s as %s', (previous, next, outcome) => {
	const before = Object.freeze({ outcome: previous })
	const after = Object.freeze({ outcome: next })
	expect(retainResourceRelease(before, after)).toEqual({ outcome })
	expect(before.outcome).toBe(previous)
	expect(after.outcome).toBe(next)
})
