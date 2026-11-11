/** Finite cleanup evidence, independent of actor completion or UI success. */
export type WorkspaceResourceRelease = Readonly<{
	outcome: 'released' | 'releasedWithFailure' | 'unresolved'
}>

/** Uncertainty and known failures survive later successful work within the same owner lifetime. */
export function retainResourceRelease(
	previous: WorkspaceResourceRelease,
	next: WorkspaceResourceRelease
): WorkspaceResourceRelease {
	if (previous.outcome === 'unresolved' || next.outcome === 'unresolved')
		return { outcome: 'unresolved' }
	if (previous.outcome === 'releasedWithFailure' || next.outcome === 'releasedWithFailure')
		return { outcome: 'releasedWithFailure' }
	return { outcome: 'released' }
}
