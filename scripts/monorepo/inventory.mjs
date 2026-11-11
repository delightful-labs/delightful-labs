/** Read committed source baselines only. Never reads env files or modifies sources. */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error('Usage: node scripts/monorepo/inventory.mjs <source-parent-directory>');
const sources = [
  ['delightful-labs', ['apps/website']],
  ['delightful-finances', ['apps/finance']],
  ['delightful-clipper', ['apps/clipper-web', 'apps/clipper-extension']],
  ['delightful-ui', ['packages/ui']],
  ['delightful-local-first', ['packages/local-first']],
];
function git(directory, ...args) {
  return execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd();
}
const report = sources.map(([repository, proposedDestinations]) => {
  const directory = resolve(sourceRoot, repository);
  const defaultRef = git(directory, 'symbolic-ref', 'refs/remotes/origin/HEAD');
  const commit = git(directory, 'rev-parse', defaultRef);
  const entries = git(directory, 'ls-tree', '-r', '-z', commit).split('\0').filter(Boolean).map(line => {
    const [header, path] = line.split('\t');
    const [mode, type, object] = header.split(' ');
    return { path, mode, type, object };
  });
  const read = path => git(directory, 'show', `${commit}:${path}`);
  const manifests = entries.filter(({ path }) => /(^|\/)package.json$/.test(path) && !/^(vendor|fixtures|tests)\//.test(path)).map(({ path }) => {
    const pkg = JSON.parse(read(path));
    return { path, name: pkg.name, packageManager: pkg.packageManager, engines: pkg.engines,
      scripts: pkg.scripts, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies,
      peerDependencies: pkg.peerDependencies, pnpm: pkg.pnpm };
  });
  const guidance = entries.filter(({ path }) =>
    /(^|\/)(AGENTS\.md|CLAUDE\.md|GEMINI\.md|SKILL\.md)$/.test(path) ||
    /(^|\/)(memory|memories|templates)\//.test(path) ||
    /(^|\/)\.specify\/scripts\//.test(path) || /(^|\/)\.agents\//.test(path));
  return {
    repository, remote: git(directory, 'remote', 'get-url', 'origin'), defaultRef, commit,
    baselineStatus: 'Candidate from local remote-tracking ref; fetch and review before import.',
    proposedDestinations,
    workingTree: git(directory, 'status', '--porcelain=v1').split('\n').filter(Boolean),
    checkedOutBranch: git(directory, 'branch', '--show-current'),
    localBranches: git(directory, 'for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads').split('\n'),
    manifests, guidance: guidance.map(entry => entry.mode === '120000' ? { ...entry, symlinkTarget: read(entry.path), pending: 'Resolve and inventory target before consolidation.' } : entry),
    featureSelectors: entries.filter(({ path }) => /(^|\/)\.specify\/feature\.json$/.test(path)).map(({ path }) => ({ path, value: JSON.parse(read(path)) })),
    archives: entries.filter(({ path }) => /\.(tgz|tar\.gz)$/.test(path)),
    integrations: entries.filter(({ path }) => /(^|\/)(vercel\.json|netlify\.toml|render\.yaml|\.gitmodules)$/.test(path) || /(^|\/)\.github\/workflows\//.test(path)),
    lockfiles: entries.filter(({ path }) => /(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml|package-lock\.json|yarn\.lock)$/.test(path)),
    pending: ['Review each normative guidance rule and linked resources; assign shared/local/superseded/unresolved disposition.',
      'Fetch and select import commit; inspect open PRs/issues, worktrees and platform settings.',
      'Compare vendored archive contents with selected library sources, including consumer-only changes.',
      'Record baseline checks, history retention, release evidence and source handoff before import.'],
  };
});
process.stdout.write(JSON.stringify({ schemaVersion: 1, sources: report }, null, 2) + '\n');
