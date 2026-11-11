declare module '*.svg?component' {
	import type { Component } from 'svelte'

	const component: Component<
		import('svelte/elements').SVGAttributes<SVGSVGElement>
	>
	export default component
}
