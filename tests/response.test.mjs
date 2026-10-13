import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeResponse, formatJSON, tokenizeJSON, serializePreviewValue} from '../response.mjs';

test('complete JSON objects, arrays and root primitives are recognized', () => {
  for (const source of ['{}', '[]', 'null', 'true', 'false', '0', '-0', '"中文"', '{"items":[1,null,{"ok":true}]}']) {
    const result = analyzeResponse(source);
    assert.equal(result.isJSON, true);
    assert.deepEqual(result.value, JSON.parse(source));
    assert.deepEqual(JSON.parse(result.formatted), JSON.parse(source));
  }
});

test('invalid, empty and incomplete responses remain unmodified text', () => {
  for (const source of ['', ' ', '<html>Not JSON</html>', '{"ok":', '[1,]', 'undefined', '{unquoted:1}', 'true false']) {
    const result = analyzeResponse(source);
    assert.equal(result.isJSON, false);
    assert.equal(result.value, undefined);
    assert.equal(result.formatted, source);
    assert.equal(typeof result.error, 'string');
    assert.throws(() => formatJSON(source));
  }
});

test('truncation and binary encoding prevent a misleading JSON tree', () => {
  for (const options of [{truncated: true}, {encoding: 'base64'}, {truncated: true, encoding: 'base64'}]) {
    const result = analyzeResponse('{"looks":"valid"}', options);
    assert.equal(result.isJSON, false);
    assert.equal(result.value, undefined);
    assert.equal(result.formatted, '{"looks":"valid"}');
    assert.equal(typeof result.error, 'string');
  }
});

test('formatting preserves large numbers, exponent spelling, negative zero and duplicates', () => {
  const source = '{"big":9007199254740993,"overflow":1e400,"negative":-0,"scaled":1.2300E+03,"key":1,"key":2}';
  const result = analyzeResponse(source);
  assert.equal(result.isJSON, true);
  assert.equal(result.value.big, 9007199254740992);
  assert.equal(result.value.overflow, Infinity);
  assert.equal(result.value.key, 2);
  assert.equal(result.formatted, '{\n  "big": 9007199254740993,\n  "overflow": 1e400,\n  "negative": -0,\n  "scaled": 1.2300E+03,\n  "key": 1,\n  "key": 2\n}');
});

test('escaped strings, whitespace inside values and safe property names retain their spelling', () => {
  const source = String.raw`{"__proto__":{"x":1},"constructor":"<script>","line":"a\nb","unicode":"\u4e2d","slash":"\/","quote":"\"","space":"a  b"}`;
  const result = analyzeResponse(source);
  assert.equal(result.isJSON, true);
  assert.equal(Object.hasOwn(result.value, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
  assert.deepEqual(result.value.__proto__, {x: 1});
  for (const literal of [String.raw`"a\nb"`, String.raw`"\u4e2d"`, String.raw`"\/"`, String.raw`"\""`, '"a  b"']) assert.ok(result.formatted.includes(literal));
  assert.equal({}.x, undefined);
});

test('iterative formatting correctly indents mixed and empty containers', () => {
  assert.equal(formatJSON(' { "a" : [1,{},[],{"b":false}], "n":null } '), '{\n  "a": [\n    1,\n    {},\n    [],\n    {\n      "b": false\n    }\n  ],\n  "n": null\n}');
  assert.equal(formatJSON(' " a b " '), '" a b "');
  assert.equal(formatJSON('[{}]'), '[\n  {}\n]');
});

test('tokenization classifies JSON keys and primitive values without modifying source', () => {
  const source = '{ "key" \n : "value", "n": -12.50e+2, "b":false, "nil":null, "array":[true,1] }';
  const tokens = tokenizeJSON(source);
  assert.equal(tokens.map(token => token.text).join(''), source);
  assert.deepEqual(tokens.filter(token => token.type === 'key').map(token => token.text), ['"key"', '"n"', '"b"', '"nil"', '"array"']);
  assert.deepEqual(tokens.filter(token => token.type === 'string').map(token => token.text), ['"value"']);
  assert.deepEqual(tokens.filter(token => token.type === 'number').map(token => token.text), ['-12.50e+2', '1']);
  assert.deepEqual(tokens.filter(token => token.type === 'boolean').map(token => token.text), ['false', 'true']);
  assert.deepEqual(tokens.filter(token => token.type === 'null').map(token => token.text), ['null']);
});

test('tokenization preserves escaped key punctuation and arbitrary invalid source', () => {
  for (const source of [String.raw`{"a\":b":"x:y", "text":"<img onerror=alert(1)>"}`, 'not JSON: <script> & arbitrary\ntext', '', '"unterminated']) {
    assert.equal(tokenizeJSON(source).map(token => token.text).join(''), source);
  }
});

test('nested valid JSON formatting uses no recursive traversal', () => {
  const source = '['.repeat(100) + '0' + ']'.repeat(100);
  const result = analyzeResponse(source);
  assert.equal(result.isJSON, true);
  assert.equal(result.formatted.replace(/\s/g, ''), source);
});

test('excessive nesting keeps valid JSON and raw content with an explicit formatting limit', () => {
  const source = '['.repeat(201) + '0' + ']'.repeat(201);
  const result = analyzeResponse(source);
  assert.equal(result.isJSON, true);
  assert.ok(Array.isArray(result.value));
  assert.equal(result.formatted, source);
  assert.match(result.error, /200/);
  assert.throws(() => formatJSON(source), /200/);
});

test('formatting output is bounded before indentation can grow arbitrarily', () => {
  const source = '['.repeat(200) + Array(60000).fill('0').join(',') + ']'.repeat(200);
  const result = analyzeResponse(source);
  assert.equal(result.isJSON, true);
  assert.match(result.error, /20 Mi/);
  assert.equal(result.formatted, source);
});

test('Preview copy serializes safe nested values and own __proto__ properties', () => {
  const value = JSON.parse('{"__proto__":{"x":1},"items":[true,null,0.5,"中文"]}');
  assert.equal(serializePreviewValue(value), JSON.stringify(value, null, 2));
  assert.equal(serializePreviewValue('text'), '"text"');
  assert.equal(serializePreviewValue(42), '42');
});

test('Preview copy rejects unsafe integers and nonfinite numbers at any nesting depth', () => {
  for (const value of [Infinity, NaN, 9007199254740992, {nested: [{big: 9007199254740992}]}, {nested: [Infinity]}])
    assert.throws(() => serializePreviewValue(value), /复制原文.*复制 JSON/);
});

test('Preview copy rejects cyclic/deep/non-JSON values without a stack overflow', () => {
  const cycle = {}; cycle.self = cycle;
  let deep = {}; for (let index = 0; index < 201; index++) deep = {child: deep};
  for (const value of [cycle, deep, undefined, 1n, {value: undefined}]) assert.throws(() => serializePreviewValue(value), /复制原文/);
  const shared = {ok: true};
  assert.equal(serializePreviewValue([shared, shared]), JSON.stringify([shared, shared], null, 2));
});
