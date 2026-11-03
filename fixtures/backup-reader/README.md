# Independent backup file inspection

Implementation and local runtime verification complete; PR/CI status is reported separately. No Finance profile validator or backup creator
is included. The tool is read-only and requires no original application, Jazz service or login.

Install dependencies and build the package once (`pnpm install --frozen-lockfile`, `pnpm package`).
Subsequent inspection performs no build, installation, schema loading or network requests:

```sh
pnpm backup:inspect ./retained-file.dlfbackup
```

For encrypted files, the first call reports `passwordRequired`. Rerun with `--password-stdin`, supplying
the exact password bytes through stdin (for example, a password manager pipe). Do not place a password
in command arguments or environment variables. Input is limited to 1,024 UTF-8 bytes, with no trimming,
Unicode normalization or newline removal; an added newline is part of the password. Stdin must reach
EOF. There is no masked interactive prompt in this slice.

Output is one JSON report. It contains declared archive/profile/source identifiers and counts, not
record values, attachment names or a claim of source completeness. Treat that metadata as private.
The default registry is empty: even an intact file reports `integrityValidProfileUnsupported` until
its exact application profile/version has a trusted validator. No archive can load a validator or
other executable code. Programmatic consumers supply validators through the inspection API.

Exit 0 means generic inspection completed, including unsupported profiles; 2 means password required;
1 means invalid, failed or interrupted inspection. None of these results proves restore success.
SIGINT/SIGTERM drain the workflow and release owned data. No existing app/browser storage is opened,
no archive is rewritten, and no access grants or bank connections are restored.

Verification includes separate-process plaintext/encrypted reads using the fixed v1 vector, exact
stdin handling, limits and file growth, signal handling and private error output. A test preloader
makes HTTP, TCP and fetch APIs throw, and the child receives no application credentials. Run
`pnpm check:backup-reader` and `node --test fixtures/backup-reader/reader.test.mjs` after packaging.
These checks are part of `pnpm check:consumer` in CI. They do not validate Finance or prove restore.
