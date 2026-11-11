import config from '../../.storybook/main.js'

export default {
	...config,
	stories: [
		'../../src/stories/**/*.mdx',
		'../../src/stories/**/*.stories.svelte',
		'../fixtures/**/*.stories.svelte'
	]
}
