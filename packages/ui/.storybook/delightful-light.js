import logo from './logo.svg'

/**
 * @type {import('storybook/theming').ThemeVars}
 */
const theme = {
	base: 'dark',

	// Storybook-specific color palette
	colorPrimary: '#94ff47', // green
	colorSecondary: '#94ff47', // ocean

	// UI
	appBg: '#262626',
	appContentBg: '#262626',
	appHoverBg: '#333',
	appPreviewBg: '#262626',
	appBorderColor: '#fff',
	appBorderRadius: 0,

	// Fonts
	fontBase: 'monospace',
	fontCode: 'monospace',

	// Text colors
	textColor: '#fff',
	textInverseColor: 'red',
	textMutedColor: '#fff',

	// Toolbar default and active colors
	barTextColor: '#fff',
	barHoverColor: '#94ff47',
	barSelectedColor: '#94ff47',
	barBg: '#262626',

	// Form colors
	buttonBg: 'transparent',
	buttonBorder: '#fff',
	booleanBg: '#fff',
	booleanSelectedBg: '#94ff47',
	inputBg: 'transparent',
	inputBorder: '#fff',
	inputTextColor: '#fff',
	inputBorderRadius: 0,

	brandImage: logo
}

export default theme
