# 工作区记忆

## 2026-11-05 · TMDB 反代部署
- 任务：用 Cloudflare 让用户能正常访问 TMDB（api.themoviedb.org / image.tmdb.org）。
- 方案：**Cloudflare Worker 反向代理**，单域名 `tmdb.akingpeace.asia` 智能路径路由
  （`/t/...` 走 image.tmdb.org，其余走 api.themoviedb.org；API 返回里的 image.tmdb.org
  自动改写成当前域名，图片也走反代）。经典 service-worker 格式（该上传接口只认经典格式）。
- 通过 Cloudflare API 直接部署完成：
  - Account ID `92f49c4813df6324fafaf8ffc1278c65`（即用户最初误发的 32 位 hex）
  - 新建 zone `akingpeace.asia`（zone_id `f725e76d028ab629f84cd6e60ed31243`），分配 NS：
    `joyce.ns.cloudflare.com` / `porter.ns.cloudflare.com`
  - 上传脚本 `tmdb-proxy`，建 DNS `tmdb.akingpeace.asia`(A 192.0.2.1, 橙色云)
  - 绑路由 `tmdb.akingpeace.asia/* → tmdb-proxy`
  - 状态：zone `active`（2026-11-06 NS 改完并已生效，实测 API 返回401、图片200，代理全通）
  - DNS 迁移：已将原阿里云 A 记录 akingpeace.asia/www/mail → 47.108.183.149 及通配符
    *.akingpeace.asia → 47.108.183.149 迁入 Cloudflare（均仅DNS灰云）；tmdb 保留橙云代理(192.0.2.1)
    显式记录优先于通配符，故 tmdb 仍走 Worker
- 用户凭证：API Token `cfat_...`（敏感，建议用后删除/设短 TTL）；TMDB_API_KEY 未设置，调用时自带 `?api_key=`
- 交付文件：`tmdb-cloudflare-proxy/worker.js`、`wrangler.toml`、`README.md`、`server.js`、`tmdb-proxy.service`
- 2026-11-06 新增：服务器本地缓存代理 + 控制台（双重缓存，进一步省 CF 额度）
  - 动因：服务器连不上 TMDB（被墙）；CF Worker 边缘缓存已减少连 TMDB，但每次仍打 CF 吃额度
    → 在 47.108.183.149:8089 起 Node 服务(server.js)做本地磁盘缓存，回源 CF(tmdb.akingpeace.asia)
  - 部署：/opt/tmdb-proxy/server.js，systemd 托管 tmdb-proxy.service（active，崩溃/开机自启）
  - 控制台：http://47.108.183.149:8089/dashboard，令牌 tmdbProxY8k2（TMDB_ADMIN_TOKEN）
  - 接入：应用把 TMDB base URL 改为 http://47.108.183.149:8089（图片被改写一并走本地缓存）
  - 缓存落盘 /var/cache/tmdb-proxy，API 12h / 图片 7d；日志 /var/log/tmdb-proxy.log
  - 注意：服务器 OpenResty 是 1panel 管的(80/443)，本服务用独立 8089 端口，不冲突

## 用户偏好（贯穿）
- 每改完/做完一个任务要 commit，格式「新增了xxx, 优化了xxx, 修复了xxx」。
- 记忆文件保存在工作区根目录（MEMORY.md），每次任务开始先读，没有就新建。
- 任务多且互不影响时可并行开子线程 agent。
