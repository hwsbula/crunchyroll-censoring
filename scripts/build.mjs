import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist');

async function rejectSymlinks(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Do not publish symbolic links: ${filename}`);
    if (entry.isDirectory()) await rejectSymlinks(filename);
  }
}

async function buildExtension() {
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const publicDirectory = path.join(root, 'public');
  await rejectSymlinks(publicDirectory);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(publicDirectory, output, { recursive: true });
  const manifestPath = path.join(output, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = metadata.version;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await build({
    absWorkingDir: root,
    entryPoints: {
      background: 'src/background.ts',
      popup: 'src/popup.ts',
      options: 'src/options.ts',
    },
    outdir: output,
    bundle: true,
    splitting: false,
    format: 'esm',
    platform: 'browser',
    target: [`chrome${String(manifest.minimum_chrome_version).split('.')[0]}`],
    sourcemap: false,
    minify: false,
    treeShaking: true,
    charset: 'utf8',
    legalComments: 'eof',
    logLevel: 'info',
  });
  await build({
    absWorkingDir: root,
    entryPoints: { content: 'src/content.ts', player: 'src/integration/crunchyroll.ts' },
    outdir: output,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: [`chrome${String(manifest.minimum_chrome_version).split('.')[0]}`],
    sourcemap: false,
    minify: false,
    legalComments: 'eof',
    logLevel: 'info',
  });
  console.log(`Built ${manifest.name} ${metadata.version} in dist/.`);
}

await buildExtension();

if (process.argv.includes('--watch')) {
  let timer;
  let busy = false;
  let pending = false;
  const rebuild = async () => {
    if (busy) {
      pending = true;
      return;
    }
    busy = true;
    try {
      await buildExtension();
      console.log('Reload the extension in chrome://extensions, then reopen its popup.');
    } catch (error) {
      console.error(error);
    } finally {
      busy = false;
      if (pending) {
        pending = false;
        await rebuild();
      }
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 150);
  };
  const watchers = ['src', 'public'].map((directory) =>
    watch(path.join(root, directory), { recursive: true }, schedule),
  );
  watchers.push(watch(path.join(root, 'package.json'), schedule));
  const stop = () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  console.log('Watching src/, public/, and package.json. Chrome reloads remain manual.');
}
