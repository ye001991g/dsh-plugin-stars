# dsh-plugin-stars

一个 DSH 插件市场索引（market index format 1），在 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 官方索引的基础上增加：

- **GitHub 星数**：卡片作者行显示 `<owner> · ★12.3k`，插件详情页同样可见；0 星/未知星只显示 owner；
- **按星数排序**：市场「排序」菜单出现「GitHub 星数」（默认降序，可反序）；
- **npm 下载量**：排序菜单另有「npm 下载量（近 30 天）」；
- **默认顺序 = 星数降序**：自动按星数排好文件，打开这个市场（或把「排序」切回「默认顺序」）即按热度排列。

## 在市场里添加

DSH → 插件 → 发现 → 管理索引源… → 添加索引源，粘贴：

```
https://cdn.jsdelivr.net/gh/ye001991g/dsh-plugin-stars@main/index.json
```

也可以写进 profile 的 `cordis.patch.yml`（`plugin-market` 条目的 `indexes`）后重启 DSH。多个索引源时，DSH 启动后默认进入 `indexes` 列表里的**第一个**。

## 为什么星数放在「作者」行

format 1 没有数值展示字段：卡片只渲染 标题 / 标签 / 描述 / `{version} · {author} · {date}`，排序键只用于排序、不显示。作者行因此是唯一能在卡片上带出数字的位置，本索引把 GitHub owner 与星数写进 `author`；排序用 format 1 原生支持的 `metadata.sortKeys`（`stars` / `downloads`），不需要改 DSH 客户端。

## 数据来源与刷新

- 上游：[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 发布的 npm 包 `dsh-plugin-catalog`，每天约 04:30 UTC 更新一版：
  - `index.json` — 市场索引，范围是**已发布 npm 且有明确版本**的插件；
  - `plugins.json` — 完整精选列表（含 `stars` / `downloads` / `npm` / `install` 等字段）。
- 本仓库每天 05:10 UTC 由 GitHub Actions 重新生成 `index.json`（见 `.github/workflows/refresh.yml`）；有变化才提交、推送，然后 purge jsDelivr 并**循环比对 CDN 字节**，CDN 一直不更新就让 job 失败。
- 只读上游数据，不调 GitHub API、不需要 token：`scripts/build.mjs` 取两个文件、按 `homepage`（缺失时按仓库 URL）关联，写入作者行与排序键后按星数降序排列。
- 生成结果用 DSH 同款校验器 `@deepseek-ai/dsh-plugin-market-index` 校验（与运行的 DSH 版本一致 `0.2.1-rc.3`），不合法不会写盘。
- 若某天上游发布的索引条数比上一版少 5% 以上，构建会直接失败而不是发布（防止上游事故把市场缩水）。

## 本地重新生成与自检

需要 Node ≥ 24（`fetch` 的代理环境变量支持）。

```sh
npm ci
npm run build                                              # 上游最新版本
node scripts/build.mjs --version 2026.1030.12510           # 锁定某一个上游版本
node scripts/build.mjs --source-dir <含 index.json 与 plugins.json 的目录>   # 离线重放

npm run verify                                             # 拉线上 index.json 并用官方校验器自检
node scripts/verify.mjs index.json                         # 或校验本地文件
```

`verify` 会检查：format=1、插件非空、`stars`/`downloads` 排序键已声明、星数降序、以及每条 `author` 里的 ★ 文本与 `sortKeys.stars` 逐一吻合（0 星不得带 ★）。

## 边界

- 只包含**发布到 npm** 的插件（上游 `index.json` 的范围）；仅 GitHub 发版的条目不在其中。
- 星数与下载量是生成时刻的快照；星数为 0 或上游未采集到时只显示 owner、不带 ★，排序按 0 / 缺失处理。
- 星数是**仓库级**的：同一 monorepo 里的多个包会显示同一个星数（例如 dsh-web 系列的多个包共享一个仓库），所以榜首含义是「仓库热」而非「插件本身热」。
- 星数来自上游 `plugins.json`（由 awesome-dsh-plugin 采集），不是本站实时抓 GitHub；上游每天更新一次。
- 本仓库只是市场**元数据**，但它决定安装目标（npm 包名+版本，或 git 仓库+commit）。当前 3,993 条全部是 npm 且没有自定义 registry，安装时仍会在你的权限下运行第三方代码——装之前先核对来源（DSH 安装确认框会给出包名与版本）。
- 数据版权归上游 awesome-dsh-plugin 项目及其列出的插件作者；本仓库只做聚合与展示。

## 回滚

市场 → 管理索引源… → 删除该源；或从 profile `cordis.patch.yml` 的 `plugin-market.indexes` 中删掉这个 URL。官方源（`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）不受影响。
