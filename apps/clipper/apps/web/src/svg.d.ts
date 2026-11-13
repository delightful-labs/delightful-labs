declare module '*.svg?component' {
	import type { Component } from 'svelte'
	import type { SVGAttributes } from 'svelte/elements'

	const component: Component<SVGAttributes<SVGSVGElement>>
	export default component
}
