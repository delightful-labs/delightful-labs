declare module 'tdesign-icons-svg/src/*.svg?component' {
	import type { Component } from 'svelte'
	import type { SVGAttributes } from 'svelte/elements'

	const icon: Component<SVGAttributes<SVGSVGElement>>
	export default icon
}
