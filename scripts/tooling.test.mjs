import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { crc32, makeZip, readZip } from './archive.mjs';
import { RUNTIME_FILES, checkProject, releaseNames } from './project.mjs';
import { inspectText, scanRepository, requireCleanSecurity } from './security-check.mjs';

test('ZIP is deterministic, root-only and preserves exact UTF-8 content', () => {
  const files = [
    { name: 'manifest.json', data: Buffer.from('{"version":"1.1.0"}') },
    { name: 'panel.mjs', data: Buffer.from('// 测试\nexport const result = true;\n') },
  ];
  const archive = makeZip(files);
  assert.deepEqual(archive, makeZip(files));
  assert.deepEqual(readZip(archive), files);
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.throws(() => makeZip([{ name: '../secret', data: 'private' }]), /Unsafe archive path/);
});

test('ZIP inspection rejects modified content and invalid directories', () => {
  const original = makeZip([{ name: 'panel.mjs', data: 'A sufficiently long sample file to validate integrity.' }]);
  const damaged = Buffer.from(original);
  damaged[30 + Buffer.byteLength('panel.mjs') + 3] ^= 0x01;
  assert.throws(() => readZip(damaged));
  assert.throws(() => readZip(Buffer.from('not a zip')));
});

test('release allowlist contains only runtime files and license', () => {
  assert.deepEqual(RUNTIME_FILES, [
    'LICENSE', 'core.mjs', 'devtools.html', 'devtools.js', 'manifest.json',
    'network.mjs', 'panel.css', 'panel.html', 'panel.mjs',
  ]);
  assert.deepEqual(releaseNames('1.1.0'), {
    archive: 'profile-downloader-1.1.0.zip', checksum: 'profile-downloader-1.1.0.zip.sha256',
  });
});

async function fixtureProject(run) {
  const root = await mkdtemp(resolve(tmpdir(), 'profile-release-test-'));
  try {
    const manifest = {
      manifest_version: 3, name: 'Profile Downloader', version: '1.1.0',
      devtools_page: 'devtools.html', permissions: ['downloads'],
    };
    for (const name of RUNTIME_FILES) await writeFile(resolve(root, name), name.endsWith('.html') ? '<!doctype html>' : '// fixture\n');
    await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(resolve(root, 'package.json'), JSON.stringify({ version: '1.1.0', private: true }));
    await writeFile(resolve(root, 'package-lock.json'), JSON.stringify({ version: '1.1.0', packages: { '': { version: '1.1.0' } } }));
    await run(root, manifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('project checks reject mismatched tag, added permissions and missing packaged imports', async () => {
  await fixtureProject(async (root, manifest) => {
    assert.equal((await checkProject(root, 'v1.1.0')).version, '1.1.0');
    await assert.rejects(checkProject(root, 'v1.0.0'), /Release tag/);
    await writeFile(resolve(root, 'panel.mjs'), "import './not-packaged.mjs';");
    await assert.rejects(checkProject(root), /Unpackaged/);
    await writeFile(resolve(root, 'panel.mjs'), "import './core.mjs';");
    manifest.permissions.push('tabs');
    await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));
    await assert.rejects(checkProject(root), /Permission changes/);
  });
});

test('security scanner permits synthetic header fixtures and official documentation', () => {
  const text = [
    "const request = {name:'Authorization',value:'mock-auth'};",
    "const headers = [['X-CSRFToken','mock-csrf']];",
    'https://example.test/api?token=secret',
    'https://developer.chrome.com/docs/extensions/reference/api/devtools',
    'https://github.com/abbhb/profile-downloader',
    'docs@example.com',
    'http://127.0.0.1:8000/demo',
  ].join('\n');
  assert.deepEqual(inspectText('tests.mjs', text), []);
});

test('security scanner rejects credentials, real endpoints and personal addresses without logging values', () => {
  const privateHost = ['service', 'internal'].join('.');
  const privateIP = [10, 20, 30, 40].join('.');
  const token = ['ghp', 'x'.repeat(36)].join('_');
  const email = ['person', ['nonexample', 'org'].join('.')].join('@');
  const capture = JSON.stringify({ name: 'Authorization', value: ['sensitive', 'value'].join('-') });
  const credentialLine = 'password' + ': ' + JSON.stringify(['not', 'a', 'placeholder'].join('-'));
  const text = [`https://${privateHost}/api`, privateIP, token, email, capture, credentialLine].join('\n');
  const findings = inspectText('sample.mjs', text);
  assert.ok(findings.some(item => item.rule.includes('domain')));
  assert.ok(findings.some(item => item.rule.includes('IP address')));
  assert.ok(findings.some(item => item.rule === 'credential token'));
  assert.ok(findings.some(item => item.rule.includes('email')));
  assert.ok(findings.some(item => item.rule === 'literal request credential'));
  assert.ok(findings.some(item => item.rule === 'literal credential value'));
  assert.throws(() => requireCleanSecurity({ findings }), error => !error.message.includes(token) && !error.message.includes(privateHost));
});

test('security scanner rejects local capture files and unreviewed binaries', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'profile-security-test-'));
  try {
    await writeFile(resolve(root, 'capture.har'), '{}');
    await writeFile(resolve(root, 'screenshot.png'), Buffer.from([0, 1, 2, 3]));
    const { findings } = await scanRepository(root);
    assert.equal(findings.length, 2);
    assert.deepEqual(new Set(findings.map(item => item.rule)), new Set(['private data file', 'unreviewed binary file']));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
