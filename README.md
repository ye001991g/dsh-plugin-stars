# dsh-plugin-stars

一个 DSH 插件市场索引（market index format 1），在 [awesome-dsh-plugin](https://awesome-dsh-plugin.com) 官方索引的基础上增加：

- **GitHub 星数**：卡片作者行显示 `<owner> · ★12.3k`，插件详情页同样可见；
- **按星数排序**：市场「排序」菜单出现「GitHub 星数」（默认降序，可反序）；
- **npm 下载量**：排序菜单另有「npm 下载量（近 30 天）」；
- **默认顺序 = 星数降序**：打开这个市场先看到最热的插件。

## 在市场里添加

DSH → 插件 → 发现 → 管理索引源… → 添加索引源，粘贴：

```
https://cdn.jsdelivr.net/gh/ye001991g/dsh-plugin-stars@main/index.json
```

也可以写进 profile 的 `cordis.patch.yml`（`plugin-market` 条目的 `indexes`）后重启 DSH。

## 为什么星数放在「作者」行

format 1 没有数值展示字段：卡片只渲染 标题 / 标签 / 描述 / `{version} · {author} · {date}`，排序键只用于排序、不显示。作者行因此是唯一能在卡片上带出数字的位置，本索引把 GitHub owner 与星数写进 `author`；排序用 format 1 原生支持的 `metadata.sortKeys`（`stars` / `downloads`），不需要改 DSH 客户端。

## 数据来源与刷新

- 上游：[awesome-dsh-plugin.com](https://awesome-dsh-plugin.com) 发布的 npm 包 `dsh-plugin-catalog`，每天约 04:30 UTC 更新一版：
  - `index.json` — 市场索引，范围是**已发布 npm 且有明确版本**的插件；
  - `plugins.json` — 完整精选列表（含 `stars` / `downloads` / `npm` / `install` 等字段）。
- 本仓库每天 05:10 UTC 由 GitHub Actions 重新生成 `index.json`（见 `.github/workflows/refresh.yml`），提交后调用 jsDelivr purge 接口刷新 CDN 缓存。
- 只读上游数据，不调 GitHub API、不需要 token：`scripts/build.mjs` 取两个文件、按 `homepage`（缺失时按仓库 URL）关联，写入作者行与排序键后按星数降序排列。
- 生成结果用 DSH 同款校验器 `@deepseek-ai/dsh-plugin-market-index` 校验（与运行的 DSH 版本一致 `0.2.1-rc.3`），不合法不会写盘。

## 本地重新生成

```sh
npm install
npm run build                                  # 上游最新版本
node scripts/build.mjs --version 2026.1030.12510
node scripts/build.mjs --source-dir <含 index.json 与 plugins.json 的目录>
```

## 边界

- 只包含**发布到 npm** 的插件（上游 `index.json` 的范围）；仅 GitHub 发版的条目不在其中。
- 星数与下载量是生成时刻的快照；星数为 0 也照实显示。
- 星数是**仓库级**的：同一 monorepo 里的多个包会显示同一个星数（例如 dsh-web 系列的多个包共享一个仓库）。
- 星数来自上游 `plugins.json`（由 awesome-dsh-plugin 采集），不是本站实时抓 GitHub；上游每天更新一次。
- 本仓库只是市场**元数据**。安装仍由 DSH 从 npm 拉取，并会在你的权限下运行第三方代码——装之前先核对来源（DSH 安装确认框会给出 npm 包名与版本）。
- 数据版权归上游 awesome-dsh-plugin 项目及其列出的插件作者；本仓库只做聚合与展示。

## 回滚

市场 → 管理索引源… → 删除该源；或从 profile `cordis.patch.yml` 的 `plugin-market.indexes` 中删掉这个 URL。官方源（`https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）不受影响。
