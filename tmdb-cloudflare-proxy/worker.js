/**
 * TMDB 反向代理 Worker
 * ---------------------------------------------------------------
 * 思路：一份代码，靠环境变量 UPSTREAM_HOST 决定反代到哪个上游。
 *   - image.tmdb.org  → 海报/剧照 CDN（长缓存，省流量、加速）
 *   - api.themoviedb.org → API（短缓存）
 * 部署两份到不同子域名即可：
 *   img.你的域名.com/*  → UPSTREAM_HOST=image.tmdb.org
 *   api.你的域名.com/*  → UPSTREAM_HOST=api.themoviedb.org
 * ---------------------------------------------------------------
 */

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  }
};

async function handleRequest(request, env) {
  // 上游主机：默认走 API；通过变量切换
  const upstream = (env.UPSTREAM_HOST || 'api.themoviedb.org').toLowerCase();

  const url = new URL(request.url);
  url.hostname = upstream;

  // 可选：在 Worker 这一层统一注入 API Key，调用方就无需各自带 key
  const hasAuth =
    url.searchParams.has('api_key') || request.headers.get('Authorization');
  if (env.TMDB_API_KEY && !hasAuth) {
    url.searchParams.set('api_key', env.TMDB_API_KEY);
  }

  // 浏览器直接调用时的 CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Max-Age': '86400'
      }
    });
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

  // 复制响应以便改写头部
  response = new Response(response.body, response);

  // 放开跨域，方便前端直接 fetch
  response.headers.set('Access-Control-Allow-Origin', '*');

  // 缓存策略：图片边缘缓存 1 天，API 缓存 5 分钟
  const isImage = upstream.includes('image.tmdb.org');
  if (isImage) {
    response.headers.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  } else {
    response.headers.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  }

  return response;
}
