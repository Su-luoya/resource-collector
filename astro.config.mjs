// @ts-check
import { defineConfig } from 'astro/config';

// 项目页部署：https://su-luoya.github.io/resource-collector/
// base 必须与仓库名一致，否则 _astro 资源路径会 404。
const BASE = '/resource-collector';
export default defineConfig({
  site: 'https://su-luoya.github.io',
  base: BASE,
  trailingSlash: 'ignore',
  // 原来的 skill 分区并进了 ai。静态站没有服务端，靠 Astro 的 redirects 生成 meta 跳转页；
  // 注意目标路径得自己带上 base——Astro 不会给 redirect 目标补 base。
  redirects: {
    '/skill': `${BASE}/ai`,
  },
  // 关掉 Astro 自带的 dev 工具条：它固定在底部居中，既挡卡片上的勾选框，
  // 也和项目自己的浮动编辑条打架（重复的“检查/设置”入口用不上）
  devToolbar: { enabled: false },
});
