import { renderEditorPixels } from '../../domain/image-editor-pixels.js'
import type { ImageRenderInput } from './image-render.js'
self.addEventListener('message', (event: MessageEvent<ImageRenderInput>) => {
	const result = renderEditorPixels(event.data.source, event.data.selection, event.data.adjustments)
	globalThis.postMessage(result)
})
