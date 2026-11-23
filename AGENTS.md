# 本项目约定

个人资源库（书签收藏）+ GitHub Pages 展示站。数据文件是唯一事实源，页面全部由它生成。

## 日常动作：用户发来新链接时

0. 用户可能已经自己在本地预览站里增删了：`npm run dev` → http://localhost:4321/resource-collector/ ，左下浮动工具条有「＋ 新增 / 发布」，每张卡片悬停出 `✎` / `✕`。那些操作直接改 `src/data/links.yaml`（唯一事实源），所以动手前先 `git status --short src/data/links.yaml` 看一眼有没有他的未提交改动，别覆盖。
1. 打开 `src/data/links.yaml`，在**文件末尾追加**（不要按类型/主题分组重排，写入顺序无所谓，页面会自己排序）：
   ```yaml
   - title: 名称
     url: https://...
     type: scholar      # 单选，10 类之一，取值见 src/data/taxonomy.json 的 types
     topics: [econ]     # 可多选，可为 []，取值见同一文件的 topics
     desc: 一句中文简介，≤120 字，说清「是什么 + 有什么用」
     added: YYYY-MM-DD  # 当天日期
   ```
2. `desc` 只写用户能验证的事实（官网自述、实际页面内容）。**不要编造**作者、机构、功能。抓不到页面内容就先问用户，或写保守描述。
3. 只有新域名的域名才需要 `npm run icons` 重新抓图标（已有域名会跳过）。
4. `npm run check && npm run build`，然后 commit + push。推送即自动部署。

## 不要做

- 不收录带登录态的控制台、付费后台、校内门户、机场/代理订阅链接；服务类只放官网首页。
- **按分面分类归类**，不要层叠：先定 `type`（资源主体是什么，不是「页面长得像什么」——一个包的官方文档站仍是 `code`，讲怎么用它才是 `doc`），再补 1–2 个 `topics`（讲什么领域）。不要为了凑满而堆主题。
- 不新建分类：先改 `src/data/taxonomy.json` 的 `types` / `topics`（id + label + hint），再加到数据里，否则 `npm run check` 与构建都报错。
- 不改 `astro.config.mjs` 的 `base`，除非仓库改名（改了两处要同步：`site` + `base`）。
- 不引入前端框架/UI 库/CDN 资源。图标走 `public/icons/`（本地文件），字体走系统栈。
- dev 编辑层必须留在 dev 里：markup 走 `import.meta.env.DEV` 条件渲染、逻辑走动态 `import('../dev/editor')`，`npm run build` 后 `dist/` 里不许出现 `dev-dialog` / `api/edit` 等任何痕迹（已验证）。
- 不把这套接进线上 Pages：那是纯静态站，没有进程可写盘。线上只读，改数据只能在本机 dev 或直接改 YAML。
- 写接口只放 `src/middleware.ts` 且首行 `if (!import.meta.env.DEV) return next()`；不要新增其他能写盘的入口。

## 关键文件

- `src/data/links.yaml` — 数据（唯一事实源）
- `src/data/taxonomy.json` — 分面词表：`types`（资源形态）/ `topics`（主题）
- `src/lib/links.ts` — 词表加载与计数、排序、搜索文本、图标表读取
- `src/pages/index.astro` — 唯一页面（含全部客户端交互脚本）
- `src/styles/global.css` — 全部样式（含深浅色变量）
- `scripts/validate.mjs` / `check-links.mjs` / `fetch-icons.mjs`
- `src/middleware.ts` — dev-only 的 `/api/meta|edit|status|publish`（构建与线上完全不生效）
- `src/lib/link-data.mjs` — YAML 序列化 / 解析 / 校验的共用实现（`scripts/validate.mjs` 也用它，两边规则不会漂移）
- `src/dev/editor.ts` + `src/dev/editor.css` — 预览站里的增删改 UI 与发布按钮，仅 dev 加载
- `.github/workflows/deploy.yml`（push 即部署）、`link-check.yml`（每周链接体检并提交结果）
