"""Compare emitted library files with committed consumer packages, without extraction.
Usage: python3 scripts/monorepo/compare-library-build.py <source-parent> <built-library-root> [package-name]
"""
from pathlib import Path
import hashlib
import io
import json
import re
import subprocess
import sys
import tarfile

root = Path(__file__).resolve().parents[2]
report = json.loads((root / 'specs/002-monorepo-agent-guidance/archive-comparison.json').read_text())
parent, built = Path(sys.argv[1]), Path(sys.argv[2])
package_name = sys.argv[3] if len(sys.argv) > 3 else 'delightful-ui'
assert (built / 'dist/index.js').is_file(), 'Build the selected library package first.'
manifest = json.loads((built / 'package.json').read_text())
assert manifest['files'] == ['dist', '!dist/**/*.test.*', '!dist/**/*.spec.*'], 'Unsupported package file rules; extend audit before use.'
# svelte-package emits tests into dist, but pnpm pack excludes them. Compare
# only publishable files rather than treating excluded tests as new exports.
files = {p.relative_to(built).as_posix(): p.read_bytes() for p in (built / 'dist').rglob('*')
         if p.is_file() and not re.search(r'\.(test|spec)\.[^/]+$', p.name)}
inventory = json.loads((root / 'specs/002-monorepo-agent-guidance/source-inventory.json').read_text())
selected = next(item['commit'] for item in inventory['sources'] if item['repository'] == package_name)
source_paths = subprocess.check_output(['git', '-C', str(root), 'ls-tree', '-r', '--name-only', selected, 'src/lib']).decode().splitlines()
for source_path in source_paths:
    original = subprocess.check_output(['git', '-C', str(root), 'show', selected + ':' + source_path])
    assert (built / source_path).read_bytes() == original, 'Library source differs: ' + source_path
results = []
for record in report['archives']:
    if record['package'] != package_name:
        continue
    blob = subprocess.check_output(['git', '-C', str(parent / record['repository']), 'show', record['commit'] + ':' + record['path']])
    assert hashlib.sha256(blob).hexdigest() == record['sha256'], 'Archive provenance mismatch'
    with tarfile.open(fileobj=io.BytesIO(blob)) as archive:
        old = {m.name.removeprefix('package/'): archive.extractfile(m).read()
               for m in archive.getmembers() if m.isfile() and m.name.startswith('package/dist/')}
    common = old.keys() & files.keys()
    results.append({'repository': record['repository'], 'sourceCommit': record['commit'],
                    'archive': record['path'], 'archiveSha256': record['sha256'],
                    'identicalFileCount': sum(old[p] == files[p] for p in common),
                    'different': sorted(p for p in common if old[p] != files[p]),
                    'onlyArchive': sorted(old.keys() - files.keys()),
                    'onlyBuild': sorted(files.keys() - old.keys())})
print(json.dumps({'package': package_name, 'sourceCommit': selected, 'sourceFilesChecked': len(source_paths),
                  'observedToolchain': {'node': subprocess.check_output(['node', '--version']).decode().strip(),
                                        'pnpm': subprocess.check_output(['pnpm', '--version'], cwd=root).decode().strip()},
                  'comparisonScope': 'Publishable dist files after declared test/spec exclusions; package contracts audited separately.',
                  'results': results}, indent=2))
