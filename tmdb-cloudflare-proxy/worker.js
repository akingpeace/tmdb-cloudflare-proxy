/**
 * TMDB 反向代理 Worker（service-worker 经典格式，兼容简单上传）
 * ---------------------------------------------------------------
 * 单域名智能路由：
 *   - 路径以 /t/ 开头  → image.tmdb.org（海报/剧照 CDN）
 *   - 其余路径         → api.themoviedb.org（API）
 * 并把 API 返回 JSON 里的 image.tmdb.org 自动改写成当前域名，
 * 让图片也一并走反代。
 *
 * 用法（以 tmdb.akingpeace.asia 为例）：
 *   API : https://tmdb.akingpeace.asia/3/movie/550?api_key=你的KEY
 *   图片: https://tmdb.akingpeace.asia/t/p/w500/xxxx.jpg
 * ---------------------------------------------------------------
 */

async function handleRequest(request) {
  const url = new URL(request.url);
  const self = url.host;                          // 当前访问域名（反代自身）
  const isImage = url.pathname.startsWith('/t/');
  const upstream = isImage ? 'image.tmdb.org' : 'api.themoviedb.org';
  url.hostname = upstream;

  // 可选：在 Worker 层统一注入 API Key（没传 key / 没带 Authorization 时才补）
  const hasAuth =
    url.searchParams.has('api_key') || request.headers.get('Authorization');
  const apiKey = (typeof TMDB_API_KEY !== 'undefined') ? TMDB_API_KEY : null;
  if (apiKey && !hasAuth) {
    url.searchParams.set('api_key', apiKey);
  }

  // 浏览器直接调用时的 CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  // 用上游 URL 重新构造请求，并修正 Host 头
  const upstreamRequest = new Request(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    redirect: 'follow'
  });
  upstreamRequest.headers.delete('host');
  upstreamRequest.headers.set('host', upstream);

  let response = await fetch(upstreamRequest);

  // 把 API 返回 JSON 里的 image.tmdb.org 改写成自己的域名，图片一并走反代
  const ct = response.headers.get('content-type') || '';
  if (!isImage && request.method === 'GET' && ct.includes('application/json')) {
    const text = await response.text();
    const rewritten = text.replace(/image\.tmdb\.org/g, self);
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    response = new Response(rewritten, { status: response.status, headers });
  } else {
    response = new Response(response.body, response);
  }

  // 放开跨域，方便前端直接 fetch
  Object.entries(corsHeaders()).forEach(([k, v]) => response.headers.set(k, v));

  // 缓存：图片边缘缓存 1 天，API 缓存 5 分钟
  response.headers.set(
    'Cache-Control',
    isImage
      ? 'public, max-age=86400, s-maxage=86400'
      : 'public, max-age=300, s-maxage=300'
  );

  return response;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400'
  };
}

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});
