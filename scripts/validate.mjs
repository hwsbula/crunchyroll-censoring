import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { Linter } from 'eslint';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist');
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const policy = JSON.parse(await readFile(path.join(root, 'extension.policy.json'), 'utf8'));
const codeLinter = new Linter();
const permissionFields = [
  'permissions',
  'optional_permissions',
  'host_permissions',
  'optional_host_permissions',
];

function stringList(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array.`);
  assert.ok(
    value.every((entry) => typeof entry === 'string' && entry.length > 0 && entry === entry.trim()),
    `${label} must contain nonempty strings without outer whitespace.`,
  );
  assert.equal(new Set(value).size, value.length, `${label} must not contain duplicate entries.`);
  return value;
}

function matchPattern(value) {
  if (value === '<all_urls>') return;
  const match = /^(\*|https?|file):\/\/([^/]*)(\/[^\s]*)$/.exec(value);
  assert.ok(match, `Invalid Chrome match pattern: ${value}`);
  if (match[1] === 'file') {
    assert.equal(match[2], '', `File match patterns require three slashes: ${value}`);
    return;
  }
  const authority = match[2];
  const host = /^(\*|\*\.[a-z0-9.-]+|[a-z0-9.-]+|\[[a-f0-9:]+\])(?::(\*|\d{1,5}))?$/i.exec(
    authority,
  );
  assert.ok(host, `Invalid hostname or port in Chrome match pattern: ${value}`);
  if (host[2] && host[2] !== '*') {
    assert.ok(Number(host[2]) <= 65535, `Invalid port in Chrome match pattern: ${value}`);
  }
  const hostname = host[1].replace(/^\*\./, '').replace(/^\*$/, 'example.test');
  // URL parsing catches malformed IPv6 and invalid hostnames after removing allowed wildcards.
  const parsed = new URL(`https://${hostname}/`);
  assert.ok(parsed.hostname && !hostname.includes('..'), `Invalid match-pattern host: ${value}`);
}

async function localFile(relative) {
  assert.equal(typeof relative, 'string', 'Manifest resource must be a filename.');
  assert.ok(relative.length > 0 && !relative.startsWith('/'), 'Resource must be relative.');
  assert.ok(!relative.includes('\\') && !relative.includes(':'), 'Resource must be local.');
  const absolute = path.resolve(output, relative);
  assert.ok(absolute.startsWith(`${output}${path.sep}`), 'Resource must stay inside dist/.');
  assert.ok((await stat(absolute)).isFile(), `Missing extension resource: ${relative}`);
  return absolute;
}

async function allFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), 'Do not distribute symbolic links.');
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await allFiles(absolute)));
    else files.push(absolute);
  }
  return files;
}

function checkCsp(csp) {
  assert.equal(typeof csp, 'string', 'Declare an explicit extension-page CSP.');
  const directives = new Map();
  for (const part of csp
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/);
    assert.ok(!directives.has(name), `Duplicate CSP directive: ${name}`);
    assert.ok(
      !sources.some((source) => /unsafe-(?:eval|inline)/i.test(source)),
      'Unsafe CSP source.',
    );
    directives.set(name, sources);
  }
  assert.deepEqual(directives.get('script-src'), ["'self'"], 'Scripts must be packaged locally.');
  assert.deepEqual(directives.get('object-src'), ["'none'"], 'Objects must remain disabled.');
  for (const directive of ['script-src-elem', 'worker-src']) {
    const sources = directives.get(directive);
    if (sources) {
      assert.ok(
        sources.length === 1 && ["'self'", "'none'"].includes(sources[0]),
        `${directive} may only allow packaged code or disable it.`,
      );
    }
  }
  if (directives.has('script-src-attr')) {
    assert.deepEqual(directives.get('script-src-attr'), ["'none'"]);
  }
  const connections = directives.get('connect-src');
  if (connections) {
    assert.ok(connections.length > 0, 'connect-src must list its intended destinations.');
    if (connections.includes("'none'")) assert.equal(connections.length, 1);
    for (const source of connections) {
      if (["'none'", "'self'"].includes(source)) continue;
      assert.ok(!source.includes('*'), 'Use explicit connect-src destinations.');
      const url = new URL(source);
      assert.ok(
        !url.username && !url.password && !url.search && !url.hash,
        'Invalid CSP destination.',
      );
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      assert.ok(
        ['https:', 'wss:'].includes(url.protocol) ||
          (local && ['http:', 'ws:'].includes(url.protocol)),
        'connect-src must use HTTPS/WSS, except for localhost development.',
      );
    }
  }
}

assert.equal(manifest.manifest_version, 3, 'Manifest V3 is required.');
assert.equal(manifest.version, metadata.version, 'package.json is the version source.');
assert.match(manifest.version, /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/);
assert.ok(manifest.version.split('.').every((part) => Number(part) <= 65535));
assert.match(
  manifest.minimum_chrome_version,
  /^\d+(?:\.\d+){0,3}$/,
  'Set an explicit Chrome minimum.',
);

assert.deepEqual(
  Object.keys(policy).sort(),
  [...permissionFields].sort(),
  'Keep policy fields explicit.',
);
for (const field of permissionFields) {
  const approved = stringList(policy[field], `Policy ${field}`);
  const declared = stringList(manifest[field] ?? [], `Manifest ${field}`);
  for (const entry of [...approved, ...declared]) {
    if (field.includes('host_')) matchPattern(entry);
    else assert.match(entry, /^[a-zA-Z][a-zA-Z0-9.]*$/, `Malformed API permission: ${entry}`);
  }
  assert.deepEqual(
    [...declared].sort(),
    [...approved].sort(),
    `Manifest ${field} differs from extension.policy.json; document the need and update both intentionally.`,
  );
}
for (const [required, optional] of [
  ['permissions', 'optional_permissions'],
  ['host_permissions', 'optional_host_permissions'],
]) {
  assert.ok(
    !policy[required].some((entry) => policy[optional].includes(entry)),
    `${required} and ${optional} must not repeat the same permission.`,
  );
}

checkCsp(manifest.content_security_policy?.extension_pages);
if (manifest.background) {
  assert.equal(manifest.background.type, 'module');
  await localFile(manifest.background.service_worker);
}
if (manifest.action?.default_popup) await localFile(manifest.action.default_popup);
if (manifest.options_ui?.page) await localFile(manifest.options_ui.page);
if (manifest.options_page) await localFile(manifest.options_page);
if (manifest.side_panel?.default_path) await localFile(manifest.side_panel.default_path);
if (manifest.devtools_page) await localFile(manifest.devtools_page);
for (const file of Object.values(manifest.chrome_url_overrides ?? {})) await localFile(file);
for (const file of Object.values(manifest.icons ?? {})) await localFile(file);
const actionIcon = manifest.action?.default_icon;
if (typeof actionIcon === 'string') await localFile(actionIcon);
else for (const file of Object.values(actionIcon ?? {})) await localFile(file);
for (const script of manifest.content_scripts ?? []) {
  stringList(script.matches, 'Content-script matches').forEach(matchPattern);
  stringList(script.exclude_matches ?? [], 'Excluded content-script matches').forEach(matchPattern);
  for (const file of [...(script.js ?? []), ...(script.css ?? [])]) await localFile(file);
}
for (const resources of manifest.web_accessible_resources ?? []) {
  stringList(resources.matches ?? [], 'Web-accessible resource matches').forEach(matchPattern);
  for (const file of stringList(resources.resources, 'Web-accessible resources')) {
    // Chrome permits globs here; verify literal resources and reject paths escaping the package.
    if (file.includes('*')) {
      assert.ok(!file.startsWith('/') && !file.includes('..') && !/[:\\]/.test(file));
    } else await localFile(file);
  }
}
stringList(manifest.externally_connectable?.matches ?? [], 'External-message matches').forEach(
  matchPattern,
);

for (const file of await allFiles(output)) {
  assert.ok(
    /\.(?:html|css|js|json|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|txt)$/.test(file),
    `Unexpected distributed file: ${file}`,
  );
  if (file.endsWith('.html')) {
    const html = await readFile(file, 'utf8');
    assert.ok(!/\son[a-z]+\s*=/i.test(html), 'Inline event handlers are not allowed.');
    const directory = path.relative(output, path.dirname(file)).split(path.sep).join('/');
    for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.equal(match[2].trim(), '', 'Inline scripts are not allowed.');
      const source = match[1].match(/\bsrc\s*=\s*["']([^"']+)["']/i);
      assert.ok(source, 'Scripts must have a local src.');
      await localFile(path.posix.join(directory, source[1]));
    }
    for (const match of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)) {
      await localFile(path.posix.join(directory, match[1]));
    }
  }
  if (file.endsWith('.js')) {
    const source = await readFile(file, 'utf8');
    const errors = codeLinter.verify(source, {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      rules: {
        'no-eval': 'error',
        'no-new-func': 'error',
        'no-restricted-imports': ['error', { patterns: ['http:*', 'https:*', 'data:*'] }],
        'no-restricted-syntax': [
          'error',
          {
            selector: 'ImportExpression[source.value=/^(https?|data):/]',
            message: 'Dynamic imports must load packaged code.',
          },
        ],
      },
    });
    assert.deepEqual(
      errors,
      [],
      `Packaged JavaScript violates code policy in ${path.relative(output, file)}: ${errors.map((error) => error.message).join('; ')}`,
    );
  }
}

console.log(
  'Validated MV3 manifest, reviewed permission inventory, CSP, and packaged resource paths.',
);
