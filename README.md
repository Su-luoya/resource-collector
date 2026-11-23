# 资源库 · Resource Collector

个人网络资源（书签）仓库 + 静态展示站，部署在 GitHub Pages。

- 数据：`src/data/links.yaml`（唯一需要手改的文件）
- 站点：Astro 静态构建，零客户端框架。首页是全部 95 条的卡片墙，另有四个分区页：`/scholar/`（学者主页）、`/data/`（数据）、`/packages/`（包与文档）、`/nav/`（导航与小工具）
- 输出：`/`（全部）、四个分区页、`/links.json`（原始数据 API）、`/rss.xml`（最新 40 条）

## 加一条资源

编辑 `src/data/links.yaml`，在文件末尾追加（顶层是数组，不需要分组排序，页面自己排）：

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
npm run check    # 校验 links.yaml（字段、去重、日期、分区/facets 白名单）
npm test         # 跑 test/ 下的单元测试与数据不变量（node --test）
npm run typecheck # astro check：TS / Astro 类型检查
npm run build    # 生成 dist/
npm run preview  # 预览构建产物
npm run links    # 手动探测全部链接可用性 → src/data/link-status.json
npm run icons    # 下载各域名 favicon 到 public/icons/（加了新域名后跑一次）
```

## 代码结构

```
src/
  data/            links.yaml（事实源）、taxonomy.json（分区与分类词表）、icons.json、link-status.json
  lib/
    links.ts       读词表与数据、分区过滤、计数、排序、搜索文本、徽标文案、图标查询（服务端用）
    site.ts        site / base 的单一来源，页面与 rss 都从这里取
    link-data.mjs  YAML 序列化 / 解析 / 校验（check 脚本与 dev 端点共用，纯函数，可被 node 直接跑）
    dev-meta.mjs   抓页面 title/description 的纯逻辑（URL 归一化、实体解码、截断）
  components/Catalog.astro  首页与分区页共用的骨架：导航、chips、卡片墙、dev 表单
  client/filter.ts 分面筛选：轴从 chip 的 data-facet 读、搜索、hash 深链、键盘导航、主题
  pages/           index.astro（全部）、[section].astro（四个分区页，路由由 taxonomy 生成）、links.json.ts、rss.xml.ts
  dev/editor.ts    仅 dev 加载的增删改 UI（构建时被摇掉）
  middleware.ts    仅 dev 生效的 /api/{meta,edit,status,publish}
test/              npm test：link-data / dev-meta 单测 + 数据不变量
scripts/           validate.mjs（check）、fetch-icons.mjs、check-links.mjs
```

## 在预览站里直接增删

`npm run dev` 打开 http://localhost:4321/resource-collector/ ，左下角有一条浮动工具条：

- **＋ 新增**：填 URL，点「自动抓取标题与简介」会把页面的 `<title>` / `description` 填进去（抓不到就手写）；勾分区（可多选），下方会按勾选的分区展开对应分类，逐个选好，再填日期保存。从分区页点新增会预选当前分区。
- 鼠标移到任意卡片上，右上角出现 `✎`（编辑）和 `✕`（删除），删除会二次确认。编辑时会带出这条的全部分区与分类。
- **发布**：把改动推上线。依次执行「抓缺失图标 → 校验 → commit → push」，push 后 Actions 自动部署到 Pages。commit 只包含数据文件（`src/data/links.yaml`、`src/data/icons.json`、`public/icons/`），工作区里其它改动不会被带走。工具条会显示当前状态（`已同步 master@xxxx` 或 `未发布：+1 −2 ~3`）。

改动一律写回 `src/data/links.yaml`，它仍然是唯一事实源；写盘后 Vite 会让模块失效，页面自动刷新。

**这套东西只在 `npm run dev` 里存在**：`src/middleware.ts` 的 `/api/*` 端点首行 `if (!import.meta.env.DEV) return next()`，前端逻辑用 `import.meta.env.DEV` + 动态 `import('../dev/editor')` 包着，构建时整块被摇掉。已验证 `dist/` 里没有任何编辑层痕迹——线上站是纯静态只读的，要改数据只能在本机 dev 或直接编辑 YAML。

新增一个**新域名**的条目时，图标不会自动存在；点「发布」时它会先跑 `npm run icons` 补齐缺的 favicon，再一起提交。

## 部署

推送到 `master` 即触发 `.github/workflows/deploy.yml`（`npm ci` → `check` → `build` → Pages）。
仓库 Settings → Pages 的 Source 需为 "GitHub Actions"。

站点地址：`https://<user>.github.io/resource-collector/`
（`astro.config.mjs` 里的 `site` / `base` 已按此配置；换仓库名要同步改。）

## 链接体检

`.github/workflows/link-check.yml` 每周一自动探测所有 URL，把结果写入 `src/data/link-status.json` 并提交。
返回 401/403/405/429 视为 `warn`（要登录或反爬），其余非 2xx/3xx 视为 `fail`，卡片上会出现对应角标。

## 私有链接

`raw/`（书签原始导出）已在 `.gitignore` 中；校内、付费、机场订阅类链接不要入库。
