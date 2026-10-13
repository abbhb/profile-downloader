import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './project.mjs';

const SKIP_DIRECTORIES = new Set(['.git', '.codegraph', 'node_modules', 'dist', 'output', '.playwright-cli', '.playwright']);
const PUBLIC_HOSTS = new Set([
  'github.com', 'api.github.com', 'raw.githubusercontent.com', 'cli.github.com',
  'developer.chrome.com', 'chromium.googlesource.com', 'issues.chromium.org',
  'developer.mozilla.org', 'learn.microsoft.com', 'microsoftedge.github.io',
  'pyinstrument.readthedocs.io', 'pyinstrument.readthedocs.org',
  'docs.python.org', 'nodejs.org', 'docs.github.com', 'opensource.org',
  'shields.io', 'img.shields.io',
]);
const REVIEWED_IMAGES = new Set(['docs/images/network-panel.png']);
const SECRET_NAMES = /^(?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|cookie|x-csrftoken|x-csrf-token)$/i;

function publicHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return PUBLIC_HOSTS.has(host) || host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ||
    /(?:^|\.)(?:example\.(?:com|org|net)|test|example|invalid)$/.test(host);
}

function placeholder(value) {
  const text = value.trim().replace(/^Bearer\s+/i, '');
  return /^(?:mock|fake|dummy|sample|example|test|redacted|placeholder)(?:[-_][\w-]+)?$/i.test(text) ||
    /^(?:secret|token|your[-_][\w-]+|undefined|null)$/i.test(text) ||
    /^(?:<[^>]+>|\$\{[^]*|\$[A-Za-z_][A-Za-z0-9_]*)$/.test(text);
}

export function inspectText(file, text) {
  const findings = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const rules = new Set();
    const add = rule => rules.add(rule);
    if (/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/.test(line)) add('private key');
    if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|[A]KIA[A-Z0-9]{16}|[A]SIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/.test(line)) add('credential token');
    if (/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(line)) add('JWT');
    if (/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/.test(line)) add('URL credentials');

    for (const match of line.matchAll(/["']?([\w-]+)["']?\s*[:=]\s*["'`]([^"'`\n]+)["'`]/g)) {
      if (SECRET_NAMES.test(match[1]) && !placeholder(match[2])) add('literal credential value');
    }
    for (const match of line.matchAll(/["']?\bname["']?\s*:\s*(["'])(authorization|cookie|x-csrftoken|x-csrf-token)\1\s*,\s*["']?value["']?\s*:\s*(["'])([^]*?)\3/gi)) {
      if (!placeholder(match[4])) add('literal request credential');
    }
    for (const match of line.matchAll(/\[\s*(["'])(authorization|cookie|x-csrftoken|x-csrf-token)\1\s*,\s*(["'])([^]*?)\3\s*\]/gi)) {
      if (!placeholder(match[4])) add('literal header credential');
    }
    for (const match of line.matchAll(/\b(authorization|cookie|x-csrftoken|x-csrf-token)\s*[:=]\s*([^"'`\n]+)/gi)) {
      if (!placeholder(match[2])) add('literal credential header');
    }
    for (const match of line.matchAll(/\b[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi)) {
      if (!/(?:^|\.)(?:example\.(?:com|org|net)|test|example|invalid)$/i.test(match[1])) add('non-example email address');
    }
    for (const match of line.matchAll(/https?:\/\/[^\s"'`<>]+/gi)) {
      if (match[0].includes('${')) continue;
      try {
        const url = new URL(match[0]);
        if (!publicHost(url.hostname)) add('unapproved endpoint domain');
        for (const [name, value] of url.searchParams) {
          if (SECRET_NAMES.test(name) && value && !placeholder(value)) add('URL credential parameter');
        }
      } catch {
        // Dynamic URL expressions are checked as source, not resolved or fetched.
      }
    }
    // Catch bare private domains and addresses as well as complete URLs.
    for (const match of line.matchAll(/\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:com|org|net|cn|io|dev|app|internal|corp|lan|local|intranet|test|invalid|example)(?![a-z0-9.-])/gi)) {
      if (!publicHost(match[0])) add('unapproved domain');
    }
    for (const match of line.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
      const octets = match[0].split('.').map(Number);
      if (octets.some(part => part > 255)) continue;
      const documentation = octets[0] === 192 && octets[1] === 0 && octets[2] === 2 ||
        octets[0] === 198 && octets[1] === 51 && octets[2] === 100 ||
        octets[0] === 203 && octets[1] === 0 && octets[2] === 113;
      if (match[0] !== '127.0.0.1' && !documentation) add('non-example IP address');
    }
    for (const rule of rules) findings.push({ file, line: index + 1, rule });
  }
  return findings;
}

async function sourceFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    if (entry.isDirectory()) files.push(...await sourceFiles(root, path));
    else files.push({ path, file: relative(root, path).split('\\').join('/'), symlink: entry.isSymbolicLink() });
  }
  return files;
}

export async function scanRepository(root = ROOT) {
  const findings = [];
  const files = await sourceFiles(root);
  for (const { path, file, symlink } of files) {
    if (symlink) {
      findings.push({ file, line: 1, rule: 'source symlink' });
      continue;
    }
    if (/(?:^|\/)\.env(?:\.|$)|\.(?:har|pem|key|p12|pfx|sqlite3?|db|sql)$/i.test(file)) {
      findings.push({ file, line: 1, rule: 'private data file' });
      continue;
    }
    const content = await readFile(path);
    if (REVIEWED_IMAGES.has(file)) continue;
    if (content.includes(0) || /\.(?:png|jpe?g|gif|webp|pdf|zip|gz|tar)$/i.test(file)) {
      findings.push({ file, line: 1, rule: 'unreviewed binary file' });
      continue;
    }
    findings.push(...inspectText(file, content.toString('utf8')));
  }
  return { files: files.length, findings };
}

export function requireCleanSecurity(result) {
  if (!result.findings.length) return;
  // Only locations and rule names are reported; never print a matched secret.
  const details = result.findings.map(item => `${item.file}:${item.line}: ${item.rule}`).join('\n');
  throw new Error(`Public-source preflight failed:\n${details}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await scanRepository();
    requireCleanSecurity(result);
    console.log(`Security preflight passed for ${result.files} source files. Review documentation images manually before publishing.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
