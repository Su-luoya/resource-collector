// @ts-check
import { defineConfig } from 'astro/config';

// 项目页部署：https://su-luoya.github.io/resource-collector/
// base 必须与仓库名一致，否则 _astro 资源路径会 404。
export default defineConfig({
  site: 'https://su-luoya.github.io',
  base: '/resource-collector',
  trailingSlash: 'ignore',
  // 关掉 Astro 自带的 dev 工具条：它固定在底部居中，既挡卡片上的勾选框，
  // 也和项目自己的浮动编辑条打架（重复的“检查/设置”入口用不上）
  devToolbar: { enabled: false },
});
