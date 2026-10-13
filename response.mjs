const PAGE_SIZE = 100;
const MAX_JSON_DEPTH = 200;
const MAX_FORMATTED_LENGTH = 20 * 1024 * 1024;
const highlightTypes = new Set(['key', 'string', 'number', 'boolean', 'null']);
const tokenPattern = /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}\[\]:,]/g;

// Token text is always sliced from the source: never reconstruct numbers or strings.
function* scanTokens(source) {
  let end = 0;
  for (const match of source.matchAll(tokenPattern)) {
    if (match.index > end) yield {type: 'text', text: source.slice(end, match.index)};
    const value = match[0];
    let type = 'punctuation';
    if (value.startsWith('"')) {
      let after = match.index + value.length;
      while (/\s/.test(source[after] || '') && after < source.length) after++;
      type = source[after] === ':' ? 'key' : 'string';
    } else if (value === 'null') type = 'null';
    else if (value === 'true' || value === 'false') type = 'boolean';
    else if (/^-?\d/.test(value)) type = 'number';
    yield {type, text: value};
    end = match.index + value.length;
  }
  if (end < source.length) yield {type: 'text', text: source.slice(end)};
}

export function tokenizeJSON(text) {
  return Array.from(scanTokens(String(text ?? '')));
}

function formatValidated(source) {
  // Full-response copying can be much larger than the preview. Stream tokens and
  // collect bounded chunks instead of allocating one object per source token.
  const tokens = source.matchAll(tokenPattern);
  const parts = [];
  let depth = 0, length = 0, chunk = '';
  function append(...values) {
    for (const value of values) {
      length += value.length;
      if (length > MAX_FORMATTED_LENGTH) throw new Error('格式化 JSON 超过 20 Mi 字符，已保留原文。');
      chunk += value;
      if (chunk.length >= 16384) { parts.push(chunk); chunk = ''; }
    }
  }
  const newline = () => append('\n', '  '.repeat(depth));
  let current = tokens.next(), previous = '';
  while (!current.done) {
    const token = current.value[0], next = tokens.next();
    if (token === '{' || token === '[') {
      append(token);
      if (next.value?.[0] !== (token === '{' ? '}' : ']')) {
        if (depth >= MAX_JSON_DEPTH) throw new Error('JSON 嵌套超过 200 层，未展开格式化；请复制原文。');
        depth++; newline();
      }
    } else if (token === '}' || token === ']') {
      if (previous !== (token === '}' ? '{' : '[')) { depth--; newline(); }
      append(token);
    } else if (token === ',') { append(','); newline(); }
    else if (token === ':') append(': ');
    else append(token);
    previous = token; current = next;
  }
  parts.push(chunk);
  return parts.join('');
}

// Validate first, then indent lexically to retain large integers, escapes and duplicates.
export function formatJSON(text) {
  const source = String(text ?? '');
  JSON.parse(source);
  return formatValidated(source);
}

export function analyzeResponse(text, {truncated = false, encoding = ''} = {}) {
  const source = String(text ?? '');
  if (encoding) return {isJSON: false, value: undefined, formatted: source, error: '响应正文已编码，无法作为 JSON 预览。'};
  if (truncated) return {isJSON: false, value: undefined, formatted: source, error: '响应预览已截断，无法确认完整 JSON。'};
  let value;
  try { value = JSON.parse(source); } catch {
    return {isJSON: false, value: undefined, formatted: source, error: '响应正文不是完整、有效的 JSON。'};
  }
  try { return {isJSON: true, value, formatted: formatValidated(source)}; }
  catch (error) { return {isJSON: true, value, formatted: source, error: error.message}; }
}

export function serializePreviewValue(value) {
  const copyOriginal = 'Preview 无法无损复制此节点；请使用复制原文或复制 JSON。';
  const ancestors = new Set();
  const stack = [{value, depth: 0, exit: false}];
  while (stack.length) {
    const item = stack.pop(), current = item.value;
    if (item.exit) { ancestors.delete(current); continue; }
    if (typeof current === 'number' && (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current))))
      throw new Error(copyOriginal);
    if (current === null || ['string', 'boolean', 'number'].includes(typeof current)) continue;
    if (typeof current !== 'object') throw new Error(copyOriginal);
    if (item.depth >= MAX_JSON_DEPTH || ancestors.has(current)) throw new Error(copyOriginal);
    ancestors.add(current);
    stack.push({value: current, exit: true});
    for (const key of Object.keys(current)) stack.push({value: Object.getOwnPropertyDescriptor(current, key)?.value, depth: item.depth + 1, exit: false});
  }
  try {
    const result = JSON.stringify(value, null, 2);
    if (typeof result !== 'string' || result.length > MAX_FORMATTED_LENGTH) throw new Error(copyOriginal);
    return result;
  } catch { throw new Error(copyOriginal); }
}

export function highlightJSON(text, document) {
  const pre = document.createElement('pre');
  pre.className = 'json-highlight';
  for (const token of scanTokens(String(text ?? ''))) {
    if (highlightTypes.has(token.type)) {
      const span = document.createElement('span');
      span.className = `json-${token.type}`;
      span.textContent = token.text;
      pre.append(span);
    } else pre.append(document.createTextNode(token.text));
  }
  return pre;
}

export function createJSONTree(value, document, {onCopy} = {}) {
  const tree = document.createElement('div');
  tree.className = 'json-tree';
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function addLabel(parent, label) {
    if (!label) return;
    parent.append(node('span', label.array ? `[${label.key}]` : JSON.stringify(label.key), label.array ? 'json-index' : 'json-key'));
    parent.append(document.createTextNode(': '));
  }
  function copyButton(current) {
    const button = node('button', '复制', 'json-copy');
    button.type = 'button';
    button.setAttribute('aria-label', '复制节点值');
    const unrepresentable = typeof current === 'number' && (!Number.isFinite(current) || (Number.isInteger(current) && !Number.isSafeInteger(current)));
    button.disabled = typeof onCopy !== 'function' || unrepresentable;
    if (unrepresentable) button.title = '此数值超出 JavaScript 安全数值范围，请复制原文或格式化 JSON。';
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      if (!button.disabled) onCopy(current);
    });
    return button;
  }
  function createNode(current, label = null, root = false) {
    const container = current !== null && typeof current === 'object';
    if (!container) {
      const leaf = node('div', undefined, 'json-tree-leaf');
      addLabel(leaf, label);
      const type = current === null ? 'null' : typeof current;
      let text = type === 'string' ? JSON.stringify(current) : Object.is(current, -0) ? '-0' : String(current);
      if (type === 'number' && !Number.isFinite(current)) text = '超出 JavaScript 数值范围';
      leaf.append(node('span', text, `json-${type}`), copyButton(current));
      return leaf;
    }
    const array = Array.isArray(current);
    const keys = array ? null : Object.keys(current);
    const count = array ? current.length : keys.length;
    const details = node('details', undefined, 'json-node');
    details.dataset.type = array ? 'array' : 'object';
    const summary = node('summary');
    addLabel(summary, label);
    summary.append(node('span', array ? `Array(${count}) [${count ? '…' : ''}]` : `Object(${count}) {${count ? '…' : ''}}`, 'json-summary'), copyButton(current));
    const children = node('div', undefined, 'json-children');
    details.append(summary, children);
    let rendered = false, offset = 0;
    const more = node('button', undefined, 'json-load-more');
    more.type = 'button';
    function loadPage() {
      const fragment = document.createDocumentFragment();
      const limit = Math.min(count, offset + PAGE_SIZE);
      for (; offset < limit; offset++) {
        const key = array ? offset : keys[offset];
        // Only own keys are enumerated; __proto__ remains an ordinary JSON property.
        const childValue = Object.getOwnPropertyDescriptor(current, key)?.value;
        fragment.append(createNode(childValue, {key, array}));
      }
      children.append(fragment);
      if (offset < count) { more.textContent = `加载更多（${offset} / ${count}）`; children.append(more); }
      else more.remove();
    }
    more.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); loadPage(); });
    function expand() {
      if (details.open && !rendered) { rendered = true; loadPage(); }
    }
    details.addEventListener('toggle', expand);
    if (root) { details.open = true; expand(); }
    return details;
  }
  tree.append(createNode(value, null, true));
  return tree;
}
