# 本项目约定

个人资源库（书签收藏）+ GitHub Pages 展示站。数据文件是唯一事实源，页面全部由它生成。

## 日常动作：用户发来新链接时

1. 打开 `src/data/links.yaml`，在**文件末尾追加**（不要按标签分组重排，写入顺序无所谓，页面会自己排序）：
   ```yaml
   - title: 名称
     url: https://...
     tags: [econ]        # 1 个或多个，取值见 src/lib/links.ts 的 TAGS
     desc: 一句中文简介，≤120 字，说清「是什么 + 有什么用」
     added: YYYY-MM-DD   # 当天日期
   ```
2. `desc` 只写用户能验证的事实（官网自述、实际页面内容）。**不要编造**作者、机构、功能。抓不到页面内容就先问用户，或写保守描述。
3. 只有新域名的域名才需要 `npm run icons` 重新抓图标（已有域名会跳过）。
4. `npm run check && npm run build`，然后 commit + push。推送即自动部署。

## 不要做

- 不收录带登录态的控制台、付费后台、校内门户、机场/代理订阅链接；服务类只放官网首页。
- 不新建标签：先在 `src/lib/links.ts` 的 `TAGS` 登记（id + label + hint），再加到数据里，否则构建报错。
- 不改 `astro.config.mjs` 的 `base`，除非仓库改名（改了两处要同步：`site` + `base`）。
- 不引入前端框架/UI 库/CDN 资源。图标走 `public/icons/`（本地文件），字体走系统栈。

## 关键文件

- `src/data/links.yaml` — 数据
- `src/lib/links.ts` — 标签定义、排序、搜索文本、图标表读取
- `src/pages/index.astro` — 唯一页面（含全部客户端交互脚本）
- `src/styles/global.css` — 全部样式（含深浅色变量）
- `scripts/validate.mjs` / `check-links.mjs` / `fetch-icons.mjs`
- `.github/workflows/deploy.yml`（push 即部署）、`link-check.yml`（每周链接体检并提交结果）
