# dsh-plugin-stars

一个 DSH 插件市场索引（market index format 1），在 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 社区精选索引的基础上增加：

- **GitHub 星数**：卡片作者行显示 `<owner> · ★12.3k`，插件详情页同样可见；0 星/未知星只显示 owner；
- **按星数排序**：市场「排序」菜单出现「GitHub 星数」（默认降序，可反序）；
- **npm 下载量**：排序菜单另有「npm 下载量（近 30 天）」；
- **默认顺序 = 星数降序**：文件已按星数排好，打开这个市场（或把「排序」切回「默认顺序」）即按热度排列。

## 在市场里添加

DSH → 插件 → 发现 → 管理索引源… → 添加索引源，粘贴：

```
https://cdn.jsdelivr.net/gh/ye001991g/dsh-plugin-stars@main/index.json
```

也可以写进 profile 的 `cordis.patch.yml`（`plugin-market` 条目的 `indexes`）后重启 DSH。DSH 启动后会默认选中 `indexes` 的第一个源：想一进来就看到星数榜，就把这个 URL 放在列表第一位。

> 发现页里「添加索引源」走 Host 的默认抓取超时（15 秒），本索引压缩后约 1 MB、通常够用；如果在慢网络下报读取失败，改用 profile 配置（那里已把超时设为 60 秒）或重试。

## 为什么星数放在「作者」行

format 1 没有数值展示字段：卡片只渲染 标题 / 标签 / 描述 / `{version} · {author} · {date}`，排序键只用于排序、不显示。作者行是唯一合适的元信息槽位，因此把 GitHub owner 与星数写进 `author`（上游索引本来没有 author，属于纯增量）；排序用 format 1 原生支持的 `metadata.sortKeys`（`stars` / `downloads`）。不需要改 DSH 客户端，DSH 升级也不会失效。

## 数据来源与刷新

- 上游：[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 发布的 npm 包 `dsh-plugin-catalog`，每天约 04:30 UTC 更新一版：
  - `index.json` — 市场索引，范围是**已发布 npm 且有明确版本**的插件；
  - `plugins.json` — 完整精选列表（含 `stars` / `downloads` / `npm` / `install` 等字段）。
- 本仓库每天 05:10 / 08:10 UTC 由 GitHub Actions 重新生成 `index.json`（见 `.github/workflows/refresh.yml`）；有变化才提交、推送，然后 purge jsDelivr 并**循环比对 CDN 字节**，CDN 一直不更新就让 job 失败。
- 只读上游数据，不调 GitHub API、不需要 token：`scripts/build.mjs` 取两个文件、按 `homepage`（缺失时按仓库 URL）关联，写入作者行与排序键后按星数降序排列。同一仓库出现多份上游快照时取最大值，保证一个仓库只显示一个星数。
- 生成结果用 DSH 同款校验器 `@deepseek-ai/dsh-plugin-market-index` 校验（与运行的 DSH 版本一致 `0.2.1-rc.3`），不合法不会写盘。
- 构建有 3 道守卫，防止上游事故被自动发布：条数比上一版缩水 >5%、关联率 <90%、或有关联但带星条目 <90%，都会让构建直接失败。

## 本地重新生成与自检

需要 Node ≥ 22.21；本机直连慢/不通时必须让 Node 的 fetch 读代理（`NODE_USE_ENV_PROXY` 必须在**进程启动前**设置，脚本里再设无效）：

```sh
# bash / macOS / Linux
NODE_USE_ENV_PROXY=1 npm ci
NODE_USE_ENV_PROXY=1 npm run build

# PowerShell
$env:NODE_USE_ENV_PROXY="1"; npm ci; npm run build

# 或者用 Node 自带开关
node --use-env-proxy scripts/build.mjs --version 2026.1030.12510   # 锁定某个上游版本
node scripts/build.mjs --source-dir <含 index.json 与 plugins.json 的目录>   # 离线重放

NODE_USE_ENV_PROXY=1 npm run verify            # 拉线上 index.json 并自检
node scripts/verify.mjs index.json             # 或校验本地文件
```

`verify` 会检查：format=1、插件非空、`stars`/`downloads` 排序键已声明、星数降序、以及每条 `author` 里的 ★ 文本与 `sortKeys.stars` 逐一吻合（0 星不得带 ★）。CI 在每次生成后也会跑一遍 `verify index.json`。

## 边界

- 只包含**发布到 npm** 的插件（上游 `index.json` 的范围）；仅 GitHub 发版的条目不在其中。
- 星数与下载量是上游采集时刻的快照（实测比 GitHub 实时值滞后 ≤1.8%、约一天内），0/低星值也可能小幅变化；星数为 0 或上游未采集到时只显示 owner、不带 ★。
- 星数是**仓库级**的：同一 monorepo 里的多个包显示同一个仓库星数（取上游各条目中的最大值），所以榜首含义是「仓库热」而非「插件本身热」。
- 本仓库只是市场**元数据**，但它决定安装目标（npm 包名+版本，或 git 仓库+commit）。当前 3,993 条全部是 npm 且没有自定义 registry，安装时仍会在你的权限下运行第三方代码——装之前先核对来源（DSH 安装确认框会给出包名与版本）。
- 数据版权归上游 awesome-dsh-plugin 项目及其列出的插件作者；本仓库只做聚合与展示。

## 为什么不用 pin 版本的 CDN URL

`@main` + 每日提交 + purge 是这个「每天更新」索引的正确取舍：URL 稳定、可复现性由索引描述里的 `Upstream <version>` 提供锚点，需要审计某一天的产物时用 `--version` / `--source-dir` 重放。jsDelivr 对分支引用有约 12 小时边缘缓存，所以每天变更后必须 purge（workflow 已做并验证）。

## 回滚

市场 → 管理索引源… → 删除该源；或从 profile `cordis.patch.yml` 的 `plugin-market.indexes` 中删掉这个 URL。上游源（`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）不受影响。
