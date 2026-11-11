/** @type {import('@storybook/svelte-vite').StorybookConfig} */
const config = {
	stories: ['../stories/**/*.mdx', '../stories/**/*.stories.svelte'],
	addons: ['@storybook/addon-docs', '@storybook/addon-svelte-csf'],
	framework: {
		name: '@storybook/svelte-vite',
		options: { builder: { viteConfigPath: '.storybook/vite.config.js' } }
	},
	core: { disableTelemetry: true }
}

export default config
