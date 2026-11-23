# 资源库 · Resource Collector

个人网络资源（书签）仓库 + 静态展示站，部署在 GitHub Pages。

- 数据：`src/data/links.yaml`（唯一需要手改的文件）
- 站点：Astro 静态构建，零客户端框架，分面筛选（类型 × 主题）/深色模式/键盘导航全部原生实现
- 输出：`/`（列表页）、`/links.json`（原始数据 API）、`/rss.xml`（最新 40 条）

## 加一条资源

编辑 `src/data/links.yaml`，在文件末尾追加（顶层是数组，不需要分组排序，页面自己排）：

```yaml
- title: JAX
  url: https://docs.jax.dev/
  type: code
  topics: [py, ml]
  desc: Google 的函数式数组计算与自动微分库，CPU/GPU/TPU 通用。
  added: 2026-02-20
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✓ | 卡片标题，≤ 80 字 |
| `url` | ✓ | `https://` 开头，不能与已有链接重复 |
| `type` | ✓ | 资源形态，**单选**，取值见下表 A |
| `topics` | ✓ | 主题，**可多选也可以为 `[]`**，取值见下表 B |
| `desc` | ✓ | 一句话说明，≤ 120 字（超了卡片会截断） |
| `added` | ✓ | `YYYY-MM-DD`，列表按它倒序排 |

分类采用**分面分类（faceted taxonomy）**：一条轴回答「这是什么」，另一条回答「讲什么」，两条轴各自独立取值、各自筛选。页面顶部两行 chips 就是这两条轴——同一行内多选取并集，跨行取交集。词表定义在 `src/data/taxonomy.json`（唯一事实源），Astro 构建与 `npm run check` 都会校验，写错取值直接报错。

**A. 类型轴 `type`（单选，10 类）**

| id | 显示名 | 范围 |
| --- | --- | --- |
| `scholar` | 学者主页 | 个人/机构主页、作者站点、研究者的资源页 |
| `paper` | 论文与预印本 | 工作论文列表、期刊聚合、文献合集 |
| `search` | 检索入口 | 文献库、学术搜索引擎、知识图谱 |
| `data` | 数据与模型 | 数据集、数据库入口、指数、预训练模型 |
| `code` | 软件包与工具 | 库、包的官方站与仓库，可安装可运行 |
| `doc` | 文档与教程 | 教程、在线书、讲义、速查手册 |
| `blog` | 博客与通讯 | 个人博客、Substack 通讯、专栏 |
| `dir` | 目录与市场 | 导航站、技能市场、评测与比价聚合 |
| `tool` | 在线小工具 | 免注册即用的单页工具 |
| `service` | 平台服务 | 需要账号或付费的在线平台 |

判断优先级：**资源的主体是什么**，而不是「页面长得像什么」。一个包的官方文档站仍是 `code`（代表那个包），讲怎么用这个包的教程才是 `doc`。

**B. 主题轴 `topics`（可多选，7 类）**

| id | 显示名 | 范围 |
| --- | --- | --- |
| `econ` | 经济金融 | 资产定价、宏观、公司金融、会计实证 |
| `metrics` | 计量方法 | 因果推断、DiD、面板、实证工作流 |
| `ml` | 机器学习 | 深度学习、强化学习、科学计算与 PDE |
| `quant` | 定量金融 | 衍生品定价、数值解、计算经济学 |
| `py` | Python | Python 生态、包与环境、数据处理 |
| `writing` | 论文写作 | LaTeX、BibTeX、排版与投稿流程 |
| `ai` | AI 与 Agent | 大模型产品、Agent 技能、提示与推理服务 |

一两条主题通常就够；主题留空合法（如 Google Scholar 这类通用检索入口）。新增取值：改 `src/data/taxonomy.json` 的 `types` / `topics` 数组（id + label + hint），否则 `npm run check` 与构建都会报错。

## 命令

```bash
npm install
npm run dev      # 本地预览 http://localhost:4321/resource-collector（带增删改）
npm run check    # 校验 links.yaml（字段、去重、日期、type/topics 白名单）
npm test         # 跑 test/ 下的单元测试与数据不变量（node --test）
npm run build    # 生成 dist/
npm run preview  # 预览构建产物
npm run links    # 手动探测全部链接可用性 → src/data/link-status.json
npm run icons    # 下载各域名 favicon 到 public/icons/（加了新域名后跑一次）
```

## 代码结构

```
src/
  data/            links.yaml（事实源）、taxonomy.json（词表）、icons.json、link-status.json
  lib/
    links.ts       读词表与数据、计数、排序、搜索文本、图标查询（服务端用）
    site.ts        site / base 的单一来源，页面与 rss 都从这里取
    link-data.mjs  YAML 序列化 / 解析 / 校验（check 脚本与 dev 端点共用，纯函数，可被 node 直接跑）
    dev-meta.mjs   抓页面 title/description 的纯逻辑（URL 归一化、实体解码、截断）
  client/filter.ts 首页交互：搜索、分面筛选、hash 深链、键盘导航、主题
  pages/           index.astro（唯一页面）、links.json.ts、rss.xml.ts
  dev/editor.ts    仅 dev 加载的增删改 UI（构建时被摇掉）
  middleware.ts    仅 dev 生效的 /api/{meta,edit,status,publish}
test/              npm test：link-data / dev-meta 单测 + 数据不变量
scripts/           validate.mjs（check）、fetch-icons.mjs、check-links.mjs
```

## 在预览站里直接增删

`npm run dev` 打开 http://localhost:4321/resource-collector/ ，左下角有一条浮动工具条：

- **＋ 新增**：填 URL，点「自动抓取标题与简介」会把页面的 `<title>` / `description` 填进去（抓不到就手写）；标题、简介、类型、主题（可多选）、日期填好后保存。
- 鼠标移到任意卡片上，右上角出现 `✎`（编辑）和 `✕`（删除），删除会二次确认。
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
