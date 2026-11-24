# 资源库 · Resource Collector

个人网络资源（书签）仓库 + 静态展示站，部署在 GitHub Pages。

- 数据：Supabase（Postgres）。构建前 `npm run sync` 把它拉到 `.cache/links.json`，页面、校验、脚本都读这份缓存
- 站点：Astro 静态构建，零客户端框架。首页是全部 95 条的卡片墙，另有四个分区页：`/scholar/`（学者主页）、`/data/`（数据）、`/packages/`（包与文档）、`/nav/`（导航与小工具）
- 输出：`/`（全部）、四个分区页、`/links.json`（原始数据 API）、`/rss.xml`（最新 40 条）

搜索支持空格分词：例如 `Python 固定效应` 会找出两个词都命中的资源，词序不限，也可以继续按分类筛选。结果数旁的「复制这 N 条」会按页面顺序把当前结果复制成 Markdown 列表，每条含标题、网址和简介。

## 加一条资源

两条路都行，改的是同一份云端数据：

1. **本地预览站**（推荐）：`npm run dev` → 工具条「＋ 新增」，或浏览器地址栏的一键收录书签。写完点「发布」触发一次重建。
2. **Supabase 表格**：网页上直接改 `links` 表（手机上也能改），改完在 Actions 里跑一次 Deploy（或等下一次周检）。

字段（表格的列名就是这些）：

```yaml
- title: "JAX"
  url: https://docs.jax.dev/
  section: [packages]
  facets:
    packages: { lang: [python], kind: pkg }
  desc: "Google 的函数式数组计算与自动微分库，CPU/GPU/TPU 通用。"
  added: 2026-02-20
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✓ | 卡片标题，≤ 80 字 |
| `url` | ✓ | `https://` 开头，不能与已有链接重复 |
| `section` | ✓ | 进哪几个分区，**可多选但不能为空**，取值见下表 A |
| `facets` | ✓ | 各分区自己的分类，按分区嵌套，见下文 |
| `desc` | ✓ | 一句话说明，≤ 120 字（超了卡片会截断） |
| `added` | ✓ | `YYYY-MM-DD`，列表按它倒序排 |
| `pin` | | `true` 时置顶：浏览时排在所有条目之前，搜索时**不**参与排序；不写就是普通条目 |

### 分区与分类

分类采用**分面分类（faceted taxonomy）**，但每个分区有自己的词表：

- `section` 决定这条资源进哪几页。跨界的两头都该出现——`tidy-finance` 既是数据处理代码（数据页），又是 R/Python 包（包与文档页），就写 `section: [data, packages]`。
- `facets` 按分区嵌套，每个分区只写它自己声明的轴。同名的 `kind` 在数据页与包页是不同的轴、不同的取值，互不干扰。

```yaml
- title: "Tidy Finance"
  url: https://www.tidy-finance.org/
  section: [data, packages]
  facets:
    data: { kind: code, topic: [asset] }        # 数据页里算「处理代码」
    packages: { lang: [r, python], kind: doc }  # 包页里算「文档与教程」
```

词表定义在 `src/data/taxonomy.json`（唯一事实源）。多选的轴写数组（一个都没有就写 `[]`），单选的轴写字符串。Astro 构建与 `npm run check` 都会校验，写错分区、轴名或取值直接报错。

**A. 分区（4 个）**

| id | 显示名 | 收录范围 |
| --- | --- | --- |
| `scholar` | 学者主页 | 研究者个人主页、论文列表与工作流笔记站 |
| `data` | 数据 | 数据源、下载接口、指数与指标、数据处理代码 |
| `packages` | 包与文档 | 能装的库与扩展，以及书、讲义一类的教程 |
| `nav` | 导航与小工具 | 博客、论文聚合、检索入口、目录站、Agent 技能、在线工具、平台服务 |

**B. 每个分区的分类轴**

| 分区 | 轴 | 单选/多选 | 取值 |
| --- | --- | --- | --- |
| `scholar` | `field` 研究领域 | 多选 | `corporate` 公司金融、`banking` 银行与金融中介、`asset` 资产定价、`macro` 宏观与货币、`metrics` 计量方法、`ml` 机器学习、`code` 研究代码与数据 |
| `data` | `kind` 形态 | 单选 | `source` 数据源、`api` 下载与 API、`index` 指数与指标、`code` 处理代码 |
| `data` | `topic` 领域 | 多选 | `macro` 宏观、`corporate` 公司金融、`banking` 银行、`asset` 资产定价、`micro` 市场微观结构、`text` 文本与另类数据、`accounting` 会计 |
| `packages` | `lang` 语言 | 多选 | `python`、`stata`、`r`、`cpp`、`tex`、`any`（跨语言工具标「不限语言」） |
| `packages` | `kind` 形态 | 单选 | `pkg` 包、`doc` 文档与教程、`cli` 命令行工具、`ext` 插件与扩展 |
| `nav` | `kind` 形态 | 单选 | `blog` 博客与通讯、`paper` 论文与文献聚合、`search` 检索入口、`dir` 目录与市场、`skill` Agent 技能、`tool` 在线小工具、`service` 平台服务 |

判断优先级：**资源的主体是什么**，而不是「页面长得像什么」。一个包的官方文档站仍算 `packages` 的 `pkg`（代表那个包），讲怎么用这个包的教程才是 `doc`。新增分区或取值：改 `src/data/taxonomy.json` 的 `sections`，页面路由与筛选 chips 都由它生成，不用改代码。

## 命令

```bash
npm install
npm run dev      # 本地预览 http://localhost:4321/resource-collector（带增删改）
npm run sync     # 从云端拉一次数据到 .cache/links.json（dev/build/check 都会自动先跑）
npm run check    # 校验云端数据（字段、去重、日期、分区/facets 白名单）
npm test         # 跑 test/ 下的单元测试与数据不变量（node --test）
npm run typecheck # astro check：TS / Astro 类型检查
npm run build    # 生成 dist/
npm run preview  # 预览构建产物
npm run links    # 探测全部链接 → link_status 表；安全的永久重定向同时改库里的 URL
npm run icons    # 下载各域名 favicon 到 public/icons/（新域名进构建时 CI 会自动跑）
```

## 环境变量

写进本地 `.env`（已 git-ignore）与 GitHub 仓库 Secrets（名字相同）：

| 变量 | 用途 |
|---|---|
| `SUPABASE_URL` | 项目地址 `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | 只读，构建与预览站读数据用 |
| `SUPABASE_SECRET_KEY` | 可写，dev 编辑与周检写库用；只在本地与 Actions secrets 里出现，绝不进前端 |

表结构在 `supabase/schema.sql`（三张表 + 行级安全：匿名只有 SELECT，写只走 secret key）。

## 代码结构

```
src/
  data/            taxonomy.json（分区与分类词表）；数据本身在云端，构建时落到 .cache/
  lib/
    links.ts       读词表与数据、分区过滤、计数、排序、搜索文本、徽标文案、图标查询（服务端用）
    site.ts        site / base 的单一来源，页面与 rss 都从这里取
    link-data.mjs  YAML 序列化 / 解析 / 校验（check 脚本与 dev 端点共用，纯函数，可被 node 直接跑）
    link-maintenance.mjs  链接探测、永久重定向判定与自动修复、维护待办（周检与 dev 端点共用）
    dev-meta.mjs   抓页面 title/description 的纯逻辑（URL 归一化、实体解码、正文提取、截断）
    ordering.mjs   卡片排序（置顶优先 / 纯时间序），构建期与浏览器共用同一份规则
    ai-draft.mjs   AI 生成的纯逻辑：提示词组装、模型输出解析与词表过滤、与表单内容合并
    dev-task.mjs   长任务状态机（发布/批量抓取的步骤、子项进度、日志、结果）
    icon-cache.mjs 图标失败缓存规则：取不到的域名 30 天内不重试
  components/Catalog.astro  首页与分区页共用的骨架：导航、chips、卡片墙、dev 表单
  client/filter.ts 分面筛选：轴从 chip 的 data-facet 读、搜索、hash 深链、键盘导航、主题
  pages/           index.astro（全部）、[section].astro（四个分区页，路由由 taxonomy 生成）、links.json.ts、rss.xml.ts
  dev/editor.ts    仅 dev 加载的增删改 UI、批量导入、发布预览、多选与命令面板、置顶星标、全库查重（构建时被摇掉）
  dev/task.ts      仅 dev：轮询任务快照并画成步骤清单 + 细进度条
  dev/toast.ts     仅 dev：右下角提示队列，可带「撤销 / 重试」
  middleware.ts    仅 dev 生效的 /api/{meta,ai-draft,batch-meta,batch-add,duplicates,duplicates-scan,edit,status,publish-preview,maintenance,recheck,publish,task}
test/              npm test：搜索、数据校验与不变量、元信息、发布重试、链接维护闭环、批量导入与发布预览、AI 生成、任务状态机、图标缓存
scripts/           validate.mjs（check）、fetch-icons.mjs、check-links.mjs
```

## 在预览站里直接增删

`npm run dev` 打开 http://localhost:4321/resource-collector/ ，左下角有一条浮动工具条：

- **＋ 新增**：填 URL，点「自动抓取标题与简介」会把页面的 `<title>` / `description` 填进去（抓不到就手写）；勾分区（可多选），下方会按勾选的分区展开对应分类，逐个选好，再填日期保存。从分区页点新增会预选当前分区。填完 URL 会即时检查：库里已有同一页（含末尾斜杠、`utm_*` 等跟踪参数差异）就列出候选并可「打开已有」，只提示不阻断；URL 带跟踪参数时给一个「使用清理后的 URL」按钮，手动点了才改写。
- **AI 生成**：在同一表单点「AI 生成标题、简介与分类」，会用本机 `pi`（`PI_BIN` 可覆盖）读取抓到的页面正文，写出标题、简介与分区/分类建议，并把用来支撑简介的原文片段列在下面。只依据页面正文，编造的依据会被丢掉并计数；越出 `taxonomy.json` 的分区或分类值直接丢弃。默认只填空白字段，想覆盖已写的内容要点第二次并确认。正文太少（纯 JS 渲染站）时会直接报错，不猜。
- **批量导入**：粘贴多行 URL（一行一条，也可用逗号分隔），一次最多 20 条。先并发抓标题与简介，已存在或无效的行单独列出原因；剩下的逐条走同一个表单确认分类，全部确认后一次性写入，中途可以「暂停」或「放弃本批」。抓取过程中对话框里显示每个 URL 的完成进度，可展开看逐条日志。
- **置顶**：每张卡片上有一个 `☆`，点一下变 `★` 并立即写盘（`pin: true`），页面重排后它排在最前；再点一次取消。手改 YAML 加 `pin: true` 效果相同。
- **全部打开**：勾选多条卡片后，浮条上的「全部打开」逐个打开原站。浏览器会拦掉第一次之外的弹窗，提示条会如实报出被拦的条数，允许本站弹窗后重试即可。
- **全库查重**：工具条上的「查重」（或 ⌘K 里的「全库查重」）扫一遍全库，只报三种能确定的重复——归一化后 URL 相同、去掉跟踪参数后相同、同站点且标题相同——每组列出地址并可直接打开，不做自动合并。
- 鼠标移到任意卡片上，右上角出现 `✎`（编辑）和 `✕`（删除），点了直接删，右下角留 12 秒可撤销的提示。编辑时可修改 URL，并带出这条的全部分区与分类。卡片底部还有一个勾选框：勾多条（Shift 可连选）后底部出现「已选 N 条」，可一次批量删除。写盘会让页面自动重载，所以撤销提示存在 `sessionStorage` 里，重载后照样在（剩余时间照算）；点「撤销」就把条目原样加回去。
- **反馈**：成功、失败、可撤销都用右下角的提示条（不打断操作、可堆叠、最多 4 条、历史可在面板里翻），失败带「重试」按钮。
- **两步确认**：真正的破坏性动作（如「放弃本批草稿」）不弹原生 `confirm`，而是第一次点只把按钮文案改成「确认…」，4 秒内再点才执行。
- **⌘K 命令面板**：列出新增、批量导入、链接维护、发布、聚焦搜索与重新加载；`↑↓` 选择、`Enter` 执行、`Esc` 关闭。表单里 `⌘Enter` 直接保存。
- **链接维护**：集中列出首次出现的 `fail` 与需要人工确认的重定向，按失效优先排序。可以打开原站、单条复查、采用新地址或编辑替代地址；`warn` 仍只显示卡片角标。采用或修改 URL 时会校验重复，并同步清理旧体检状态。
- **发布**：先弹发布预览，按新增 / 删除 / 修改分组列出具体条目（改 URL 且标题唯一时算「修改」，会显示前后值），再提示体检状态与图标变化。确认后对话框不关，按「同步 → 补图标 → 触发重建」三步实时打勾，补图标那一步显示「3/24 个域名」并可展开日志；关掉对话框任务仍在跑，工具条会显示当前步骤；即使 Vite 因为图标落盘重载了页面，这个任务的进度（含已完成的结果）也会自动接回来。发布不再碰 git：数据已经在库里，最后一步是 `gh workflow run deploy.yml`，约 1 分钟后线上更新。
- **重试推送**：如果提交成功但推送失败，刷新后仍能看到待推送状态。没有新数据改动时，重试只推送已有提交，不抓图标、不重复提交。工具条按最近一次 fetch / push 的本地记录判断同步状态；远端若已更新，先在终端同步，不会自动合并或强推。

## 浏览页上的两个小工具（线上也有）

- **最近 7 天**：库里有最近 7 天新增的条目时，顶部会出现一条「最近 7 天新增 N 条 · 只看这些」，点一下只显示这些，再点恢复。窗口是滚动的 7 天，不是自然周。
- **搜索高亮**：搜索框里输入的词在标题与简介里命中时包一层 `<mark>`；纯子串匹配，不做分词，也不影响筛选结果。

改动一律经 `api/edit` 写回云端 `links` 表（写前整表校验，失败就一个字节都不写），成功后 `refreshCache` 刷新 `.cache/links.json`，页面随即是新的。

**这套东西只在 `npm run dev` 里存在**：`src/middleware.ts` 的 `/api/*` 端点首行 `if (!import.meta.env.DEV) return next()`，前端逻辑用 `import.meta.env.DEV` + 动态 `import('../dev/editor')` 包着，构建时整块被摇掉。已验证 `dist/` 里没有任何编辑层痕迹——线上站是纯静态只读的，要改数据只能在本机 dev，或直接在 Supabase 表格里改再触发一次重建。

新增一个**新域名**的条目时，图标不会自动存在；发布时会先跑 `npm run icons` 补齐缺的 favicon。取不到图标的域名在 `icons` 表里记下时间（`file` 为空），30 天内不再重试——发布里最贵的二十多秒几乎都花在反复重试这些站点上；想手动再试一次就 `npm run icons -- --force`。

## 部署

推送到 `master` 即触发 `.github/workflows/deploy.yml`（`npm ci` → `check` → `build` → Pages）。
仓库 Settings → Pages 的 Source 需为 "GitHub Actions"。

站点地址：`https://<user>.github.io/resource-collector/`
（`astro.config.mjs` 里的 `site` / `base` 已按此配置；换仓库名要同步改。）

## 链接体检

`.github/workflows/link-check.yml` 每周一自动探测所有 URL，把结果写入 `src/data/link-status.json`。
返回 401/403/405/429 视为 `warn`（要登录或反爬），其余非 2xx/3xx 视为 `fail`，卡片上会出现对应角标。重定向逐跳手动跟随，因此能保留状态码链，而不只是最终地址。

只有同时满足「每一跳都是 301/308、最终 HTTPS 2xx、主机名不变、新地址未占用」时，脚本才会自动改库里的 URL。临时/混合、跨主机重定向不自动改；这些和 `fail` 会进入本地预览站的「链接维护」面板。周检结束后把结果写进 `link_status` 表，再触发一次重建让状态上线——不再提交任何文件。

## 私有链接

`raw/`（书签原始导出）已在 `.gitignore` 中；校内、付费、机场订阅类链接不要入库。
