// HAR presentation helpers. All data stays in the DevTools page's memory.
export const MAX_ENTRIES = 300;
export const RESPONSE_PREVIEW_LIMIT = 100 * 1024;

export function describe(entry) {
  const url = new URL(entry.request.url);
  const path = url.pathname + url.search;
  const name = url.pathname.split('/').filter(Boolean).pop() || url.hostname;
  const mime = entry.response?.content?.mimeType?.split(';')[0] || '';
  const type = entry._resourceType || ({'application/json': 'json', 'text/html': 'document', 'text/css': 'stylesheet', 'application/javascript': 'script', 'text/javascript': 'script'}[mime]) || mime.split('/').pop() || '—';
  const transfer = entry.response?._transferSize;
  const size = Number.isFinite(transfer) && transfer >= 0 ? transfer : entry.response?.content?.size;
  return {name, path, domain: url.host, method: entry.request.method, status: entry.response?.status || 0, type, mime, size, time: Number.isFinite(entry.time) && entry.time >= 0 ? entry.time : null, start: Date.parse(entry.startedDateTime) || 0};
}

export function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
export function formatTime(ms) {
  return !Number.isFinite(ms) || ms < 0 ? '—' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
export function matches(entry, query = '', kind = 'all') {
  const info = describe(entry);
  if (kind === 'fetch' && !['fetch', 'xhr', 'json'].includes(info.type.toLowerCase())) return false;
  if (['GET', 'POST'].includes(kind) && info.method !== kind) return false;
  const searchable = `${entry.request.url} ${info.method} ${info.status} ${info.type}`.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean).every(token => {
    const match = token.match(/^(method|status|domain):(.+)$/);
    if (!match) return searchable.includes(token);
    const value = {method: info.method, status: String(info.status), domain: info.domain}[match[1]].toLowerCase();
    return match[1] === 'domain' ? value.includes(match[2]) : value === match[2];
  });
}
export function compareEntries(a, b, column, direction = 1) {
  const x = describe(a), y = describe(b);
  const left = x[column] ?? -1, right = y[column] ?? -1;
  return direction * (typeof left === 'number' ? left - right : String(left).localeCompare(String(right)));
}
export function requestKey(entry) {
  return JSON.stringify([entry.startedDateTime, entry.request.method, entry.request.url, entry._requestId || entry.connection || '', entry.request.postData || null]);
}
export function waterfall(entry, first, duration) {
  const info = describe(entry);
  const total = Math.max(1, duration);
  return {left: Math.max(0, Math.min(100, (info.start - first) / total * 100)), width: Math.max(0.5, Math.min(100, (info.time || 0) / total * 100))};
}
