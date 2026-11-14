import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { unzipSync, zipSync, strFromU8 } from 'fflate';

const root = resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const prefix = `${pkg.name}-${pkg.version}`;
const archive = await readFile(join(root, 'artifacts', `${prefix}.zip`));
const files = unzipSync(archive);
const manifest = JSON.parse(strFromU8(files['manifest.json']));
if (manifest.version !== pkg.version || !files['background.js'] || !files['options.js'])
  throw new Error('Build and test this version with npm run release:store first.');
const kit = join(root, 'artifacts', `webstore-${pkg.version}`);
await mkdir(kit, { recursive: true });
const upload = `${prefix}-webstore.zip`;
const names = [
  upload,
  `${upload}.sha256`,
  'icon-128.png',
  'LISTING.md',
  'PRIVACY-AND-PERMISSIONS.md',
  'REVIEWER-INSTRUCTIONS.md',
  'PUBLISH-UNLISTED.md',
  'PRIVACY.md',
  '01-settings-sync.jpg',
  '02-term-controls.jpg',
];
const sha = createHash('sha256').update(archive).digest('hex');
await writeFile(join(kit, upload), archive);
await writeFile(join(kit, `${upload}.sha256`), `${sha}  ${upload}\n`);
await writeFile(join(root, 'artifacts', upload), archive);
await writeFile(join(root, 'artifacts', `${upload}.sha256`), `${sha}  ${upload}\n`);
await cp(join(root, 'public', 'icons', 'icon-128.png'), join(kit, 'icon-128.png'));
for (const name of [
  'LISTING.md',
  'PRIVACY-AND-PERMISSIONS.md',
  'REVIEWER-INSTRUCTIONS.md',
  'PUBLISH-UNLISTED.md',
])
  await cp(join(root, 'store', name), join(kit, name));
await cp(join(root, 'docs', 'PRIVACY.md'), join(kit, 'PRIVACY.md'));
// These are actual UI screenshots made by the release browser suite, not mockups.
for (const [source, name] of [
  ['/tmp/crunchyroll-store-sync.jpg', '01-settings-sync.jpg'],
  ['/tmp/crunchyroll-store-terms.jpg', '02-term-controls.jpg'],
]) {
  const bytes = await readFile(source);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error('Missing JPEG store screenshot. Run npm run release:store.');
  await writeFile(join(kit, name), bytes);
}
const contents = {};
for (const name of names.sort())
  contents[name] = [
    new Uint8Array(await readFile(join(kit, name))),
    { mtime: new Date(1980, 0, 1) },
  ];
await writeFile(
  join(root, 'artifacts', `${prefix}-submission-kit.zip`),
  zipSync(contents, { level: 9 }),
);
console.log(`Web Store upload: artifacts/${upload}`);
console.log(
  `Submission materials: artifacts/webstore-${pkg.version}/ and ${prefix}-submission-kit.zip`,
);
