# TMDB 反代 + 服务器本地缓存代理

一套解决 **TMDB 在国内访问不稳** 并 **尽可能减少 Cloudflare / TMDB 请求额度消耗** 的方案。

## 架构（双重缓存）

```
应用 / Jellyfin
   └─> 服务器本地缓存代理 :8089（命中即返回，不打 Cloudflare）
         └─> Cloudflare Worker 边缘缓存（命中即返回，不打 TMDB）
               └─> TMDB
```

- 服务器本身连不上 TMDB（被墙），因此回源目标是 Cloudflare 反代层 `tmdb.akingpeace.asia`；
- 本地缓存命中 → 连 Cloudflare 都不打；本地 miss、CF 命中 → 打 CF 但不打 TMDB；最坏才回源 TMDB。

## 目录

| 文件 | 说明 |
| --- | --- |
| `tmdb-cloudflare-proxy/worker.js` | Cloudflare Worker：TMDB 反代 + 边缘缓存（Cache API） |
| `tmdb-cloudflare-proxy/server.js` | 服务器本地缓存代理 + 可视化控制台（零依赖 Node） |
| `tmdb-cloudflare-proxy/tmdb-proxy.service` | systemd 托管配置（崩溃自启、开机自启） |
| `tmdb-cloudflare-proxy/README.md` | 完整部署指南（含接入方式与控制台用法） |

## 说明

- 控制台：把应用的 TMDB 基础 URL 改为 `http://<服务器IP>:8089` 即可接入；
  浏览器访问 `http://<服务器IP>:8089/dashboard` 可实时查看缓存数据与接入方。
- 详见 [tmdb-cloudflare-proxy/README.md](tmdb-cloudflare-proxy/README.md)。
