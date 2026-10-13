import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, RUNTIME_FILES, checkProject, releaseNames } from './project.mjs';
import { makeZip, readZip } from './archive.mjs';
import { scanRepository, requireCleanSecurity } from './security-check.mjs';

try {
  const tag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
  const { version } = await checkProject(ROOT, tag);
  requireCleanSecurity(await scanRepository());
  const files = await Promise.all(RUNTIME_FILES.map(async name => ({ name, data: await readFile(resolve(ROOT, name)) })));
  const archive = makeZip(files);
  const entries = readZip(archive);
  if (entries.map(entry => entry.name).join('\n') !== RUNTIME_FILES.join('\n')) throw new Error('ZIP entries differ from the allowlist.');
  for (let index = 0; index < files.length; index++) {
    if (!entries[index].data.equals(files[index].data)) throw new Error(`ZIP contents differ: ${files[index].name}`);
  }
  const names = releaseNames(version);
  const hash = createHash('sha256').update(archive).digest('hex');
  await mkdir(resolve(ROOT, 'dist'), { recursive: true });
  await writeFile(resolve(ROOT, 'dist', names.archive), archive);
  await writeFile(resolve(ROOT, 'dist', names.checksum), `${hash}  ${names.archive}\n`);
  console.log(`Built dist/${names.archive} (${archive.length} bytes, ${files.length} allowlisted files).`);
  console.log(`SHA-256: ${hash}`);
} catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
}
