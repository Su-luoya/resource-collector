# 资源库 · Resource Collector

个人网络资源（书签）仓库 + 静态展示站，部署在 GitHub Pages。

- 数据：`src/data/links.yaml`（唯一需要手改的文件）
- 站点：Astro 静态构建，零客户端框架，搜索/标签筛选/深色模式/键盘导航全部原生实现
- 输出：`/`（列表页）、`/links.json`（原始数据 API）、`/rss.xml`（最新 40 条）

## 加一条资源

编辑 `src/data/links.yaml`，在 `links:` 下追加：

```yaml
- title: JAX
  url: https://docs.jax.dev/
  desc: Google 的函数式数组计算与自动微分库，CPU/GPU/TPU 通用。
  tags: [python, ml]
  added: 2026-02-20
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | ✓ | 卡片标题，≤ 80 字 |
| `url` | ✓ | `https://` 开头，不能与已有链接重复 |
| `desc` | ✓ | 一句话说明，≤ 120 字（超了卡片会截断） |
| `tags` | ✓ | 1 个或多个，取值见下表 |
| `added` | ✓ | `YYYY-MM-DD`，列表按它倒序排 |

**标签白名单**（定义在 `src/lib/links.ts` 的 `TAGS`，新增标签要先在那里登记，否则构建报错）：

| id | 显示名 | 范围 |
| --- | --- | --- |
| `econ` | 经济金融 | 学者主页、期刊、工作论文、机构 |
| `method` | 研究方法 | 计量与实证方法、讲义、在线书、工作流 |
| `search` | 学术检索 | 文献数据库与学术搜索引擎 |
| `data` | 数据源 | 数据集、数据库入口与文本数据 |
| `python` | Python | Python 包、库与文档 |
| `ml` | 机器学习 | 深度学习、强化学习、科学计算 |
| `latex` | 论文写作 | LaTeX、参考文献、写作工具 |
| `quant` | 量化计算 | 定量金融与计算经济学 |
| `ai` | AI 工具 | AI 产品、Agent 技能、提示与模型服务 |
| `service` | 平台服务 | 付费/账号类服务的官网首页 |
| `read` | 阅读资讯 | 博客、通讯、资讯与评测 |

新增标签：改 `src/lib/links.ts` 的 `TAGS` 数组，否则构建会抛错（防手滑写错标签）。

## 命令

```bash
npm install
npm run dev      # 本地预览 http://localhost:4321/resource-collector
npm run check    # 校验 links.yaml（字段、去重、日期）
npm run build    # 生成 dist/
npm run preview  # 预览构建产物
npm run links    # 手动探测全部链接可用性 → src/data/link-status.json
npm run icons    # 下载各域名 favicon 到 public/icons/（加了新域名后跑一次）
```

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
