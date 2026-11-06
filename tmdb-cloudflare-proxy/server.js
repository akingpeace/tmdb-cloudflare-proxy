'use strict';
/**
 * TMDB 服务器本地缓存代理 + 控制台（零依赖 Node 服务）
 * ------------------------------------------------------------
 * 作用：
 *   1) 缓存代理：把请求回源到 Cloudflare 反代层(tmdb.akingpeace.asia)，
 *      命中本地缓存则直接返回 —— 连 Cloudflare 都不打；
 *      本地 miss、CF 命中 —— 打 CF 但不打 TMDB；
 *      最坏情况才回源 TMDB。大幅减少 CF 与 TMDB 的访问次数。
 *   2) 控制台：/dashboard 网页，实时展示缓存条目、命中率、接入方(客户端IP)。
 *
 * 环境变量(均可选)：
 *   PORT            监听端口，默认 8089
 *   UPSTREAM_HOST   回源 CF 域名，默认 tmdb.akingpeace.asia
 *   TMDB_ADMIN_TOKEN 控制台访问令牌，默认随机生成(见启动日志/token.txt)
 *   CACHE_DIR       缓存目录，默认 /var/cache/tmdb-proxy
 *   MAX_AGE_API_H   API 缓存时长(小时)，默认 12
 *   MAX_AGE_IMG_D   图片缓存时长(天)，默认 7
 *   MAX_ENTRIES     缓存条目上限，默认 20000
 * ------------------------------------------------------------
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '8089', 10);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || 'tmdb.akingpeace.asia';
const ADMIN_TOKEN = process.env.TMDB_ADMIN_TOKEN || crypto.randomBytes(8).toString('hex');
const CACHE_DIR = process.env.CACHE_DIR || '/var/cache/tmdb-proxy';
const MAX_AGE_API = (parseInt(process.env.MAX_AGE_API_H || '12', 10)) * 3600 * 1000;
const MAX_AGE_IMG = (parseInt(process.env.MAX_AGE_IMG_D || '7', 10)) * 24 * 3600 * 1000;
const MAX_ENTRIES = parseInt(process.env.MAX_ENTRIES || '20000', 10);

fs.mkdirSync(CACHE_DIR, { recursive: true });
try { fs.writeFileSync(path.join(CACHE_DIR, '..', 'tmdb-proxy-token.txt'), ADMIN_TOKEN); } catch (e) {}

const meta = new Map();        // hash -> {url,type,size,status,hits,lastAccess,createdAt}
const clients = new Map();     // ip   -> {count,hits,lastSeen,ua}
let totalRequests = 0, cacheHits = 0, cacheMisses = 0, upstreamRequests = 0;
const startTime = Date.now();

const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isImage = (p) => p.startsWith('/t/');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': '*'
};

// 启动恢复：扫描缓存目录，重建内存元数据
(function restore() {
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.meta')) continue;
      try {
        const m = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf8'));
        if (fs.existsSync(path.join(CACHE_DIR, m.hash + '.body'))) meta.set(m.hash, m);
      } catch (e) {}
    }
  } catch (e) {}
})();

function recordClient(ip, ua, hit) {
  let c = clients.get(ip);
  if (!c) c = { ip, count: 0, hits: 0, lastSeen: 0, ua: '' };
  c.count++; if (hit) c.hits++;
  c.lastSeen = Date.now(); if (ua) c.ua = ua;
  clients.set(ip, c);
}
function saveMeta(m) {
  fs.writeFile(path.join(CACHE_DIR, m.hash + '.meta'), JSON.stringify(m), () => {});
}
function evictIfNeeded() {
  if (meta.size <= MAX_ENTRIES) return;
  const arr = [...meta.values()].sort((a, b) => a.lastAccess - b.lastAccess);
  const drop = arr.slice(0, meta.size - MAX_ENTRIES + 1000);
  for (const m of drop) {
    meta.delete(m.hash);
    try { fs.unlinkSync(path.join(CACHE_DIR, m.hash + '.body')); fs.unlinkSync(path.join(CACHE_DIR, m.hash + '.meta')); } catch (e) {}
  }
}

// ---------- 代理 + 缓存 ----------
function proxy(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  // 非 GET 简单透传上游（不缓存）
  if (req.method !== 'GET') {
    const target = 'https://' + UPSTREAM_HOST + req.url;
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const r = https.request(target, { method: req.method, headers: Object.assign({}, req.headers, { host: UPSTREAM_HOST }) }, (up) => {
        res.writeHead(up.statusCode, Object.assign({}, CORS, up.headers)); up.pipe(res);
      });
      r.on('error', () => { res.writeHead(502, CORS); res.end('upstream error'); });
      if (body.length) r.write(body); r.end();
    });
    return;
  }

  const clientIp = req.socket.remoteAddress;
  const ua = req.headers['user-agent'] || '';
  const target = 'https://' + UPSTREAM_HOST + req.url;
  const key = hashOf(target);
  const now = Date.now();
  const img = isImage(new URL(target).pathname);
  const maxAge = img ? MAX_AGE_IMG : MAX_AGE_API;

  totalRequests++;
  const m = meta.get(key);
  if (m && (now - m.createdAt) < maxAge) {
    cacheHits++; m.hits++; m.lastAccess = now; saveMeta(m);
    recordClient(clientIp, ua, true);
    try {
      const body = fs.readFileSync(path.join(CACHE_DIR, key + '.body'));
      res.writeHead(m.status || 200, Object.assign({}, CORS, {
        'Content-Type': m.type || 'application/octet-stream',
        'X-Cache': 'HIT', 'Content-Length': body.length
      }));
      return res.end(body);
    } catch (e) { /* 文件丢失则继续走 miss */ }
  }

  // miss -> 回源 CF
  cacheMisses++; upstreamRequests++; recordClient(clientIp, ua, false);
  const r = https.get(target, {
    headers: { host: UPSTREAM_HOST, 'user-agent': ua || 'tmdb-proxy', 'accept-encoding': 'identity' }
  }, (up) => {
    const chunks = [];
    up.on('data', (d) => chunks.push(d));
    up.on('end', () => {
      let buf = Buffer.concat(chunks);
      const ct = up.headers['content-type'] || '';
      // 改写域名：把 CF 域名与 image.tmdb.org 都改成"本服务"，让图片也走本地缓存
      if (ct.includes('json')) {
        // 协议优先取 X-Forwarded-Proto(Cloudflare 橙云回源时会带上 https)，否则回退 http
        const fwdProto = (req.headers['x-forwarded-proto'] || 'http').toString().split(',')[0].trim();
        const selfBase = fwdProto + '://' + (req.headers['host'] || (UPSTREAM_HOST + ':' + PORT));
        const reUp = new RegExp('https://' + UPSTREAM_HOST.replace(/\./g, '\\.') + '(?=/|"|$)', 'g');
        let txt = buf.toString('utf8')
          .replace(reUp, selfBase)
          .replace(/https?:\/\/image\.tmdb\.org(?=\/|"|$)/g, selfBase);
        buf = Buffer.from(txt, 'utf8');
      }
      fs.writeFileSync(path.join(CACHE_DIR, key + '.body'), buf);
      const nm = { hash: key, url: target, type: ct, size: buf.length, status: up.statusCode, hits: 0, lastAccess: now, createdAt: now };
      meta.set(key, nm); saveMeta(nm); evictIfNeeded();
      res.writeHead(up.statusCode, Object.assign({}, CORS, {
        'Content-Type': ct, 'X-Cache': 'MISS', 'Content-Length': buf.length
      }));
      res.end(buf);
    });
  });
  r.on('error', () => { res.writeHead(502, CORS); res.end('upstream error'); });
}

// ---------- API / 控制台 ----------
function handleStats(req, res) {
  const u = new URL(req.url, 'http://x');
  const tok = u.searchParams.get('token') || req.headers['x-admin-token'];
  if (tok !== ADMIN_TOKEN) { res.writeHead(403, {}); return res.end('forbidden'); }
  const cacheArr = [...meta.values()].sort((a, b) => b.lastAccess - a.lastAccess);
  const cliArr = [...clients.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  const cacheSize = cacheArr.reduce((s, m) => s + (m.size || 0), 0);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    stats: {
      totalRequests, cacheHits, cacheMisses,
      hitRate: totalRequests ? (cacheHits / totalRequests * 100).toFixed(1) : 0,
      upstreamRequests, cacheEntries: meta.size, cacheSizeBytes: cacheSize,
      uptime: Date.now() - startTime
    },
    cache: cacheArr.map((m) => ({ url: m.url, type: m.type, size: m.size, hits: m.hits, lastAccess: m.lastAccess, createdAt: m.createdAt })),
    clients: cliArr.map((c) => ({ ip: c.ip, count: c.count, hits: c.hits, hitRate: c.count ? (c.hits / c.count * 100).toFixed(1) : 0, lastSeen: c.lastSeen, ua: c.ua }))
  }));
}

function serveDashboard(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(DASHBOARD_HTML);
}

const server = http.createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/api/stats') return handleStats(req, res);
  if (p === '/' || p === '/dashboard') return serveDashboard(res);
  return proxy(req, res);
});
server.listen(PORT, () => {
  console.log('TMDB cache proxy + dashboard listening on :' + PORT);
  console.log('Upstream: ' + UPSTREAM_HOST);
  console.log('Admin token: ' + ADMIN_TOKEN);
});

// ---------- 控制台前端(内嵌，无模板字符串以避免服务端解释) ----------
const DASHBOARD_HTML = [
'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">',
'<meta name="viewport" content="width=device-width,initial-scale=1">',
'<title>TMDB 缓存控制台</title>',
'<style>',
'*{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;background:#f5f7fa;color:#1f2937}',
'.wrap{max-width:1100px;margin:0 auto;padding:24px}',
'h1{font-size:22px;margin:0 0 4px} .sub{color:#6b7280;font-size:13px;margin-bottom:18px}',
'.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:22px}',
'.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px 16px;box-shadow:0 1px 2px rgba(0,0,0,.04)}',
'.card .k{font-size:12px;color:#6b7280} .card .v{font-size:24px;font-weight:700;margin-top:4px}',
'section{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:20px}',
'section h2{font-size:16px;margin:0 0 12px}',
'table{width:100%;border-collapse:collapse;font-size:13px}',
'th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #f0f2f5;white-space:nowrap}',
'th{color:#6b7280;font-weight:600} td.url{max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'.pill{padding:2px 8px;border-radius:999px;font-size:12px;background:#eef2ff;color:#4338ca}',
'.tokbar{margin-bottom:16px;display:flex;gap:8px;align-items:center}',
'.tokbar input{flex:1;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}',
'.tokbar button{padding:8px 16px;border:0;border-radius:8px;background:#4338ca;color:#fff;cursor:pointer}',
'.err{color:#dc2626;font-size:13px}',
'</style></head><body><div class="wrap">',
'<h1>🎬 TMDB 缓存控制台</h1>',
'<div class="sub">服务器本地缓存代理 + Cloudflare 边缘缓存 双层架构 · 实时刷新</div>',
'<div class="tokbar"><input id="tok" placeholder="输入控制台令牌(Admin Token)" /><button onclick="saveTok()">保存并加载</button><span id="st" class="sub"></span></div>',
'<div id="login" class="err" style="display:none">令牌错误，请重新输入。</div>',
'<div class="cards" id="cards"></div>',
'<section><h2>接入方（谁在连接）</h2><table><thead><tr><th>客户端 IP</th><th>请求数</th><th>命中率</th><th>最近 UA</th><th>最近访问</th></tr></thead><tbody id="clients"></tbody></table></section>',
'<section><h2>缓存数据（服务器上目前有哪些）</h2><table><thead><tr><th>URL</th><th>类型</th><th>大小</th><th>命中</th><th>最近访问</th><th>创建时间</th></tr></thead><tbody id="cache"></tbody></table></section>',
'</div>',
'<script>',
'var TOK=localStorage.getItem("tmdb_tok")||"";',
'if(TOK)document.getElementById("tok").value=TOK;',
'function saveTok(){TOK=document.getElementById("tok").value.trim();localStorage.setItem("tmdb_tok",TOK);load();}',
'function fmtBytes(b){if(b==null)return"-";if(b<1024)return b+" B";if(b<1048576)return(b/1024).toFixed(1)+" KB";return(b/1048576).toFixed(2)+" MB";}',
'function fmtTime(t){if(!t)return"-";var d=new Date(t);return d.toLocaleString();}',
'function fmtUptime(ms){var s=Math.floor(ms/1000);var h=Math.floor(s/3600);var m=Math.floor((s%3600)/60);return h+"h "+m+"m";}',
'function load(){',
' if(!TOK){document.getElementById("login").style.display="block";return;}',
' fetch("/api/stats?token="+encodeURIComponent(TOK)).then(function(r){return r.json();}).then(function(d){',
'  document.getElementById("login").style.display="none";',
'  var s=d.stats;',
'  var cards=[["总请求",s.totalRequests],["缓存命中率",s.hitRate+"%"],["CF回源次数",s.upstreamRequests],["缓存条目",s.cacheEntries],["缓存总量",fmtBytes(s.cacheSizeBytes)],["运行时间",fmtUptime(s.uptime)]];',
'  document.getElementById("cards").innerHTML=cards.map(function(c){return "<div class=\'card\'><div class=\'k\'>"+c[0]+"</div><div class=\'v\'>"+c[1]+"</div></div>";}).join("");',
'  document.getElementById("clients").innerHTML=d.clients.slice(0,50).map(function(c){return "<tr><td>"+c.ip+"</td><td>"+c.count+"</td><td>"+c.hitRate+"%</td><td>"+c.ua+"</td><td>"+fmtTime(c.lastSeen)+"</td></tr>";}).join("");',
'  document.getElementById("cache").innerHTML=d.cache.slice(0,200).map(function(m){return "<tr><td class=\'url\' title=\'"+m.url+"\'>"+m.url+"</td><td><span class=\'pill\'>"+m.type+"</span></td><td>"+fmtBytes(m.size)+"</td><td>"+m.hits+"</td><td>"+fmtTime(m.lastAccess)+"</td><td>"+fmtTime(m.createdAt)+"</td></tr>";}).join("");',
' }).catch(function(){document.getElementById("login").style.display="block";});',
'}',
'if(TOK)load();',
'setInterval(function(){if(TOK)load();},3000);',
'</script></body></html>'
].join('');
