import { createActor, createStepLogic } from 'xstate'
import type { EventObject } from 'xstate'

/** Real actor recipient: capture the public protocol without inspecting sender context. */
export { collectEvents as workspaceReports } from '../report-collector.fixture.js'
