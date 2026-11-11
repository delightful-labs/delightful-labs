# Finance alpha.59 backup fixture

Both `finance-alpha59-v1.dlf` and `finance-alpha59-v2.dlf` were exported with Jazz `2.0.0-alpha.59` from Finance
commit `699e6d9`, using its existing native backup qualification's synthetic
"Exact household" graph. The SDK was not migrated to alpha.60. Version 1 uses the preceding schema/permissions and the legacy relation reader, excluding later source-document capture. Version 2 uses the baseline released schema and reader.
The unencrypted file contains synthetic financial records and attachment bytes;
it contains no user data, account secret or provider credentials.

Each `.expected.json` is the payload independently reopened by that
same alpha.59 qualification. It records the source values for cross-version
restore verification. Source IDs are intentionally remapped by Finance restore.

The temporary source checkout is isolated at `../jazz-backup-source59`; its
native backup test writes the fixture only when `FINANCE_COMPAT_TARGET` is set.
Both original version-2 native export cases (unencrypted and password-protected), plus the legacy version-1 export, passed.
