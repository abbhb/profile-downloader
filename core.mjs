const forbidden = /^(cookie2?|host|origin|referer|content-length|connection|proxy-.*|sec-.*|accept-encoding|transfer-encoding|user-agent|keep-alive|te|trailer|upgrade|expect|date|via|access-control-request-.*)$/i;
const textMime = /^(?:text\/[^;]+|application\/(?:[\w.+-]+\+(?:json|xml)|json|xml|x-www-form-urlencoded|graphql|javascript|x-javascript|sql|x-ndjson|json-seq))$/i;
export function prepare(request) {
  if (!['GET', 'POST'].includes(request.method)) throw new Error('当前支持 GET 和 POST 请求。');
  const url = new URL(request.url);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请选择 HTTP/HTTPS 请求。');
  // URLSearchParams.set() re-encodes unrelated query values (e.g. %20 to +).
  // Keep every other query component unchanged, including duplicate parameters.
  const query = url.search.slice(1);
  const parts = query ? query.split('&').filter(part => !new URLSearchParams(part).has('profile')) : [];
  url.search = [...parts, 'profile=1'].join('&');
  url.hash = '';
  const originalHeaders = request.headers || [];
  const headers = originalHeaders.filter(h => !h.name.startsWith(':') && !forbidden.test(h.name)).map(h => [h.name, h.value]);
  const options = {method: request.method, headers, credentials: 'include', redirect: 'error'};
  if (request.method === 'POST') {
    const data = request.postData;
    const headerMime = originalHeaders.find(h => h.name.toLowerCase() === 'content-type')?.value;
    const contentEncoding = originalHeaders.find(h => h.name.toLowerCase() === 'content-encoding')?.value?.trim();
    const contentLength = Number(originalHeaders.find(h => h.name.toLowerCase() === 'content-length')?.value);
    const hasBody = Number(request.bodySize) > 0 || contentLength > 0;
    const mimeTypes = [headerMime, data?.mimeType].filter(Boolean);
    const mime = (headerMime || data?.mimeType || '').split(';')[0].trim().toLowerCase();
    if (mimeTypes.some(value => /^\s*multipart\//i.test(value)) || data?.params?.some(p => p.fileName !== undefined))
      throw new Error('文件/Multipart 请求暂不支持完整重放，请使用原页面重新提交。');
    if (data?.encoding || (contentEncoding && !/^identity$/i.test(contentEncoding)) || mimeTypes.some(value => {
      const charset = value.match(/;\s*charset\s*=\s*["']?([^;\s"']+)/i)?.[1];
      const type = value.split(';')[0].trim();
      return (type && !textMime.test(type)) || (charset && !/^utf-?8$/i.test(charset));
    })) throw new Error('二进制、已编码或非 UTF-8 请求体暂不支持完整重放，请使用原页面重新提交。');
    if (data?.text !== undefined) {
      if (typeof data.text !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(data.text))
        throw new Error('请求体不是完整 UTF-8 文本，无法安全重放。');
      if ((!data.text && hasBody) || (Number.isFinite(contentLength) && contentLength >= 0 && new TextEncoder().encode(data.text).length !== contentLength))
        throw new Error('Network 未提供完整请求体。请重新触发原请求后再选择，避免发送不完整数据。');
      options.body = data.text;
    } else if (mime === 'application/x-www-form-urlencoded' && data?.params)
      options.body = new URLSearchParams(data.params.map(p => [p.name, p.value ?? ''])).toString();
    else if (data || hasBody)
      throw new Error('Network 未提供完整请求体。请重新触发原请求后再选择，避免发送不完整数据。');
    if (options.body !== undefined && !headerMime && data?.mimeType)
      headers.push(['Content-Type', data.mimeType]);
  }
  return {url: url.href, options};
}
export function filename(url) {
  const name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'request';
  return `${name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0,80)}-profile-${Date.now()}.html`;
}
export function validateReport(result) {
  const text = typeof result?.text === 'string' ? result.text : '';
  if (!result?.ok) throw new Error(`HTTP ${result?.status ?? '未知'}：${text.slice(0, 800)}`);
  const html = /^\s*(?:<!--[^]*?-->\s*)*(?:<!doctype\s+html\b[^>]*>\s*)?<html(?:\s|>)/i.test(text);
  const app = /<div\b[^>]*\bid\s*=\s*(["'])app\1/i.test(text);
  // Later Pyinstrument 4.x/5.x renders sessionData; 3.x/4.0 uses window.profileSession.
  // Match renderer structure, rather than an error page merely mentioning its name.
  const scripts = [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  const renderer = scripts.some(([, code]) => /\bpyinstrumentHTMLRenderer\s*\.\s*render\s*\(/.test(code));
  const legacy = /pyinstrument/i.test(text) && scripts.some(([, code]) => /\bwindow\s*\.\s*profileSession\s*=/.test(code));
  if (!html || !app || (!renderer && !legacy))
    throw new Error(`未收到 Pyinstrument HTML 报告。检查后端 profiling 中间件、登录和 CSRF；响应摘要：\n${text.slice(0,800)}`);
  return text;
}
// 在被检查页面内执行，与 Console fetch 使用同一 Cookie/CORS 上下文。
export function startReplay(key, request) {
  const controller = new AbortController();
  const job = {done:false, controller};
  Object.defineProperty(window, key, {value:job, configurable:true});
  const timeout = setTimeout(() => controller.abort(), 180000);
  (async () => {
    try {
      const response = await fetch(request.url, {...request.options, signal:controller.signal});
      const text = await response.text();
      if (text.length > 20 * 1024 * 1024) throw new Error('报告超过 20 MB，请缩小查询范围。');
      job.result = {ok:response.ok, status:response.status, text};
    } catch (error) {
      job.error = error.name === 'AbortError' ? '请求已取消或超过 180 秒。' : String(error.message || error);
    } finally {clearTimeout(timeout); job.done = true;}
  })();
  return true;
}
