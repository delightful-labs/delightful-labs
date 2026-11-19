/** Test observations, separate from the application protocol and its view. */
export function recordFixtureEffect(effect: 'backup-commit' | 'profile-lookup-failed') {
	self.postMessage({ type: 'FINANCE_FIXTURE_EFFECT', effect })
}
