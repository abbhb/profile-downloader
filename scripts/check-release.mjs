import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, RUNTIME_FILES, checkProject, releaseNames } from './project.mjs';
import { readZip } from './archive.mjs';

try {
  const tag = process.argv[2] || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  const { version } = await checkProject(ROOT, tag);
  const names = releaseNames(version);
  const archive = await readFile(resolve(ROOT, 'dist', names.archive));
  const checksum = await readFile(resolve(ROOT, 'dist', names.checksum), 'utf8');
  const expected = `${createHash('sha256').update(archive).digest('hex')}  ${names.archive}\n`;
  if (checksum !== expected) throw new Error('Release checksum does not match the archive.');
  const entries = readZip(archive);
  if (entries.map(entry => entry.name).join('\n') !== RUNTIME_FILES.join('\n')) throw new Error('Unexpected release archive contents.');
  for (const { name, data } of entries) {
    if (!data.equals(await readFile(resolve(ROOT, name)))) throw new Error(`Release bytes differ from source: ${name}`);
  }
  const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json').data.toString('utf8'));
  if (manifest.version !== version) throw new Error('Packaged manifest version differs.');
  console.log(`Verified ${names.archive}: version ${version}, checksum, ${entries.length} allowlisted files and source bytes.`);
} catch (error) {
  console.error(`Release check failed: ${error.message}`);
  process.exitCode = 1;
}
