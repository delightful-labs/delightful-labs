/** Complete presentation text. Consumers may supply a fully translated object for any locale. */
export type RecoveryMessages = Readonly<{
	description: string
	heading: string
	show: string
	warning: string
	phraseLabel: string
	close: string
	pending: string
	failure: string
	unavailable: string
	retry: string
}>
