"""Audit committed internal package archives without extracting or executing them.

Usage: python3 scripts/monorepo/compare-archives.py <source-parent>
Reads the candidate commits recorded in source-inventory.json, not working trees.
"""
import hashlib
import io
import json
import posixpath
from pathlib import Path
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
INVENTORY = json.loads((ROOT / 'specs/002-monorepo-agent-guidance/source-inventory.json').read_text())
SOURCES = {source['repository']: source for source in INVENTORY['sources']}
PARENT = Path(sys.argv[1])


def git(source, *args):
    return subprocess.check_output(['git', '-C', str(PARENT / source['repository']), *args])


def digest(content):
    return hashlib.sha256(content).hexdigest()


def committed(source, path):
    return git(source, 'show', source['commit'] + ':' + path)


archives = []
contents = []
for source in SOURCES.values():
    references = {}
    for manifest in source['manifests']:
        for field in ['dependencies', 'devDependencies', 'optionalDependencies']:
            for name, value in manifest.get(field, {}).items():
                if name not in ('delightful-ui', 'delightful-local-first') or not value.startswith('file:'):
                    continue
                path = posixpath.normpath(posixpath.join(posixpath.dirname(manifest['path']), value[5:]))
                references.setdefault(path, []).append({'manifest': manifest['path'], 'field': field, 'package': name})
    for path, consumers in sorted(references.items()):
        blob = committed(source, path)
        with tarfile.open(fileobj=io.BytesIO(blob), mode='r:gz') as archive:
            files = {member.name.removeprefix('./').removeprefix('package/'): archive.extractfile(member).read()
                     for member in archive.getmembers() if member.isfile()}
        package = json.loads(files['package.json'])
        library = SOURCES[package['name']]
        selected_package = json.loads(committed(library, 'package.json'))
        tree = set(git(library, 'ls-tree', '-r', '--name-only', library['commit']).decode().splitlines())
        source_comparison = {'identical': [], 'different': [], 'generatedOrUnmapped': []}
        for filename, content in sorted(files.items()):
            if not filename.startswith('dist/'):
                continue
            candidate = 'src/lib/' + filename[5:]
            # Compare only assets with unchanged source extensions. Compiled JS and
            # declarations need a reproducible package build, not a text comparison.
            if candidate in tree and not filename.endswith(('.js', '.d.ts', '.map')):
                category = 'identical' if content == committed(library, candidate) else 'different'
                source_comparison[category].append({'archivePath': filename, 'sourcePath': candidate})
            else:
                source_comparison['generatedOrUnmapped'].append(filename)
        contract = {}
        for field in ['exports', 'peerDependencies', 'peerDependenciesMeta', 'dependencies']:
            old, new = package.get(field, {}), selected_package.get(field, {})
            contract[field] = {'archive': old, 'selectedSource': new, 'equal': old == new}
        archives.append({'repository': source['repository'], 'commit': source['commit'], 'path': path,
                         'sha256': digest(blob), 'consumers': consumers, 'package': package['name'],
                         'version': package.get('version'), 'selectedLibraryCommit': library['commit'],
                         'contract': contract, 'sourceComparison': source_comparison,
                         'status': 'Pending reproducible packaged-build comparison and consumer verification.'})
        contents.append(files)

comparisons = []
for left in range(len(archives)):
    for right in range(left + 1, len(archives)):
        a, b = archives[left], archives[right]
        if a['package'] != b['package']:
            continue
        af, bf = contents[left], contents[right]
        common = af.keys() & bf.keys()
        comparisons.append({'left': left, 'right': right,
                            'onlyLeft': sorted(af.keys() - bf.keys()),
                            'onlyRight': sorted(bf.keys() - af.keys()),
                            'different': sorted(path for path in common if af[path] != bf[path]),
                            'identicalFileCount': sum(af[path] == bf[path] for path in common)})
print(json.dumps({'schemaVersion': 1, 'archives': archives, 'comparisons': comparisons}, indent=2))
