import { readdir, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, checkProject } from './project.mjs';

const skip = new Set(['.git', '.codegraph', 'node_modules', 'dist', 'output', '.playwright-cli', '.playwright']);
async function syntaxFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await syntaxFiles(path));
    else if (/\.[cm]?js$/.test(entry.name)) {
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Source symlinks are not allowed.');
      files.push(path);
    }
  }
  return files;
}

try {
  const tag = process.argv[2] || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
  const { version } = await checkProject(ROOT, tag);
  const files = await syntaxFiles(ROOT);
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr || `Syntax check failed: ${file}`);
  }
  console.log(`Checked ${files.length} JavaScript files, Manifest V3, local references and version ${version}.`);
} catch (error) {
  console.error(`Check failed: ${error.message}`);
  process.exitCode = 1;
}
