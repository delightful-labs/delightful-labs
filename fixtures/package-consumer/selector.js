// Projection imports must not open a client, require browser globals, or load XState.
import { createWorkspaceSelectorView } from 'delightful-local-first/workspace/presentation'
const view = createWorkspaceSelectorView({
	directory: { status: 'available', entries: [{ id: 'local', name: 'Local workspace' }] },
	workspaceId: null,
	duplicateName: (name, id) => `${name} [${id}]`
})
if (view.kind !== 'choices' || !view.canChoose || view.selectedId !== '')
	throw new Error('Packaged selector cannot request its sole local workspace')
