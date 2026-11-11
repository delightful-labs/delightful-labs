"""Compare emitted UI files with committed consumer packages, without extraction.
Usage: python3 scripts/monorepo/compare-ui-build.py <source-parent> <built-ui-root>
"""
from pathlib import Path
import hashlib
import io
import json
import subprocess
import sys
import tarfile

root = Path(__file__).resolve().parents[2]
report = json.loads((root / 'specs/002-monorepo-agent-guidance/archive-comparison.json').read_text())
parent, built = Path(sys.argv[1]), Path(sys.argv[2])
assert (built / 'dist/index.js').is_file(), 'Build UI with pnpm ui:package first.'
files = {p.relative_to(built).as_posix(): p.read_bytes() for p in (built / 'dist').rglob('*') if p.is_file()}
inventory = json.loads((root / 'specs/002-monorepo-agent-guidance/source-inventory.json').read_text())
selected = next(item['commit'] for item in inventory['sources'] if item['repository'] == 'delightful-ui')
source_paths = subprocess.check_output(['git', '-C', str(root), 'ls-tree', '-r', '--name-only', selected, 'src/lib']).decode().splitlines()
for source_path in source_paths:
    original = subprocess.check_output(['git', '-C', str(root), 'show', selected + ':' + source_path])
    assert (built / source_path).read_bytes() == original, 'UI source differs: ' + source_path
results = []
for record in report['archives']:
    if record['package'] != 'delightful-ui':
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
print(json.dumps({'uiSourceCommit': selected, 'sourceFilesChecked': len(source_paths),
                  'observedToolchain': {'node': subprocess.check_output(['node', '--version']).decode().strip(),
                                        'pnpm': subprocess.check_output(['pnpm', '--version'], cwd=root).decode().strip()},
                  'comparisonScope': 'Emitted dist files; package contracts audited separately.',
                  'results': results}, indent=2))
