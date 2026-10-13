import {prepare, filename, validateReport, startReplay} from './core.mjs';
import {MAX_ENTRIES, RESPONSE_PREVIEW_LIMIT, describe, formatSize, formatTime, matches, compareEntries, requestKey, waterfall} from './network.mjs';
import {analyzeResponse, formatJSON, highlightJSON, createJSONTree, serializePreviewValue} from './response.mjs';

const $ = id => document.getElementById(id);
const api = chrome.devtools;
let entries = [], selected = null, busy = false, recording = true, activeKey = null;
let kind = 'all', sortColumn = 'start', sortDirection = 1, tab = 'headers', renderPending = false, responseVersion = 0, logGeneration = 0;
const seen = new Map();
const responses = new WeakMap();
const COPY_LIMIT = 20 * 1024 * 1024;
let responseMode = 'formatted';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function status(message, error = false) {
  $('status').textContent = message;
  $('status').className = error ? 'error' : '';
}
function evaluate(code) {
  return new Promise((resolve, reject) => api.inspectedWindow.eval(code, (value, error) => {
    if (error) reject(new Error(error.description || error.value || '无法访问被检查页面，请重新打开 DevTools。'));
    else resolve(value);
  }));
}
function add(entry) {
  const request = entry.request;
  if (!request || !/^https?:/.test(request.url)) return;
  try { if (new URL(request.url).searchParams.has('profile')) return; } catch { return; }
  const key = requestKey(entry);
  if (seen.has(key)) {
    // getHAR snapshots can lack getContent; retain the live Request when available.
    if (entry.getContent) seen.get(key).entry = entry;
    return;
  }
  const item = {key, entry};
  seen.set(key, item);
  entries.push(item);
  if (entries.length > MAX_ENTRIES) {
    const old = entries.shift();
    seen.delete(old.key);
    if (selected === old && !busy) { selected = null; showSelection(); }
  }
}
function shownEntries() {
  return entries.filter(({entry}) => matches(entry, $('search').value, kind)).sort((a, b) => compareEntries(a.entry, b.entry, sortColumn, sortDirection));
}
function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => { renderPending = false; render(); });
}
function render() {
  const shown = shownEntries();
  const keyboardItem = shown.includes(selected) ? selected : shown[0];
  const focusedKey = document.activeElement?.dataset.key;
  const first = Math.min(...entries.map(({entry}) => describe(entry).start));
  const last = Math.max(...entries.map(({entry}) => { const info = describe(entry); return info.start + (info.time || 0); }));
  const fragment = document.createDocumentFragment();
  for (const item of shown) {
    const info = describe(item.entry);
    const row = element('tr');
    row.dataset.key = item.key;
    row.className = (selected === item ? 'selected ' : '') + (info.status >= 400 || info.status === 0 ? 'failed' : '');
    row.tabIndex = keyboardItem === item ? 0 : -1;
    row.setAttribute('aria-selected', String(selected === item));
    row.title = `${info.method} ${item.entry.request.url}`;
    const name = element('td');
    name.append(element('span', info.name, 'request-name'));
    const method = element('td', info.method);
    const responseStatus = element('td', info.status || '(failed)', 'status-cell');
    const type = element('td', info.type);
    const size = element('td', formatSize(info.size), 'numeric');
    size.title = '优先显示传输大小；HAR 未提供时显示响应内容大小。';
    const time = element('td', formatTime(info.time), 'numeric');
    const timeline = element('td');
    const track = element('div', undefined, 'waterfall-track');
    const bar = element('div', undefined, 'waterfall-bar');
    const position = waterfall(item.entry, first, last - first);
    bar.style.left = `${position.left}%`; bar.style.width = `${Math.min(position.width, 100 - position.left)}%`;
    track.title = `相对起点 ${formatTime(info.start - first)} · 耗时 ${formatTime(info.time)}`;
    track.append(bar); timeline.append(track);
    row.append(name, method, responseStatus, type, size, time, timeline);
    row.onclick = () => { if (!busy) choose(item); };
    row.ondblclick = () => { if (!busy) choose(item, 'profile'); };
    row.oncontextmenu = event => { if (!busy) { event.preventDefault(); choose(item); openMenu(event.clientX, event.clientY); } };
    row.onkeydown = event => {
      if (busy) return;
      const index = shown.indexOf(item);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? shown.length - 1 : Math.max(0, Math.min(shown.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
        choose(shown[next]); focusSelected();
      } else if (event.key === 'Enter') { event.preventDefault(); choose(item, 'profile'); }
      else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); const rect = row.getBoundingClientRect(); choose(item); openMenu(rect.left + 20, rect.top + 20);
      }
    };
    fragment.append(row);
  }
  $('list').replaceChildren(fragment);
  $('empty').hidden = shown.length > 0;
  $('count').textContent = `${shown.length} / ${entries.length} 个请求 · 最多 ${MAX_ENTRIES} 条`;
  if (focusedKey) [...$('list').children].find(row => row.dataset.key === focusedKey)?.focus({preventScroll: true});
}
function focusSelected() {
  [...$('list').children].find(row => row.dataset.key === selected?.key)?.focus();
}
function choose(item, nextTab = tab) {
  const changed = selected !== item;
  selected = item; tab = nextTab;
  showSelection(); render();
  if (changed) status('已选择请求。点击“重放并下载 HTML”开始分析。');
}
function section(title, pairs) {
  const details = element('details'); details.open = true;
  details.append(element('summary', title));
  const list = element('dl', undefined, 'kv');
  for (const [name, value] of pairs) list.append(element('dt', name), element('dd', String(value ?? '—')));
  details.append(list); return details;
}
function pretty(text) {
  const trimmed = String(text || '').slice(0, RESPONSE_PREVIEW_LIMIT);
  try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch { return trimmed; }
}
function readResponse(entry) {
  return new Promise((resolve, reject) => {
    if (typeof entry.getContent === 'function') entry.getContent((text, encoding) => resolve({text: String(text ?? ''), encoding}));
    else if (entry.response?.content?.text !== undefined) resolve({text: String(entry.response.content.text), encoding: entry.response.content.encoding});
    else reject(new Error('浏览器未保留响应正文，请重新触发此请求后再查看。'));
  });
}
function loadResponse(entry) {
  if (responses.has(entry)) return responses.get(entry);
  const pending = readResponse(entry).then(({text, encoding}) => {
    const data = {text: text.slice(0, RESPONSE_PREVIEW_LIMIT), encoding, truncated: text.length > RESPONSE_PREVIEW_LIMIT, length: text.length};
    data.analysis = analyzeResponse(data.text, data);
    if (data.analysis.formatted.length > RESPONSE_PREVIEW_LIMIT * 4) {
      data.analysis.formatted = data.text;
      data.analysis.error = '格式化预览过大，显示原始 JSON；可用复制 JSON 获取格式化全文。';
    }
    return data;
  }).catch(error => { responses.delete(entry); throw error; });
  // Cache only the bounded preview, including concurrent Response / Preview reads.
  responses.set(entry, pending);
  return pending;
}
async function copyText(text, host, current) {
  if (text.length > COPY_LIMIT) throw new Error('复制内容超过 20 Mi 字符，请使用原生 Network 保存响应。');
  if (!current()) return null;
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* Older DevTools frames can reject Clipboard API access. */ }
  if (!current()) return null;
  const focused = document.activeElement;
  const textarea = element('textarea', undefined, 'clipboard-buffer');
  textarea.value = text; textarea.readOnly = true;
  textarea.setAttribute('aria-label', '待复制内容');
  const viewer = host.querySelector('.response-viewer');
  if (viewer) viewer.before(textarea); else host.append(textarea);
  textarea.focus({preventScroll: true}); textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* Keep a selectable manual fallback. */ }
  if (copied) {
    textarea.remove();
    if (focused?.isConnected) focused.focus({preventScroll: true});
    return true;
  }
  textarea.className = 'clipboard-manual';
  textarea.scrollIntoView({block: 'nearest'});
  textarea.focus({preventScroll: true}); textarea.select();
  return false;
}
function responseView(content, item, data, version) {
  const current = () => selected === item && responseVersion === version && content.isConnected;
  const toolbar = element('div', undefined, 'response-toolbar');
  const feedback = element('span', '', 'copy-feedback');
  feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  const actions = [];
  let copying = false;
  async function runCopy(source, label) {
    if (copying || !current()) return;
    copying = true;
    for (const previous of content.querySelectorAll('.clipboard-manual,.clipboard-buffer')) previous.remove();
    for (const button of actions) button.disabled = true;
    feedback.className = 'copy-feedback'; feedback.textContent = '正在复制…';
    try {
      const text = await source();
      if (!current()) return;
      const copied = await copyText(text, content, current);
      if (!current()) return;
      feedback.textContent = copied ? `已复制${label}` : copied === false ? '自动复制失败；文本已选中，请按 ⌘C / Ctrl+C。' : '';
    } catch (error) {
      if (current()) { feedback.className = 'copy-feedback error'; feedback.textContent = error.message || String(error); }
    } finally {
      copying = false;
      for (const button of actions) if (button.isConnected) button.disabled = false;
    }
  }
  async function fullResponse() {
    if (data.length > COPY_LIMIT) throw new Error('响应超过 20 Mi 字符，无法复制全文，请使用原生 Network 保存响应。');
    if (!data.truncated) return {text: data.text, encoding: data.encoding};
    const full = await readResponse(item.entry);
    if (full.text.length > COPY_LIMIT) throw new Error('响应超过 20 Mi 字符，无法复制全文，请使用原生 Network 保存响应。');
    return full;
  }
  function copyButton(label, source, feedbackLabel) {
    const button = element('button', label);
    button.onclick = () => runCopy(source, feedbackLabel);
    actions.push(button); toolbar.append(button); return button;
  }
  copyButton(data.encoding === 'base64' ? '复制 Base64' : '复制原文', async () => (await fullResponse()).text, data.encoding === 'base64' ? ' Base64 文本' : '原始响应');
  if (data.analysis.isJSON || (data.truncated && /json/i.test(item.entry.response?.content?.mimeType || ''))) {
    copyButton('复制 JSON', async () => {
      const full = await fullResponse();
      if (full.encoding) throw new Error('编码响应不能作为 JSON 复制。');
      return formatJSON(full.text);
    }, '格式化 JSON');
  }
  const viewer = element('div', undefined, 'response-viewer');
  const analysis = data.analysis;
  if (tab === 'response' && analysis.isJSON) {
    const modes = element('div', undefined, 'response-modes');
    for (const [mode, label] of [['formatted', '格式化'], ['raw', '原始']]) {
      const button = element('button', label);
      button.setAttribute('aria-pressed', String(responseMode === mode));
      button.onclick = () => {
        responseMode = mode;
        for (const candidate of modes.children) candidate.setAttribute('aria-pressed', String(candidate === button));
        viewer.replaceChildren(highlightJSON(mode === 'raw' ? data.text : analysis.formatted, document));
      };
      modes.append(button);
    }
    toolbar.append(modes);
  }
  toolbar.append(feedback); content.append(toolbar);
  if (data.truncated) content.append(element('p', `显示前 100 Ki 字符（共 ${data.length.toLocaleString()} 字符）；复制原文会按需读取完整响应。`, 'response-notice'));
  if (data.encoding === 'base64') content.append(element('p', '二进制响应以 Base64 文本显示；复制的是编码文本。', 'response-notice'));
  else if (analysis.error && analysis.isJSON) content.append(element('p', analysis.error, 'response-notice'));
  if (tab === 'preview') {
    if (analysis.isJSON) viewer.append(createJSONTree(analysis.value, document, {onCopy: value => runCopy(() => serializePreviewValue(value), '节点值')}));
    else {
      viewer.append(element('p', data.truncated ? '响应预览已截断，无法解析完整结构。可复制原文获取全文。' : data.encoding ? '编码响应不进行 JSON 结构解析。' : '此响应不是有效 JSON，显示原始文本。', 'response-notice'));
      viewer.append(element('pre', data.text));
    }
  } else viewer.append(analysis.isJSON ? highlightJSON(responseMode === 'raw' ? data.text : analysis.formatted, document) : element('pre', data.text));
  content.append(viewer);
}
function showSelection() {
  $('detail').hidden = !selected;
  if (!selected) { responseVersion++; $('detail-content').replaceChildren(); $('download').disabled = true; return; }
  const request = selected.entry.request;
  $('selection').textContent = `${request.method} ${describe(selected.entry).name}`;
  $('selection').title = request.url;
  let error = '';
  try { prepare(request); } catch (reason) { error = reason.message; }
  $('download').disabled = busy || Boolean(error);
  $('replay-hint').textContent = error || (request.method === 'POST' ? 'POST 会再次执行接口操作。保留请求体与可设置的请求头，使用当前登录状态重放一次。' : '添加 ?profile=1，保留可设置的请求头，使用当前登录状态重放一次。');
  $('replay-hint').className = request.method === 'POST' || error ? 'warning' : '';
  showTab();
}
async function showTab() {
  const version = ++responseVersion;
  const content = $('detail-content'); content.replaceChildren();
  for (const button of $('tabs').querySelectorAll('button')) {
    const active = button.dataset.tab === tab;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  }
  content.setAttribute('aria-labelledby', `tab-${tab}`);
  if (!selected) return;
  const item = selected, {request, response = {}} = item.entry;
  if (tab === 'headers') {
    content.append(section('General', [['Request URL', request.url], ['Request Method', request.method], ['Status Code', `${response.status || '(failed)'} ${response.statusText || ''}`], ['Remote Address', item.entry.serverIPAddress || '—']]));
    content.append(section('Response Headers', (response.headers || []).map(h => [h.name, h.value])));
    content.append(section('Request Headers', (request.headers || []).map(h => [h.name, h.value])));
  } else if (tab === 'payload') {
    const params = [...new URL(request.url).searchParams.entries()];
    if (params.length) content.append(section('Query String Parameters', params));
    if (request.postData?.text !== undefined) {
      content.append(element('h3', `Request Payload · ${request.postData.mimeType || 'text'}`, 'section-label'));
      content.append(element('pre', pretty(request.postData.text)));
      if (request.postData.text.length > RESPONSE_PREVIEW_LIMIT) content.append(element('p', '预览已截断；重放仍使用原始完整请求体。', 'muted'));
    } else if (request.postData?.params) content.append(section('Form Data', request.postData.params.map(p => [p.name, p.fileName ? `[file] ${p.fileName}` : p.value])));
    else if (Number(request.bodySize) > 0) content.append(element('p', 'Network 未提供请求体，请重新触发请求。', 'error'));
    else if (!params.length) content.append(element('p', '此请求没有查询参数或请求体。', 'muted'));
  } else if (tab === 'response' || tab === 'preview') {
    content.append(element('p', '正在读取原始响应…', 'muted'));
    try {
      const data = await loadResponse(item.entry);
      if (version !== responseVersion || selected !== item) return;
      content.replaceChildren();
      responseView(content, item, data, version);
    } catch (error) { if (version === responseVersion) content.replaceChildren(element('p', error.message, 'error')); }
  } else if (tab === 'timing') {
    content.append(section('Overview', [['Started', item.entry.startedDateTime], ['Duration', formatTime(item.entry.time)]]));
    const labels = {blocked: 'Queueing / Stalled', dns: 'DNS Lookup', connect: 'Initial connection', ssl: 'SSL (in connection)', send: 'Request sent', wait: 'Waiting (TTFB)', receive: 'Content Download'};
    for (const [key, label] of Object.entries(labels)) {
      const duration = item.entry.timings?.[key];
      if (!Number.isFinite(duration) || duration < 0) continue;
      const row = element('div', undefined, 'timing-row'), track = element('div'), bar = element('div', undefined, 'timing-bar');
      bar.style.width = `${Math.min(100, duration / Math.max(1, item.entry.time) * 100)}%`; track.append(bar);
      row.append(element('span', label), track, element('span', formatTime(duration), 'numeric')); content.append(row);
    }
    content.append(element('p', '按 HAR 展示已完成请求的耗时；SSL 包含在连接耗时内。', 'muted'));
  } else {
    content.append(element('h2', '下载 Pyinstrument 报告', 'profile-title'));
    content.append(section('Replay', [['Method', request.method], ['URL', request.url], ['Profile URL', (() => { try { return prepare(request).url; } catch { return '此请求无法完整重放'; } })()], ['Authentication', '当前页面 Cookie + 原可设置请求头'], ['Request body', request.postData?.text !== undefined ? `${request.postData.text.length} 字符` : request.postData?.params ? '表单参数' : '无 / 浏览器未提供']]));
    content.append(element('p', '后端必须将 ?profile=1 转为 Pyinstrument HTML 报告。正常 JSON、登录页和错误页不会作为报告下载。', 'muted'));
    content.append(element('p', '请求只在点击下方按钮后发送，不自动重试。取消不能回滚服务器已经执行的操作。', 'muted'));
  }
}
function closeMenu(restoreFocus = false) {
  const open = !$('context-menu').hidden; $('context-menu').hidden = true;
  if (open && restoreFocus) focusSelected();
}
function openMenu(x, y) {
  const menu = $('context-menu'); menu.hidden = false;
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, innerWidth - bounds.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, innerHeight - bounds.height - 4))}px`;
  $('context-profile').disabled = !['GET', 'POST'].includes(selected.entry.request.method);
  [...menu.querySelectorAll('button')].find(button => !button.disabled)?.focus();
}
$('context-profile').onclick = () => { closeMenu(); tab = 'profile'; showSelection(); $('download').focus(); };
$('context-headers').onclick = () => { closeMenu(); tab = 'headers'; showSelection(); $('tab-headers').focus(); };
$('context-menu').onkeydown = event => {
  const buttons = [...$('context-menu').querySelectorAll('button:not(:disabled)')];
  if (event.key === 'Escape' || event.key === 'Tab') { closeMenu(true); if (event.key === 'Escape') event.preventDefault(); }
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); const index = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
};
document.addEventListener('pointerdown', event => { if (!$('context-menu').contains(event.target)) closeMenu(); });
$('table-scroll').addEventListener('scroll', () => closeMenu());
window.addEventListener('resize', () => closeMenu());
$('tabs').onclick = event => { const button = event.target.closest('[data-tab]'); if (button) { tab = button.dataset.tab; showTab(); } };
$('tabs').onkeydown = event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault(); const buttons = [...$('tabs').querySelectorAll('button')];
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  tab = buttons[next].dataset.tab; showTab(); buttons[next].focus();
};
$('close-detail').onclick = () => { if (!busy) { selected = null; showSelection(); render(); } };
function sync() {
  const generation = logGeneration;
  api.network.getHAR(log => { if (generation !== logGeneration) return; for (const entry of log?.entries || []) add(entry); scheduleRender(); });
}
function clearEntries() {
  logGeneration++;
  entries = []; seen.clear(); selected = null; closeMenu(); showSelection(); render();
}
$('search').oninput = scheduleRender;
$('refresh').onclick = sync;
$('clear').onclick = () => { if (!busy) clearEntries(); };
$('record').onclick = () => {
  recording = !recording; $('record').classList.toggle('recording', recording);
  $('record').setAttribute('aria-pressed', String(recording));
  const label = recording ? '暂停记录' : '开始记录'; $('record').title = label; $('record').setAttribute('aria-label', label);
};
$('filters').onclick = event => {
  const button = event.target.closest('[data-kind]'); if (!button) return;
  kind = button.dataset.kind;
  for (const filter of $('filters').children) { filter.classList.toggle('active', filter === button); filter.setAttribute('aria-pressed', String(filter === button)); }
  render();
};
for (const button of document.querySelectorAll('[data-sort]')) button.onclick = () => {
  sortDirection = sortColumn === button.dataset.sort ? -sortDirection : 1; sortColumn = button.dataset.sort;
  for (const candidate of document.querySelectorAll('[data-sort]')) {
    candidate.parentElement.removeAttribute('aria-sort');
    candidate.textContent = candidate.dataset.sort === 'start' ? 'Waterfall' : candidate.dataset.sort[0].toUpperCase() + candidate.dataset.sort.slice(1);
  }
  button.parentElement.setAttribute('aria-sort', sortDirection === 1 ? 'ascending' : 'descending');
  const arrow = element('span', sortDirection === 1 ? ' ↑' : ' ↓'); arrow.setAttribute('aria-hidden', 'true');
  button.append(arrow); render();
};
api.network.onRequestFinished.addListener(entry => { if (recording) { add(entry); scheduleRender(); } });
api.network.onNavigated.addListener(() => {
  if (activeKey) cancelReplay();
  if (!$('preserve').checked) clearEntries();
  status('页面已导航；已终止旧页面的重放等待，请重新选择请求。');
});
let cancelled = false;
async function cancelReplay() {
  cancelled = true;
  if (activeKey) try { await evaluate(`window[${JSON.stringify(activeKey)}]?.controller.abort()`); } catch { /* Page may already be gone. */ }
}
$('cancel').onclick = cancelReplay;
$('download').onclick = async () => {
  if (!selected || busy) return;
  const chosen = selected;
  busy = true; cancelled = false;
  $('cancel').disabled = false; $('clear').disabled = true; $('close-detail').disabled = true;
  closeMenu(); showSelection();
  const key = '__profile_downloader_' + crypto.randomUUID().replaceAll('-', ''); activeKey = key;
  const started = Date.now();
  try {
    const request = prepare(chosen.entry.request);
    await evaluate(`(${startReplay.toString()})(${JSON.stringify(key)},${JSON.stringify(request)})`);
    let result;
    while (true) {
      if (cancelled) throw new Error('请求已取消。服务器已经执行的操作无法回滚。');
      if (Date.now() - started > 185000) throw new Error('等待超过 185 秒，请检查后端日志。');
      status(`正在重放并生成报告… ${Math.floor((Date.now() - started) / 1000)} 秒`);
      await new Promise(resolve => setTimeout(resolve, 400));
      const state = await evaluate(`(()=>{const job=window[${JSON.stringify(key)}];if(!job)return {error:'页面已刷新或请求上下文已丢失。'};return job.done?{done:true,result:job.result,error:job.error}:{done:false};})()`);
      if (cancelled) throw new Error('请求已取消。服务器已经执行的操作无法回滚。');
      if (state.error) throw new Error(state.error);
      if (state.done) { result = state.result; break; }
    }
    const html = validateReport(result);
    const blobURL = URL.createObjectURL(new Blob([html], {type: 'text/html'}));
    try {
      await chrome.downloads.download({url: blobURL, filename: filename(request.url), saveAs: true});
      status(`报告已交给浏览器下载，用时 ${((Date.now() - started) / 1000).toFixed(1)} 秒。`);
    } finally { setTimeout(() => URL.revokeObjectURL(blobURL), 60000); }
  } catch (error) { status(error.message || String(error), true); }
  finally {
    try { await evaluate(`(()=>{const job=window[${JSON.stringify(key)}];if(job)job.controller.abort();delete window[${JSON.stringify(key)}];})()`); } catch { /* Page may already be gone. */ }
    activeKey = null; busy = false; $('cancel').disabled = true; $('clear').disabled = false; $('close-detail').disabled = false; showSelection(); render();
  }
};
function setTheme(theme) { document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light'; }
setTheme(api.panels.themeName);
api.panels.setThemeChangeHandler?.(setTheme);
sync();
