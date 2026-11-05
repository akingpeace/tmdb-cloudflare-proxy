# TMDB 反向代理 · Cloudflare Worker 方案

把 `api.themoviedb.org` 和 `image.tmdb.org` 反代到你自己的域名，
解决 TMDB 图片 CDN / API 在国内访问不稳、以及前端跨域（CORS）的问题。
一份 `worker.js`，靠环境变量 `UPSTREAM_HOST` 区分上游，部署两份到不同子域名即可。

---

## 一、前置条件

1. 一个 **Cloudflare 账号**（免费版足够，每天 10 万次请求额度）。
2. 一个 **域名已接入 Cloudflare**，且该域名的 DNS 解析是「橙色云」（Proxy 开启）。
3. （可选，调 API 才需要）一个 **TMDB API Key**：
   到 https://www.themoviedb.org/settings/api 免费申请。

---

## 二、方式一：Dashboard 零安装（最快，推荐）

1. 打开 https://dash.cloudflare.com → 左侧 **Workers & Pages** → **Create** → 选 **Worker** → 起个名（如 `tmdb-img`）→ **Deploy**。
2. 进入该 Worker → **Edit code** → 把本目录 `worker.js` 全文粘贴进去 → **Save and Deploy**。
3. 进入 **Settings → Variables** → 添加变量：
   - `UPSTREAM_HOST` = `image.tmdb.org`
   - （可选）`TMDB_API_KEY` = 你的 key
   - 改完点 **Deploy** 生效。
4. 进入 **Triggers → Routes** → **Add route**：
   - Route：`img.你的域名.com/*`，Service 选刚建的 Worker。
5. 再重复 1–4 建第二个 Worker（如 `tmdb-api`），变量 `UPSTREAM_HOST` = `api.themoviedb.org`，路由 `api.你的域名.com/*`。

> 小提示：`img.你的域名.com` 和 `api.你的域名.com` 这两个子域名不需要在 DNS 里单独建记录，
> 只要在 Cloudflare 的 **DNS** 页面给根域名留一条 `A` 记录（如指向 `192.0.2.1` 占位）并开启橙色云，
> Worker 路由会优先于 DNS 生效。

---

## 三、方式二：Wrangler CLI（代码进仓库、可重复部署）

```bash
# 安装并登录
npm install -g wrangler
wrangler login

# 部署图片反代
wrangler deploy --env img
wrangler routes add "img.你的域名.com/*" --env img

# 部署 API 反代（API 通常需要 key，用 secret 存更稳）
wrangler secret put TMDB_API_KEY --env api
wrangler deploy --env api
wrangler routes add "api.你的域名.com/*" --env api
```

---

## 四、怎么用

反代后，把原 URL 的 host 换成你的子域名即可，**路径和参数原样保留**：

| 原始地址 | 反代后地址 |
| --- | --- |
| `https://image.tmdb.org/t/p/w500/abc.jpg` | `https://img.你的域名.com/t/p/w500/abc.jpg` |
| `https://api.themoviedb.org/3/movie/550?api_key=KEY` | `https://api.你的域名.com/3/movie/550?api_key=KEY` |

### 在 Jellyfin / Emby 里用
- **图片**：设置 → 库 → 元数据 → 把 TMDB 图像基础 URL 改成 `https://img.你的域名.com/`。
- **API**：TMDB 元数据提供程序里照常填你的 API Key（api 子域名只在 api.themoviedb.org 本身访问不了时才需要替换）。

### 在前端项目里用
直接 `fetch('https://api.你的域名.com/3/...')`，Worker 已放开 CORS，浏览器不再报跨域。

---

## 五、注意事项

- **免费额度**：免费版每天 10 万次请求、CPU 时间有限，个人/小团队绰绰有余；大流量请留意用量。
- **缓存**：图片在 Cloudflare 边缘缓存 1 天，API 缓存 5 分钟，能显著提速并省回源。
- **安全**：Worker 默认对所有人开放。若只给自己用，可在 `worker.js` 里加一个 `?token=xxx` 的简单校验，或用 Cloudflare Access 限制来源。
- **Key 管理**：API Key 建议用 `wrangler secret` 或 Dashboard 的「Encrypt」变量存，别明文写进仓库。
- **v4 API**：若用 TMDB v4，把 Key 以 `Authorization: Bearer xxx` 头传入即可，本 Worker 会原样透传。
