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
  - 状态：zone `pending`，待用户去注册商改 NS 后变 active 才真正可用
- 用户凭证：API Token `cfat_...`（敏感，建议用后删除/设短 TTL）；TMDB_API_KEY 未设置，调用时自带 `?api_key=`
- 交付文件：`tmdb-cloudflare-proxy/worker.js`、`wrangler.toml`、`README.md`

## 用户偏好（贯穿）
- 每改完/做完一个任务要 commit，格式「新增了xxx, 优化了xxx, 修复了xxx」。
- 记忆文件保存在工作区根目录（MEMORY.md），每次任务开始先读，没有就新建。
- 任务多且互不影响时可并行开子线程 agent。
