export const fontSizeTokens = {
	xs: 'var(--dui-font-size-xs, 0.75rem)',
	sm: 'var(--dui-font-size-sm, 0.875rem)',
	md: 'var(--dui-font-size-md, 1rem)',
	lg: 'var(--dui-font-size-lg, 1.125rem)',
	xl: 'var(--dui-font-size-xl, 1.25rem)',
	xxl: 'var(--dui-font-size-xxl, 1.5rem)'
}

export type TypographySize = keyof typeof fontSizeTokens
export type TypographyAlign =
	'start' | 'center' | 'end' | 'left' | 'right' | 'justify'
