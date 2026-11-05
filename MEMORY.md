# 工作区记忆

## 2026-11-05
- 任务：帮用户用 Cloudflare 访问 TMDB（themoviedb.org / image.tmdb.org）。
- 用户选定方案：**Cloudflare Worker 反向代理**（非 WARP、非自有服务器反代）。
- 交付：`tmdb-cloudflare-proxy/` 下的 worker.js + wrangler.toml + README.md。
- 设计要点：单份 Worker 代码靠环境变量 `UPSTREAM_HOST` 区分上游（image.tmdb.org / api.themoviedb.org），
  部署两份到不同子域名（img.域名 / api.域名），图片长缓存、API 短缓存，可选注入 TMDB_API_KEY，带 CORS。
- 用户偏好：每完成一个任务/文件要 commit，格式「新增了xxx, 优化了xxx, 修复了xxx」；记忆文件放工作区根目录。
