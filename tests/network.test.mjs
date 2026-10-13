import test from 'node:test';
import assert from 'node:assert/strict';
import {describe, formatSize, formatTime, matches, compareEntries, requestKey, waterfall} from '../network.mjs';

function entry(overrides = {}) {
  return {
    startedDateTime: '2026-01-01T00:00:00.000Z',
    time: 250,
    _resourceType: 'fetch',
    request: {method: 'POST', url: 'https://example.test:8443/long/application/api/query_metrics/?range=1'},
    response: {status: 200, _transferSize: 512, content: {mimeType: 'application/json; charset=utf-8', size: 1024}},
    ...overrides,
  };
}

test('request name highlights the endpoint while preserving full path and host', () => {
  const info = describe(entry());
  assert.equal(info.name, 'query_metrics');
  assert.equal(info.path, '/long/application/api/query_metrics/?range=1');
  assert.equal(info.domain, 'example.test:8443');
  assert.equal(info.method, 'POST');
  assert.equal(info.type, 'fetch');
  assert.equal(info.mime, 'application/json');
  assert.equal(info.size, 512);
});

test('missing HAR values remain unknown and zero transfer size is retained', () => {
  const minimal = entry({request: {method: 'GET', url: 'https://example.test/'}, response: undefined, time: -1, startedDateTime: '', _resourceType: undefined});
  const info = describe(minimal);
  assert.equal(info.name, 'example.test');
  assert.equal(info.type, '—');
  assert.equal(info.status, 0);
  assert.equal(info.time, null);
  assert.equal(info.start, 0);
  assert.equal(formatSize(info.size), '—');
  assert.equal(describe(entry({response: {_transferSize: 0, content: {size: 1024}}})).size, 0);
  assert.equal(describe(entry({response: {_transferSize: -1, content: {size: 1024}}})).size, 1024);
});

test('size and duration formats distinguish unknown, zero, and large values', () => {
  assert.equal(formatSize(-1), '—');
  assert.equal(formatSize(undefined), '—');
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(1024), '1.0 kB');
  assert.equal(formatSize(1024 * 1024), '1.0 MB');
  assert.equal(formatTime(-1), '—');
  assert.equal(formatTime(0), '0 ms');
  assert.equal(formatTime(250.4), '250 ms');
  assert.equal(formatTime(1500), '1.50 s');
});

test('filters combine case-insensitive name, method, status, and domain terms', () => {
  const value = entry();
  assert.equal(matches(value, ' QUERY_METRICS   method:post status:200 domain:EXAMPLE.test '), true);
  assert.equal(matches(value, 'method:get'), false);
  assert.equal(matches(value, 'status:20'), false);
  assert.equal(matches(value, 'domain:other.test'), false);
  assert.equal(matches(value, 'query_metrics missing'), false);
  assert.equal(matches(value, '', 'POST'), true);
  assert.equal(matches(value, '', 'GET'), false);
});

test('Fetch/XHR filter includes native resource types and JSON MIME fallback', () => {
  assert.equal(matches(entry(), '', 'fetch'), true);
  assert.equal(matches(entry({_resourceType: 'xhr'}), '', 'fetch'), true);
  assert.equal(matches(entry({_resourceType: undefined}), '', 'fetch'), true);
  assert.equal(matches(entry({_resourceType: 'document'}), '', 'fetch'), false);
});

test('column sorting handles numbers, names, direction, and unknown time', () => {
  const fast = entry({time: 10});
  const slow = entry({time: 900});
  assert.ok(compareEntries(fast, slow, 'time') < 0);
  assert.ok(compareEntries(fast, slow, 'time', -1) > 0);
  assert.ok(compareEntries(entry({time: -1}), fast, 'time') < 0);
  const other = entry({request: {method: 'GET', url: 'https://example.test/zebra'}});
  assert.ok(compareEntries(fast, other, 'name') < 0);
});

test('request keys deduplicate snapshots without merging distinct POST payloads', () => {
  const first = entry();
  assert.equal(requestKey(first), requestKey(structuredClone(first)));
  const withBody = entry({request: {...first.request, postData: {mimeType: 'application/json', text: '{"range":1}'}}});
  const otherBody = entry({request: {...first.request, postData: {mimeType: 'application/json', text: '{"range":2}'}}});
  assert.notEqual(requestKey(withBody), requestKey(otherBody));
  assert.notEqual(requestKey(first), requestKey(entry({startedDateTime: '2026-01-01T00:00:01.000Z'})));
});

test('waterfall uses relative start and duration while bounding display percentages', () => {
  const first = Date.parse('2026-01-01T00:00:00.000Z');
  assert.deepEqual(waterfall(entry({startedDateTime: '2026-01-01T00:00:00.250Z'}), first, 1000), {left: 25, width: 25});
  assert.deepEqual(waterfall(entry({time: 0}), first, 0), {left: 0, width: 0.5});
  assert.deepEqual(waterfall(entry({time: 5000, startedDateTime: '2026-01-01T00:00:05.000Z'}), first, 1000), {left: 100, width: 100});
});
