import test from 'node:test';
import assert from 'node:assert/strict';
import {prepare, validateReport, startReplay, filename} from './core.mjs';

const modernReport = '<!doctype html><html><body><div id="app"></div><script>const sessionData = {}; pyinstrumentHTMLRenderer.render(document.getElementById("app"), sessionData);</script></body></html>';
const legacyReport = '<!doctype html><html><body><div id="app"></div><script>window.profileSession = {};</script><script>/* Pyinstrument application bundle */</script></body></html>';
const post = extra => ({method: 'POST', url: 'https://example.test/api/report', ...extra});

test('GET adds profile=1 without rewriting other query components', () => {
  const result = prepare({method: 'GET', url: 'https://example.test/a?q=a%20b&tilde=~&raw=%2f&x=1&x=2#fragment'});
  assert.equal(result.url, 'https://example.test/a?q=a%20b&tilde=~&raw=%2f&x=1&x=2&profile=1');
  assert.equal(result.options.body, undefined);
  assert.equal(result.options.redirect, 'error');
});

test('profile replacement handles encoded keys and duplicates', () => {
  assert.equal(prepare({method: 'GET', url: 'https://example.test/a?profile=old&%70rofile=other&q=%2B&profile'}).url,
    'https://example.test/a?q=%2B&profile=1');
  assert.equal(prepare({method: 'GET', url: 'https://example.test'}).url, 'https://example.test/?profile=1');
});

test('unsupported methods and URL schemes are rejected before sending', () => {
  assert.throws(() => prepare({method: 'DELETE', url: 'https://example.test/a'}), /GET 和 POST/);
  assert.throws(() => prepare({method: 'GET', url: 'file:///example'}), /HTTP\/HTTPS/);
});

test('POST preserves exact JSON, CSRF and auth, and excludes browser/protocol headers', () => {
  const result = prepare(post({
    headers: [
      {name: 'Content-Type', value: 'application/json'},
      {name: 'X-CSRFToken', value: 'mock-csrf'},
      {name: 'Authorization', value: 'mock-auth'},
      {name: 'Cookie', value: 'mock-cookie'},
      {name: 'Sec-Fetch-Site', value: 'same-origin'},
      {name: 'Content-Length', value: String(new TextEncoder().encode('{"a": "中文"}').length)},
      {name: ':authority', value: 'example.test'},
      {name: ':method', value: 'POST'},
    ],
    postData: {mimeType: 'application/json', text: '{"a": "中文"}'},
  }));
  assert.deepEqual(result.options.headers, [
    ['Content-Type', 'application/json'], ['X-CSRFToken', 'mock-csrf'], ['Authorization', 'mock-auth'],
  ]);
  assert.equal(result.options.body, '{"a": "中文"}');
  assert.equal(result.options.credentials, 'include');
});

test('missing and incomplete bodies are rejected', () => {
  for (const extra of [
    {bodySize: 20},
    {bodySize: 0, headers: [{name: 'Content-Length', value: '20'}]},
    {postData: {mimeType: 'application/json'}},
    {bodySize: 20, postData: {mimeType: 'application/json', text: ''}},
    {headers: [{name: 'Content-Length', value: '20'}], postData: {mimeType: 'text/plain', text: 'partial'}},
    {postData: {mimeType: 'application/json', text: null}},
  ]) assert.throws(() => prepare(post(extra)), /请求体/);
});

test('multipart detection uses MIME and headers case-insensitively', () => {
  for (const extra of [
    {postData: {mimeType: 'Multipart/Form-Data; boundary=test', text: 'body'}},
    {headers: [{name: 'content-TYPE', value: 'MULTIPART/FORM-DATA; boundary=test'}], postData: {text: 'body'}},
    {postData: {mimeType: 'text/plain', params: [{name: 'file', fileName: ''}], text: 'body'}},
  ]) assert.throws(() => prepare(post(extra)), /Multipart/);
});

test('binary, encoded, and non-UTF8 bodies are rejected', () => {
  for (const extra of [
    {postData: {mimeType: 'application/octet-stream', text: 'bytes'}},
    {postData: {mimeType: 'application/x-protobuf', text: 'bytes'}},
    {postData: {mimeType: 'text/plain', encoding: 'base64', text: 'Ynl0ZXM='}},
    {headers: [{name: 'Content-Encoding', value: 'gzip'}], postData: {mimeType: 'text/plain', text: 'bytes'}},
    {postData: {mimeType: 'text/plain; charset=iso-8859-1', text: 'body'}},
    {headers: [{name: 'Content-Type', value: 'text/plain; charset="UTF-16"'}], postData: {mimeType: 'text/plain', text: 'body'}},
    {postData: {mimeType: 'text/plain', text: '\u0000binary'}},
    {postData: {mimeType: 'text/plain', text: '\ufffd'}},
  ]) assert.throws(() => prepare(post(extra)), /请求体/);
});

test('URL encoded params preserve duplicates and gain a missing Content-Type', () => {
  const result = prepare(post({postData: {
    mimeType: 'Application/X-Www-Form-Urlencoded; charset=UTF-8',
    params: [{name: 'a', value: 'x y'}, {name: 'a', value: '中文'}, {name: 'empty'}],
  }}));
  assert.equal(result.options.body, 'a=x+y&a=%E4%B8%AD%E6%96%87&empty=');
  assert.deepEqual(result.options.headers, [['Content-Type', 'Application/X-Www-Form-Urlencoded; charset=UTF-8']]);
});

test('text and JSON-derived MIME types retain their body without duplicating Content-Type', () => {
  for (const mime of ['text/plain; charset="utf-8"', 'application/problem+json', 'application/xml']) {
    const result = prepare(post({headers: [{name: 'content-type', value: mime}], postData: {mimeType: mime, text: '中文\nbody'}}));
    assert.equal(result.options.body, '中文\nbody');
    assert.equal(result.options.headers.length, 1);
  }
  assert.equal(prepare(post({bodySize: 0})).options.body, undefined);
  assert.equal(prepare(post({postData: {mimeType: 'text/plain', text: ''}})).options.body, '');
});

test('report validation accepts modern and legacy Pyinstrument renderer structures', () => {
  for (const html of [modernReport, legacyReport]) assert.equal(validateReport({ok: true, status: 200, text: html}), html);
});

test('normal responses and HTML errors mentioning Pyinstrument are not reports', () => {
  for (const result of [
    {ok: true, text: '{"result":false}'},
    {ok: true, text: '<html>Login</html>'},
    {ok: true, text: '<html>Pyinstrument configuration missing</html>'},
    {ok: true, text: '<html><div id="app"></div><p>window.profileSession = example</p>Pyinstrument error</html>'},
    {ok: true, text: '{"html": "pyinstrumentHTMLRenderer.render()"}'},
    {ok: false, status: 403, text: modernReport},
    undefined,
  ]) assert.throws(() => validateReport(result));
});

test('download filename excludes the query and stays within a safe basename', () => {
  assert.match(filename('https://example.test/a/?range=1'), /^a-profile-\d+\.html$/);
  assert.match(filename('https://example.test/'), /^request-profile-\d+\.html$/);
  assert.match(filename('https://example.test/a%20b'), /^a_20b-profile-\d+\.html$/);
});

test('replay reads a successful response once', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = {};
  let reads = 0;
  globalThis.fetch = async () => ({ok: true, status: 200, text: async () => { reads++; return modernReport; }});
  try {
    startReplay('job', {url: 'https://example.test', options: {}});
    while (!window.job.done) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(reads, 1);
    assert.equal(window.job.result.status, 200);
    assert.equal(validateReport(window.job.result), modernReport);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test('cancel aborts one replay without retrying it', async () => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  globalThis.window = {};
  let calls = 0;
  globalThis.fetch = async (_url, {signal}) => {
    calls++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {once: true}));
  };
  try {
    startReplay('job', {url: 'https://example.test', options: {}});
    window.job.controller.abort();
    while (!window.job.done) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(calls, 1);
    assert.match(window.job.error, /取消/);
    assert.equal(window.job.result, undefined);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
