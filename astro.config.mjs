// @ts-check
import { defineConfig } from 'astro/config';

// 项目页部署：https://su-luoya.github.io/resource-collector/
// base 必须与仓库名一致，否则 _astro 资源路径会 404。
export default defineConfig({
  site: 'https://su-luoya.github.io',
  base: '/resource-collector',
  trailingSlash: 'ignore',
});
