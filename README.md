# 资源库 · Resource Collector

**站点 <https://Su-luoya.github.io/resource-collector/>**

个人书签库 + 静态展示站。数据在 Supabase（Postgres），构建前 `npm run sync` 拉到 `.cache/links.json`，页面、校验、脚本都读这份缓存。

- 首页是全部条目的卡片墙，另有 10 个分区页：`/metrics/` 计量实证、`/ml/` 机器学习、`/finance/` 金融与宏观、`/invest/` 投资与理财、`/lit/` 文献搜索、`/data/` 数据、`/tools/` 工具、`/writing/` 写作与排版、`/ai/` AI 与 Agent、`/scholar/` 学者主页
- 另有 `/links.json`（原始数据 API）与 `/rss.xml`（最新 40 条）
- 搜索按空格分词，词序不限，可与分类筛选叠加；结果旁「复制这 N 条」按页面顺序复制成 Markdown

## 加一条资源

改的都是同一份云端数据，两条路：

1. **本地预览站**（推荐）：`npm run dev` → 工具条「＋ 新增」，或地址栏的一键收录书签。写完点「发布」触发重建。
2. **Supabase 表格**：网页上直接改 `links` 表，改完在 Actions 里跑一次 Deploy（或等下一次周检）。

字段（表格列名即这些）：

```yaml
- title: "JAX"
  url: https://docs.jax.dev/
  section: [ml]
  facets:
    ml: { lang: [python], kind: fw }
  desc: "Google 的函数式数组计算与自动微分库，CPU/GPU/TPU 通用。"
  added: 2026-02-20
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✓ | 卡片标题，≤ 80 字 |
| `url` | ✓ | `https://` 开头，不能与已有链接重复 |
| `section` | ✓ | 进哪几个分区，**可多选但不能为空**，取值见 A |
| `facets` | ✓ | 各分区自己的分类，按分区嵌套，见 B |
| `desc` | ✓ | 一句话说明，≤ 120 字（超了卡片会截断） |
| `added` | ✓ | `YYYY-MM-DD`，列表按它倒序 |
| `read` | | `false` 标「待看」；不写即已看过 |
| `note` | | 详情页笔记，Markdown 子集（段落/列表/粗体/行内代码/链接） |

### 分区与分类

分类是**分面**的，每个分区有自己的词表：`section` 决定进哪几页；`facets` 按分区嵌套，只写该分区声明的轴。跨界资源两头都挂：

```yaml
- title: "Tidy Finance"
  url: https://www.tidy-finance.org/
  section: [data, metrics]
  facets:
    data: { kind: code, topic: [asset] }        # 数据页：处理代码，领域资产定价
    metrics: { kind: doc, lang: [python] }      # 计量页：教材与文档
```

词表唯一事实源是 `src/data/taxonomy.json`；多选的轴写数组（可空 `[]`），单选的写字符串。`npm run check` 与构建都会校验，写错直接报错。

**A. 分区**

| id | 显示名 | 收录范围 |
| --- | --- | --- |
| `metrics` | 计量实证 | 估计与检验的包、方法教材笔记、方法目录 |
| `ml` | 机器学习 | 深度学习框架、强化学习、训练与调参的资料 |
| `finance` | 金融与宏观 | 金融宏观的库、论文、数据集，按资产品类标 |
| `invest` | 投资与理财 | 能直接上手用的行情与申赎限额、基金筛选、回测与组合工具、理财计算器 |
| `lit` | 文献搜索 | 检索入口、论文聚合流、顶刊动态 |
| `data` | 数据 | 数据源、下载接口、指数与指标、数据集、处理代码，按领域标 |
| `tools` | 工具 | 通用库、在线小工具、平台服务、博客、导航与目录（投资类归 `invest`，AI 类归 `ai`） |
| `writing` | 写作与排版 | 写作教程、LaTeX 与参考文献样式、文献与项目管理 |
| `ai` | AI 与 Agent | 模型 API 与算力平台、AI 导航与中转评测、agent 技能目录与仓库 |
| `scholar` | 学者主页 | 研究者个人主页与工作论文 |

**B. 分类轴**

| 分区 | 轴 | 单选/多选 | 取值 |
| --- | --- | --- | --- |
| `metrics` | `kind` 形态 | 单选 | `pkg` 包、`doc` 教材与文档、`list` 目录与清单 |
| `metrics` | `lang` 语言 | 多选 | `python`、`stata`、`r`、`any`（跨语言标不限） |
| `ml` | `kind` 形态 | 单选 | `fw` 框架与库、`rl` 强化学习、`doc` 教程与课程 |
| `ml` | `lang` 语言 | 多选 | `python`、`any` |
| `finance` | `kind` 形态 | 单选 | `lib` 金融库、`data` 数据、`paper` 按方向筛的论文流（一般同时挂 `lit`） |
| `finance` | `topic` 品类 | 多选 | `asset` 资产定价、`corporate` 公司金融、`banking` 银行、`macro` 宏观、`micro` 微观结构 |
| `invest` | `kind` 形态 | 单选 | `tool` 在线工具、`data` 行情与数据、`lib` 库与框架、`doc` 教程与书、`service` 平台与服务 |
| `invest` | `market` 品种 | 多选 | `fund` 基金与 ETF、`stock` 股票、`bond` 债券与固收、`deriv` 衍生品、`overseas` 跨境与海外 |
| `lit` | `kind` 形态 | 单选 | `search` 检索入口、`stream` 论文流与聚合 |
| `data` | `kind` 形态 | 单选 | `source` 数据源、`api` 下载与接口、`index` 指数与指标、`dataset` 数据集、`code` 处理代码 |
| `data` | `topic` 领域 | 多选 | `macro` 宏观、`corporate` 公司金融、`banking` 银行、`asset` 资产定价、`micro` 微观结构、`text` 文本与另类数据、`accounting` 会计 |
| `tools` | `kind` 形态 | 单选 | `lib` 通用库、`tool` 在线小工具、`service` 平台服务、`nav` 导航与目录、`blog` 博客与通讯 |
| `writing` | `kind` 形态 | 单选 | `doc` 论文模板与格式、`style` 排版与图表指南、`manage` 文献与项目管理 |
| `ai` | `kind` 形态 | 单选 | `service` 模型 API 与算力平台、`nav` AI 导航与中转评测、`dir` 技能目录、`repo` 技能仓库 |
| `scholar` | `field` 研究领域 | 多选 | `corporate`、`banking`、`asset`、`macro`、`metrics`、`ml`、`code` |

判断依据是**资源的主体是什么**，不看页面长得像什么：包的官方文档站算该主题页的 `pkg`，讲怎么用这个包的教材才是 `doc`。分区之间平级——`data` 只放「数据本身」，金融宏观数据双挂 `finance`。`finance` 与研究向的定价库、论文、学术数据打交道，`invest` 只放把钱放出去时能直接用的东西（行情、申赎限额、筛选器、回测与计算器）；同一个工具既有研究用法又有实操入口时两头都挂。要加分区或取值，改 `taxonomy.json` 即可，页面路由与 chips 都由它生成。

## 命令

```bash
npm install
npm run dev       # 本地预览 http://localhost:4321/resource-collector（带增删改）
npm run sync      # 云端 → .cache/links.json（dev/build/check 会先自动跑）
npm run check     # 校验云端数据（字段、去重、日期、分区与 facets 白名单）
npm test          # test/ 下的单元测试与数据不变量（node --test）
npm run typecheck # astro check
npm run build     # 生成 dist/
npm run preview   # 预览构建产物
npm run links     # 探测全部链接 → link_status 表，安全的永久重定向顺带改库
npm run icons     # 抓 favicon → Supabase Storage 桶 icons（--force 强制重试，--push 只推本地已有文件）
```

## 环境变量

本地写 `.env`（已 git-ignore），Actions 里配同名 Secrets：

| 变量 | 用途 |
|---|---|
| `SUPABASE_URL` | 项目地址 `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | 只读，构建与预览站读数据 |
| `SUPABASE_SECRET_KEY` | 可写，dev 编辑与周检写库；只在本地与 Actions 里，绝不进前端 |
| `SUPABASE_DB_PASSWORD` | 可选，仅 `psql` 直连改表结构时用，dev 与 Actions 都不读 |

表结构见 `supabase/schema.sql`（三张表 + RLS：匿名只读，写只走 secret key）。

## 代码结构

```
src/
  data/taxonomy.json   分区与分类词表（数据本身在云端，构建时落到 .cache/）
  lib/
    links.ts           读词表与数据、分区过滤、计数、排序、搜索文本、徽标、图标查询
    site.ts            site / base 的单一来源
    link-data.mjs      YAML 序列化与校验（check 与 dev 端点共用，纯函数）
    link-maintenance.mjs  链接探测、永久重定向判定与自动修复
    ordering.mjs       卡片排序（置顶优先 / 纯时间序），构建期与浏览器共用
    dev-meta.mjs       抓页面 title/description（归一化、实体解码、正文提取）
    ai-draft.mjs       AI 生成：提示词组装、输出解析与词表过滤、与表单合并
    dev-task.mjs       长任务状态机（步骤 / 子项进度 / 日志 / 结果）
    icon-cache.mjs     图标失败缓存：取不到的域名 30 天内不重试
    storage.mjs        Supabase Storage 封装：图标上传 / 公开地址 / 下载（不带 node 内建）
    icon-sync.mjs      构建期把库里引用的图标从 Storage 下到 public/icons/（派生物，git-ignored）
  components/Catalog.astro  首页与分区页共用骨架：导航、chips、卡片墙、dev 表单
  client/filter.ts     分面筛选、搜索高亮、排序、最近 7 天、待看开关
  pages/               index.astro、[section].astro（9 页，路由由 taxonomy 生成）、links.json.ts、rss.xml.ts
  dev/                 仅 dev：editor.ts（增删改 / 批量导入 / 发布预览 / 查重）、task.ts、toast.ts、command-palette.ts
  middleware.ts        仅 dev 的 /api/{meta,ai-draft,batch-meta,batch-add,duplicates,duplicates-scan,edit,status,publish-preview,maintenance,recheck,publish,task}
test/                  npm test
scripts/               validate.mjs（check）、fetch-icons.mjs、check-links.mjs
```

## 预览站里的操作

`npm run dev` 打开 <http://localhost:4321/resource-collector/>，左下角浮动工具条：

| 动作 | 行为 |
|---|---|
| **＋ 新增** | 填 URL →「自动抓取标题与简介」；勾分区后按分区展开对应分类。已有同一页（含跟踪参数差异）会列候选，带 `utm_*` 时给「使用清理后的 URL」，只提示不阻断 |
| **AI 生成** | 用本机 `pi`（`PI_BIN` 可覆盖）读抓到的正文，写标题、简介与分类，并列出依据的原文片段。越出词表的取值直接丢弃，正文太少就报错。默认只填空白字段，覆盖需二次确认 |
| **批量导入** | 粘贴多行 URL（逗号也可），一次最多 20 条；先并发抓标题与简介，已存在或无效的单列原因，其余逐条确认分类后一次写入，可暂停或放弃 |
| **置顶** | 卡片上的 `☆` 点一下变 `★` 并立即写盘 |
| **勾选** | 勾多条（Shift 连选）后可批量删除，或「全部打开」（浏览器会拦多余弹窗，提示条如实报数） |
| **编辑 / 删除** | 悬停卡片右上角 `✎` / `✕`，删除后 12 秒内可撤销（撤销状态存 `sessionStorage`，重载不丢） |
| **查重** | 扫全库，只报能确定的三种重复：归一化 URL 相同、去跟踪参数后相同、同站点且标题相同；不自动合并 |
| **链接维护** | 列出 `fail` 与待确认的重定向，可打开原站、单条复查、采用新地址；`warn` 只在卡片上显示角标 |
| **发布** | 先出预览（新增/删除/修改分组、体检与图标变化），确认后按「同步 → 补图标 → 触发重建」三步打勾，可关掉对话框继续跑。发布不碰 git，最后一步是 `gh workflow run deploy.yml` |
| **⌘K** | 命令面板：新增、批量导入、链接维护、发布、聚焦搜索；`↑↓` 选择，`Enter` 执行；表单里 `⌘Enter` 保存 |

破坏性动作不弹原生 `confirm`：第一次点把文案改成「确认…」，4 秒内再点才执行。成功/失败/可撤销都走右下角提示条（最多 4 条，失败带「重试」）。

写库一律经 `api/edit`：写前整表校验，失败一个字节都不写；成功后刷新 `.cache/links.json` 并重载页面。

**这套东西只在 `npm run dev` 里存在**：`middleware.ts` 的 `/api/*` 首行 `if (!import.meta.env.DEV) return next()`，前端逻辑用 `import.meta.env.DEV` + 动态 `import('../dev/editor')` 包着，构建时整块摇掉（已核对 `dist/` 无痕迹）。线上是纯静态只读站。

图标字节存在 Supabase Storage 桶 `icons`（public read），仓库里没有图片文件：`npm run icons` 抓取并上传，`npm run sync`（dev/build/check 之前自动跑）把库里引用、本地缺失的图标下到 `public/icons/`。产物里是普通静态文件，线上不依赖任何外部服务。取不到的域名在 `icons` 表里记时间（`file` 为空），30 天内不重试；Storage 里某个对象丢了，页面退化成首字母占位，不会卡住构建。

## 浏览页上的小工具（线上也有）

- **最近 7 天**：有近 7 天新增条目时，顶部出现「最近 7 天新增 N 条 · 只看这些」，再点恢复；窗口滚动，不是自然周
- **搜索高亮**：标题与简介里命中的词包 `<mark>`，纯子串匹配，不影响筛选结果

## 部署

推到 `master` 即触发 `.github/workflows/deploy.yml`（`npm ci` → `check`（内含 `sync`：拉数据 + 下图标）→ `test` → `typecheck` → `build` → Pages）。CI 只读不写：抓图标与写库只在本机 dev 做。仓库 Settings → Pages 的 Source 需为 "GitHub Actions"。

站点：<https://Su-luoya.github.io/resource-collector/>（`astro.config.mjs` 的 `site` / `base` 已按此配置，换仓库名要同步改）。

## 链接体检

`.github/workflows/link-check.yml` 每周一探测全部 URL，写入 `link_status` 表后触发重建。401/403/405/429 记 `warn`（要登录或反爬），其余非 2xx/3xx 记 `fail`，卡片上出现角标；重定向逐跳手动跟随，保留状态码链。

只有「每一跳都是 301/308、最终 HTTPS 2xx、主机名不变、新地址未占用」时才自动改库里的 URL，其余进预览站的「链接维护」面板人工处理。

## 私有链接

`raw/`（书签原始导出）已在 `.gitignore` 中；校内、付费、机场订阅类链接不要入库。
