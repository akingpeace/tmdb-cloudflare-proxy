# TMDB 反向代理 · Cloudflare Worker（已部署）

通过 Cloudflare Worker 把 `api.themoviedb.org` 和 `image.tmdb.org` 反代到
**`tmdb.akingpeace.asia`**，解决 TMDB 国内访问不稳 + 前端跨域（CORS）问题。
单域名智能路由：路径 `/t/...` 走图片 CDN，其余走 API，并把 API 返回里的图片地址
自动改写成当前域名，图片也一并走反代。

---

## 已部署信息（2026-11-05）

| 项目 | 值 |
| --- | --- |
| Account ID | `92f49c4813df6324fafaf8ffc1278c65` |
| Zone ID (akingpeace.asia) | `f725e76d028ab629f84cd6e60ed31243` |
| Worker 脚本名 | `tmdb-proxy`（经典 service-worker 格式） |
| 路由 | `tmdb.akingpeace.asia/* → tmdb-proxy` |
| DNS 记录 | `tmdb.akingpeace.asia` A `192.0.2.1`（橙色云 / 已代理） |
| Zone 状态 | `active`（NS 已生效，2026-11-06 实测通过） |

> 代码已用 Cloudflare API 直接推送，无需再手动粘贴。
> 经典格式（`addEventListener('fetch', ...)`），因为该脚本上传接口只接受经典格式。

### DNS 记录（已从阿里云迁入 Cloudflare）
改 NS 后，原阿里云"云解析"的记录会失效，已全部在 Cloudflare 重建，避免站点/服务断联：

| 记录 | 值 | 云 |
| --- | --- | --- |
| `akingpeace.asia` (A) | `47.108.183.149` | 仅 DNS（灰） |
| `*.akingpeace.asia` (A 通配符) | `47.108.183.149` | 仅 DNS（灰） |
| `www.akingpeace.asia` (A) | `47.108.183.149` | 仅 DNS（灰） |
| `mail.akingpeace.asia` (A) | `47.108.183.149` | 仅 DNS（灰） |
| `tmdb.akingpeace.asia` (A) | `192.0.2.1` | 代理（橙，走 Worker） |

> 说明：`tmdb` 子域故意保留为 Worker 代理，不能指向你的服务器 IP，否则 TMDB 反代失效；
> 通配符 `*` 兜底其余所有子域指向服务器 `47.108.183.149`（显式记录优先于通配符，故 `tmdb` 仍走代理）。

---

## ✅ 改 NS 步骤（已完成 · 2026-11-06 NS 已生效）

域名要真正跑起来，必须把解析服务器改成 Cloudflare 分配的这两个：

```
joyce.ns.cloudflare.com
porter.ns.cloudflare.com
```

步骤：
1. 登录你的域名注册商（Namecheap / 阿里云 / GoDaddy / 腾讯云 等）。
2. 找到 `akingpeace.asia` 的 **Nameserver / DNS 服务器** 设置。
3. 改成上面两个 Cloudflare NS（删掉原来的，换上这俩）。
4. 保存。NS 全球生效通常几分钟~24 小时，生效后 Cloudflare 里 zone 状态会从
   `pending` 变 `active`，代理即可用。

> ✅ **实测记录（2026-11-06）**：阿里云 NS 已切换为 Cloudflare，zone 状态已变 `active`。
> 实测 `tmdb.akingpeace.asia/3/movie/550` 返回 401（链路通，仅缺 api_key），
> 图片端点 `/t/p/w500/真实海报.jpg` 返回 200，代理全部正常。

---

## 怎么用

NS 生效后，把原 URL 的 host 换成 `tmdb.akingpeace.asia`，路径和参数原样保留：

| 原始地址 | 反代后地址 |
| --- | --- |
| `https://api.themoviedb.org/3/movie/550?api_key=KEY` | `https://tmdb.akingpeace.asia/3/movie/550?api_key=KEY` |
| `https://image.tmdb.org/t/p/w500/abc.jpg` | `https://tmdb.akingpeace.asia/t/p/w500/abc.jpg` |

- **API**：调用时自己带 `?api_key=你的KEY`（或在 Cloudflare Worker 的
  Settings → Variables 里加一个名为 `TMDB_API_KEY` 的变量，让 Worker 统一注入）。
- **图片**：API 返回的 JSON 里 `image.tmdb.org` 已被自动改写成你的域名，前端直接拿即可。
- **Jellyfin / Emby**：元数据里把 TMDB 图像基础 URL 设为 `https://tmdb.akingpeace.asia/` 即可。
- **前端**：Worker 已放开 CORS，浏览器可直连 `fetch('https://tmdb.akingpeace.asia/3/...')`。

---

## 验证

```bash
# 已生效，实测：无 key 返回 401（链路正常），带 key 返回 JSON
curl "https://tmdb.akingpeace.asia/3/movie/550?api_key=你的KEY"

# 图片（已实测返回 200）
curl -I "https://tmdb.akingpeace.asia/t/p/w500/or06FN3Dka5tukK1e9sl16pB3iy.jpg"
```

---

## 管理 / 二次修改

- 改代码：编辑 `worker.js` 后，用 API 重传：
  ```bash
  curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCT/workers/scripts/tmdb-proxy" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/javascript" \
    --data-binary @worker.js
  ```
- 也可用 Wrangler（`wrangler deploy`，会自动识别经典格式），但当前脚本由 API 管理，
  用 API 重传最稳。
- 加 API Key 变量：Cloudflare 面板 → Workers & Pages → tmdb-proxy → Settings → Variables →
  添加 `TMDB_API_KEY`。

---

## 注意事项

- **免费额度**：每天 10 万次请求，个人/小团队够用。
- **缓存**：图片边缘缓存 1 天，API 缓存 5 分钟，提速且省回源。
- **安全**：Worker 当前对所有人开放。若只自用，可在 `worker.js` 里加 `?token=xxx` 校验，
  或用 Cloudflare Access 限制来源。
- **Token 安全**：本次用的 API Token 是敏感凭证，建议用完后到
  `dash.cloudflare.com/profile/api-tokens` 删掉或设短 TTL。

---

## 服务器本地缓存代理 + 控制台（2026-11-06 新增）

服务器本身**连不上 TMDB**（被墙），所以 CF Worker 那层边缘缓存只解决了"少连 TMDB"，
但每次应用请求仍会打到 Cloudflare（吃 10 万/天的额度）。为**进一步减少 Cloudflare 访问次数**，
在服务器本地又加了一层磁盘缓存代理 + 可视化控制台，形成「双重缓存」：

```
应用/Jellyfin → 服务器 :8089（本地缓存，命中不打 CF）
             → tmdb.akingpeace.asia（CF 边缘缓存，命中不打 TMDB）
             → TMDB
```

- 程序：`server.js`（零依赖 Node，同一个进程兼做缓存代理与控制台）
- 托管：`tmdb-proxy.service`（systemd，崩溃自启 + 开机自启，状态 `active`）
- 服务地址：`http://<服务器IP或内网IP>:8089`
- 控制台：`http://<服务器IP>:8089/dashboard`，输入令牌即可看实时缓存数据 + 接入方
  - 令牌：`tmdbProxY8k2`（见 `tmdb-proxy.service` 的 `TMDB_ADMIN_TOKEN`，可自行修改）
- 接入方式：把你的应用（Jellyfin/Emby/自建服务）的 TMDB 基础 URL 改成
  `http://<服务器IP>:8089`；JSON 里的图片地址会被改写成该地址，图片也一并走本地缓存。
- 缓存策略：API 缓存 12h、图片缓存 7d；缓存落盘 `/var/cache/tmdb-proxy`，重启不丢。
- 日志：`/var/log/tmdb-proxy.log`

> 关键点：服务器回源目标是 `tmdb.akingpeace.asia`（CF 层，服务器能连），**不是直连 TMDB**。
> 若要从公网或其他机器访问 `:8089`，需在阿里云安全组放行 8089 入站规则。

### 🌐 通过域名免 IP/端口访问（2026-11-06 完成）

为免去"记 IP + 记端口"，已新增 **`console.akingpeace.asia`** 域名，经过 Cloudflare 橙云
（无需 IP、无需端口、自动 HTTPS）直达控制台与缓存代理：

```
浏览器 → console.akingpeace.asia（Cloudflare 橙云）
       → 服务器 OpenResty(:80/:443)
       → 127.0.0.1:8089（server.js）
       → tmdb.akingpeace.asia（CF 边缘缓存）→ TMDB
```

- 控制台：`https://console.akingpeace.asia/dashboard`（令牌同上 `tmdbProxY8k2`）
- 统计 API：`https://console.akingpeace.asia/api/stats?token=tmdbProxY8k2`
- 同时该域名也兼做 TMDB 缓存代理入口（把应用基础 URL 改成
  `https://console.akingpeace.asia` 即可，图片地址会自动改写成该域名）

实现要点：
- Cloudflare DNS：新增 `console.akingpeace.asia` A 记录 → `47.108.183.149`，**橙色云（已代理）**。
- 服务器侧反代配置：`console.akingpeace.asia.conf`，放在
  `/opt/1panel/www/conf.d/`（该目录 bind 挂载进 OpenResty 容器
  `1Panel-openresty-AFOK` 的 `/usr/local/openresty/nginx/conf/conf.d/`，改完需在容器内
  `nginx -t && nginx -s reload`）。
- 证书：zone SSL 模式为 `full`，故源站用**自签证书**即可（Cloudflare 接受任意证书）。
  证书位于 `/opt/1panel/www/sites/console.akingpeace.asia/ssl/`
  （fullchain.pem / privkey.pem，含 SAN `console.akingpeace.asia` 与 `*.akingpeace.asia`）。
- `server.js` 已修正：JSON 里图片地址的协议改为读取 `X-Forwarded-Proto`（Cloudflare 回源带
  `https`），避免公网下出现 `http://` 混合内容被浏览器拦截。
