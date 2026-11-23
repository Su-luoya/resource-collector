// 站点挂载路径。三处（页面、RSS、Base 布局）以前各自拼一遍，容易漏掉结尾斜杠。

const raw = import.meta.env.BASE_URL;

/** 带结尾斜杠的 base：`${base}links.json` 这种拼接必须先补齐，否则会粘成 `/resource-collectorlinks.json` */
export const base = raw.endsWith('/') ? raw : `${raw}/`;

/** 站点首页的绝对地址，供 RSS 使用（site 在 astro.config.mjs 里配置） */
export const homeUrl = `${String(import.meta.env.SITE || '').replace(/\/$/, '')}${base}`;
