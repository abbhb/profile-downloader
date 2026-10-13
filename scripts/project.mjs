import { readFile, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// An explicit allowlist keeps HAR files, documentation, screenshots and local
// request data out of extension archives, even if they are present in the repo.
export const RUNTIME_FILES = Object.freeze([
  'LICENSE',
  'core.mjs',
  'devtools.html',
  'devtools.js',
  'manifest.json',
  'network.mjs',
  'panel.css',
  'panel.html',
  'panel.mjs',
]);

export async function readProject(root = ROOT) {
  const [manifest, packageJson, packageLock] = await Promise.all([
    readFile(resolve(root, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'package.json'), 'utf8').then(JSON.parse),
    readFile(resolve(root, 'package-lock.json'), 'utf8').then(JSON.parse),
  ]);
  return { manifest, packageJson, packageLock, version: manifest.version };
}

export async function checkProject(root = ROOT, tag) {
  const project = await readProject(root);
  const { manifest, packageJson, packageLock, version } = project;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('manifest.version must use X.Y.Z.');
  if (version !== packageJson.version) throw new Error('manifest.json and package.json versions differ.');
  if (version !== packageLock.version || version !== packageLock.packages?.['']?.version) {
    throw new Error('package-lock.json version differs from the manifest.');
  }
  if (tag && tag !== `v${version}`) throw new Error(`Release tag must be v${version}.`);
  if (manifest.manifest_version !== 3) throw new Error('Only Manifest V3 is supported.');
  if (manifest.devtools_page !== 'devtools.html') throw new Error('Unexpected DevTools entry point.');
  if (JSON.stringify(manifest.permissions) !== JSON.stringify(['downloads'])) {
    throw new Error('Permission changes require a release-tooling review. Expected downloads only.');
  }
  if (manifest.host_permissions?.length || manifest.optional_host_permissions?.length || manifest.optional_permissions?.length ||
      manifest.content_scripts?.length || manifest.background || manifest.externally_connectable ||
      manifest.web_accessible_resources?.length || manifest.action || manifest.options_page || manifest.options_ui ||
      manifest.sandbox || manifest.chrome_url_overrides) {
    throw new Error('Unexpected host access or background execution in the manifest.');
  }
  if (manifest.content_security_policy) throw new Error('Use the default Manifest V3 content security policy.');
  if (packageJson.dependencies || packageJson.optionalDependencies) throw new Error('Runtime dependencies are not allowed.');

  const runtime = new Set(RUNTIME_FILES);
  for (const file of RUNTIME_FILES) {
    const stat = await lstat(resolve(root, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Runtime file must be a regular file: ${file}`);
    if (stat.size === 0) throw new Error(`Runtime file is empty: ${file}`);
    if (!/\.(?:html|[cm]?js|css)$/.test(file)) continue;
    const content = await readFile(resolve(root, file), 'utf8');
    const references = [];
    if (file.endsWith('.html')) {
      for (const match of content.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) references.push(match[1]);
      if (/<script\b(?![^>]*\bsrc\s*=)[^>]*>\s*\S/i.test(content)) throw new Error(`Inline scripts are not allowed: ${file}`);
    } else if (/\.[cm]?js$/.test(file)) {
      for (const match of content.matchAll(/\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']/g)) references.push(match[1]);
      for (const match of content.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) references.push(match[1]);
      for (const match of content.matchAll(/["']([^"'\n]+\.html)["']/g)) references.push(match[1]);
    } else {
      for (const match of content.matchAll(/url\(\s*["']?([^\s)'" ]+)["']?\s*\)/g)) {
        if (!match[1].startsWith('data:')) references.push(match[1]);
      }
    }
    for (const reference of references) {
      const path = reference.replace(/^\.\//, '');
      if (!runtime.has(path)) throw new Error(`Unpackaged or remote reference in ${file}: ${reference}`);
    }
  }
  return project;
}

export function releaseNames(version) {
  const archive = `profile-downloader-${version}.zip`;
  return { archive, checksum: `${archive}.sha256` };
}
