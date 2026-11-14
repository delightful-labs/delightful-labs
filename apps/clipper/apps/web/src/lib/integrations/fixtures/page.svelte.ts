// Reactive route state for mounted tests; production uses SvelteKit's page object.
export const page = $state({ url: new URL('https://example.invalid/'), params: { id: '' } })
