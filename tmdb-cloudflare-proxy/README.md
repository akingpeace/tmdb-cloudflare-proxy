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
| Zone 状态 | `pending` → 需改 NS 后变 `active` |

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

## ⚠️ 你还得做一步：改 NS（注册商后台）

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

可在 Cloudflare 面板 **Overview** 页看到生效进度（会提示 "Pending nameserver update"）。

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
# 等 NS 生效后执行（预期返回 TMDB API 的 JSON；401 表示没带 api_key 是正常的）
curl "https://tmdb.akingpeace.asia/3/movie/550?api_key=你的KEY"

# 图片
curl -I "https://tmdb.akingpeace.asia/t/p/w500/wrO0m0nNYkz3oEhoS6HvWmVQhSo.jpg"
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
