import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const distribution = path.join(root, 'dist');
const artifacts = path.join(root, 'artifacts');
const { name, version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const archiveName = String(name)
  .replace(/^@/, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^[._-]+|[._-]+$/g, '');
if (!archiveName) throw new Error('package.json needs a usable package name.');
if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version)) {
  throw new Error('package.json version must be a valid Chrome numeric extension version.');
}
const contents = {};

async function collect(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name, 'en'),
  );
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('Do not package symbolic links.');
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(filename);
    else {
      const relative = path.relative(distribution, filename).split(path.sep).join('/');
      contents[relative] = [
        new Uint8Array(await readFile(filename)),
        { mtime: new Date(1980, 0, 1) },
      ];
    }
  }
}

await collect(distribution);
if (!contents['manifest.json']) throw new Error('The ZIP must contain manifest.json at its root.');
const archive = zipSync(contents, { level: 9 });
const filename = `${archiveName}-${version}.zip`;
const checksum = createHash('sha256').update(archive).digest('hex');
await mkdir(artifacts, { recursive: true });
await writeFile(path.join(artifacts, filename), archive);
await writeFile(path.join(artifacts, `${filename}.sha256`), `${checksum}  ${filename}\n`);
console.log(`Packaged artifacts/${filename} (${archive.length.toLocaleString()} bytes).`);
console.log(`SHA-256: ${checksum}`);
