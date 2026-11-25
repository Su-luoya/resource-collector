# 本项目约定

个人资源库（书签收藏）+ GitHub Pages 展示站。数据在 Supabase（Postgres），构建时拉成 `.cache/links.json`，页面全部由它生成。

## 日常动作：用户发来新链接时

0. 用户可能已经自己在本地预览站里增删了：`npm run dev` → http://localhost:4321/resource-collector/ ，左下浮动工具条有「＋ 新增 / 发布」，每张卡片悬停出 `✎` / `✕`。那些操作**直接写云端**，本地只留一份缓存（`.cache/links.json`，git-ignored）。动手前先 `npm run sync` 拉一次最新数据，再按缓存内容判断，别覆盖用户刚改的东西。
1. 写入走 dev 接口（`api/edit`，`action: add`），或告诉用户去 Supabase 表格里直接加。字段：
   ```yaml
   - title: "名称"
     url: https://...
     section: [scholar]            # 可多选，不能为空；9 个分区见 taxonomy.json 的 sections
     facets:                       # 按分区嵌套，每个分区只写它自己声明的轴
       scholar: { field: [asset] } # field 多选；data/finance 用 kind/topic，metrics/ml 用 kind/lang，tools/writing/skill/lit 用 kind
     desc: "一句中文简介，≤120 字，说清「是什么 + 有什么用」"
     added: YYYY-MM-DD             # 当天日期
     pin: true                     # 可选：置顶（浏览时排最前；搜索时不参与排序）
     read: false                   # 可选：待看。数据里没这个字段就是「已看过」
     note: |                       # 可选：详情页里的笔记，Markdown 子集（段落/列表/粗体/行内代码/链接）
       - 为什么收它
       - 关键结论
   ```
2. `desc` 只写用户能验证的事实（官网自述、实际页面内容）。**不要编造**作者、机构、功能。抓不到页面内容就先问用户，或写保守描述。
3. 新域名的图标由发布时的 `npm run icons` 或 CI 自动补，不需要手动跑。
4. `npm run check && npm run build` 验证，然后 commit + push 代码（数据不在 git 里）。改完数据后点「发布」或跑 `gh workflow run deploy.yml` 让线上更新。

## 不要做

- 不收录带登录态的控制台、付费后台、校内门户、机场/代理订阅链接；服务类只放官网首页。
- **按分面分类归类**，不要层叠：先定 `section`（进哪几页，可多值——tidy-finance 既是数据处理代码又是包，就 `[data, metrics]`），再写该分区的 `facets`。分区按主题切分（计量实证 / 机器学习 / 金融与宏观 / 文献搜索 / 数据 / 工具 / 写作与汇报 / agent skill / 学者主页，平级），判断优先级是「资源主体是什么」，不是「页面长得像什么」——一个包的官方文档站算它所属主题页的 `pkg`，讲怎么用它才是 `doc`；金融宏观的数据双挂到 `finance`。
- 不新建分区或分类：先改 `src/data/taxonomy.json` 的 `sections`（id + label + hint + badge + facets），再加到数据里，否则 `npm run check` 与构建都报错。分区页路由由它生成，加第 10 块不用写新页面。
- 学者页的 `field` 判不出来就留 `[]`，不要为了填满而编造研究方向。
- 置顶与「最近 7 天」只是浏览层的视图，不新增分区、不改卡片结构；置顶靠 `pin: true` 一个字段，`added` 仍是收录日期（不改成「最后修改」）。
- 详情页地址由 URL 派生（`src/lib/slug.mjs` 的 `slugMap`），YAML 里**不存 slug 字段**：改 URL 就等于换地址，同一个地址永远得到同一个 slug（撞车按 URL 排序补 `-2`，与行序无关）。
- 笔记 `note` 只渲染 Markdown 子集，渲染前先转义 HTML、链接只认 http(s)；不要为了排版去引 markdown 库或写 HTML。
- 采集/一键收录只调 `api/meta`（响应里带 `rules` 落点建议），建议来自 `src/lib/link-rules.mjs` 的域名规则表（命中才给分区与分类，认不出就是空）；「落点建议」不能猜。
- 不改 `astro.config.mjs` 的 `base`，除非仓库改名（改了两处要同步：`site` + `base`）。
- 不引入前端框架/UI 库/CDN 资源。图标走 `public/icons/`（本地文件），字体走系统栈。
- dev 编辑层必须留在 dev 里：markup 走 `import.meta.env.DEV` 条件渲染、逻辑走动态 `import('../dev/editor')`（`task` / `toast` / `command-palette` 同理，由 editor 再动态引入），`npm run build` 后 `dist/` 里不许出现 `dev-dialog` / `api/edit` 等任何痕迹（已验证）。
- 不把这套接进线上 Pages：那是纯静态站，没有进程可写盘。线上只读，改数据只能在本机 dev 或在 Supabase 表格里改（改完触发一次重建）。
- 写接口只放 `src/middleware.ts` 且首行 `if (!import.meta.env.DEV) return next()`；不要新增其他能写盘的入口。
- AI 生成不得用页面之外的知识：`api/ai-draft` 只把抓到的正文交给模型，越出词表的分区/分类与正文里找不到的「依据」必须被丢弃；默认只填空白字段，不覆盖已写内容。
- 长任务一律走任务表：`api/publish` / `api/batch-meta` 立即返回 `{ ok, id }`，进度靠 `GET api/task?id=` 轮询快照（步骤 + `progress` + `log`）。不要改回阻塞式等待——前端进度条只认这个契约。
## 关键文件

- `supabase/schema.sql` — 表结构（links / link_status / icons + RLS：宓名只读，写只走 secret key）
- `src/lib/cloud.mjs` / `cloud-sync.mjs` — 行 ↔ 内部对象的转换、PostgREST 封装、`.cache/links.json` 的拉取与写入
- `src/data/taxonomy.json` — 分区与分类词表：`sections`（分区 → 各自的 facets 轴与取值，`badge` 指定卡片徽标用哪条轴）
- `src/lib/links.ts` — 词表加载、分区过滤与计数、徽标文案、排序（转出 `compareNewest`/`comparePinned`）、搜索文本、图标表读取
- `src/lib/ordering.mjs` — 卡片排序规则：置顶优先 + 时间倒序、同日期按标题；浏览页与 `filter.ts` 的卡片重排共用同一份实现
- `src/components/Catalog.astro` — 首页与分区页共用的页面骨架（导航 / chips / 卡片墙 / dev 表单）
- `src/pages/index.astro` — 全部条目；`src/pages/[section].astro` — 9 个分区页（路由由 taxonomy 生成）
- `src/client/filter.ts` — 客户端筛选：轴从 chip 的 `data-facet` 读，首页只有 section 一条轴；还负责卡片重排、搜索高亮、最近 7 天开关、待看开关
- `src/client/search.ts` — 搜索框解析：分面前缀（`#scholar` 之类）、`domain:`、`is:`、`unread` 伪轴，以及标题/简介/域名的匹配与排序
- `src/pages/l/[slug].astro` — 每条资源的详情页（95 页，由 slug 派生）；`src/lib/slug.mjs` 负责生成地址，`src/lib/note.mjs` 负责笔记的 Markdown 子集渲染
- `src/pages/sitemap.xml.ts` — 静态 sitemap（首页 / 9 个分区 / 每条资源详情页）
- `src/styles/global.css` — 全部样式（含深浅色变量）
- `scripts/validate.mjs` / `check-links.mjs` / `fetch-icons.mjs`（图标脚本的失败缓存规则在 `src/lib/icon-cache.mjs`）
- `src/middleware.ts` — dev-only 的 `/api/meta|ai-draft|batch-meta|batch-add|duplicates|duplicates-scan|import-bookmarks|edit|status|publish-preview|maintenance|recheck|publish|task`（构建与线上完全不生效；`api/meta` 的响应里带 `rules` 落点建议）
- `src/lib/dev-task.mjs` — 长任务状态机（步骤 / 子项进度 / 日志 / 结果 / 清理），`middleware.ts` 与 `src/dev/task.ts` 共用同一份快照形状
- `src/lib/link-data.mjs` — 键规范化、URL 规范化与行校验（section + 嵌套 facets）的共用实现（`src/middleware.ts` 与 `scripts/validate.mjs` 都用它，两边规则不会漂移）
- `src/lib/link-maintenance.mjs` — 链接探测、永久重定向自动修复与维护待办，周检脚本和 dev 单条复查共用
- `src/lib/link-quality.mjs` — 新增/编辑时的相似重复候选、跟踪参数清理建议，以及全库查重 `scanDuplicates`（都只提示，不改数据）
- `src/lib/icon-cache.mjs` — 图标失败缓存规则（取不到图标的域名 30 天内不重试，`--force` 可强刷）
- `src/lib/ai-draft.mjs` — 「AI 生成标题/简介/分类」的提示词、输出解析与词表过滤、与表单合并（纯函数，模型调用在 middleware 的 `api/ai-draft`，走本机 `pi` 子进程）
- `src/lib/link-rules.mjs` — 采集用的域名规则表（`suggestFor`）：arxiv/ssrn/nber 等 → `lit/stream`、scholar.google → `lit/search`、fred/kaggle → `data`、pypi/npm 等注册表 → `tools/lib`、substack/medium → `tools/blog`，认不出返回 `null`；规则命中只给分区与分类，不给简介
- `src/lib/bookmarks-html.mjs` — 浏览器书签 HTML 的解析（`parseBookmarks` → `{ items, skipped, total }`）与标题清洗（`tidyTitle`），导入前只产草稿不写盘
- 「收录书签」：dev 工具条的 `#dev-capture` 在 `src/dev/editor.ts` 里现场拼一段 `javascript:`，把当前页地址与标题用 `?add=&title=` 带回预览站；页面载入时读到这两个参数就直接开新增表单。没有服务端参与，也没有单独的脚本文件
- `src/dev/editor.ts` + `src/dev/editor.css` — 预览站里的增删改 UI、批量导入、发布预览与 AI 生成按钮、卡片多选与撤销、笔记编辑器、书签导入，仅 dev 加载
- `src/dev/task.ts` / `src/dev/toast.ts` / `src/dev/command-palette.ts` — 仅 dev：任务进度渲染、右下角提示队列（可带撤销/重试）、⌘K 命令面板
- `.github/workflows/deploy.yml`（push 即部署）、`link-check.yml`（每周链接体检并提交结果）
