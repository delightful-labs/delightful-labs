import '../src/lib/theme.css'
import delightfulLight from './delightful-light.js'

const hiddenAttributes = /^data-sveltekit-/

/** @type {import('@storybook/svelte-vite').Preview} */
const preview = {
	parameters: {
		layout: 'padded',
		backgrounds: {
			default: 'delightful-dark',
			values: [
				{ name: 'delightful-light', value: '#fff' },
				{ name: 'delightful-dark', value: '#262626' }
			]
		},
		viewport: {
			defaultViewport: 'responsive'
		},
		storybook: {
			forcePreviewBackground: '#262626'
		},
		docs: {
			theme: delightfulLight,
			controls: { exclude: hiddenAttributes },
			argTypes: { exclude: hiddenAttributes }
		},
		controls: {
			exclude: hiddenAttributes,
			matchers: { color: /(background|color)$/i, date: /Date$/ }
		}
	}
}

export default preview
