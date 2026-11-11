import { browser } from '$app/env'
import type { InspectionEvent } from 'xstate'
import { createLogger, debugEnabled } from './logger.js'
import { logMachineFailure } from './machine-diagnostics.js'
import { projectInspection, type ProjectedInspection } from './inspection-projection.js'

const logger = createLogger('inspector')
const origin = 'https://stately.ai'
const lifetime = new AbortController()
const topology = new Map<string, ProjectedInspection>()
let target: Window | null = null
let connected = false
function send(event: ProjectedInspection) {
	target?.postMessage(event, origin)
}
/** Opening follows an explicit click. The hosted viewer receives sanitized
 * transport DTOs; its v5 SDK is never attached to a v6 actor system. */
export function openStateInspector() {
	if (!browser || !debugEnabled || lifetime.signal.aborted) return
	try {
		if (target && !target.closed) {
			target.focus()
			return
		}
		connected = false
		target = window.open(`${origin}/inspect`, 'xstateinspector')
		if (!target) logger.warn('Allow popups to open Stately Inspector')
	} catch {
		logger.warn('Inspector could not open')
	}
}
export function inspectActor(event: InspectionEvent) {
	if (!browser || !debugEnabled || lifetime.signal.aborted) return
	logMachineFailure(event)
	try {
		const projected = projectInspection(event)
		if (!projected) return
		if (projected.type === '@xstate.actor') topology.set(projected.sessionId, projected)
		else {
			const previous = topology.get(projected.sessionId)
			if (previous) topology.set(projected.sessionId, { ...previous, snapshot: projected.snapshot })
		}
		if (topology.size > 1000) {
			const oldest = topology.keys().next().value
			if (oldest !== undefined) topology.delete(oldest)
		}
		if (connected && target && !target.closed) send(projected)
	} catch {
		logger.warn('Inspector could not attach')
	}
}
if (browser)
	window.addEventListener(
		'message',
		(event: MessageEvent<unknown>) => {
			if (
				!target ||
				event.source !== target ||
				event.origin !== origin ||
				!event.data ||
				typeof event.data !== 'object' ||
				!('type' in event.data) ||
				event.data.type !== '@statelyai.connected'
			)
				return
			connected = true
			for (const registration of topology.values()) send(registration)
		},
		{ signal: lifetime.signal }
	)
if (import.meta.hot)
	import.meta.hot.dispose(() => {
		try {
			target?.postMessage({ type: '@statelyai.disconnected' }, origin)
		} catch {
			/* Optional diagnostic surface. */
		}
		lifetime.abort()
		topology.clear()
		target = null
		connected = false
	})
