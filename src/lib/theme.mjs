/**
 * 配色主题清单，id 与 global.css 里的 [data-theme] 块一一对应（顺序也要一致，
 * test/theme.test.mjs 会比对）。
 * light / dark 是站点第一版的原始青绿配色，默认用它俩；其余取自 pi-web
 * （github.com/agegr/pi-web/app/globals.css）。同色相的明暗相邻，菜单里正好同列成对。
 * 加一套主题：global.css 加一块 [data-theme]，这里加一项。
 */
export const THEMES = [
  { id: 'auto', label: '跟随系统' },
  { id: 'light', label: '浅色' },
  { id: 'mist', label: '雾青' },
  { id: 'lilac', label: '丁香' },
  { id: 'sand', label: '暖沙' },
  { id: 'rose', label: '蔷薇' },
  { id: 'plain', label: '素白' },
  { id: 'dark', label: '深色' },
  { id: 'pine', label: '松夜' },
  { id: 'dusk', label: '暮紫' },
  { id: 'ember', label: '余烬' },
  { id: 'slate', label: '岩蓝' },
  { id: 'graphite', label: '石墨' },
  { id: 'contrast-light', label: '高对比浅色' },
  { id: 'contrast-dark', label: '高对比深色' },
  { id: 'zenburn', label: 'Zenburn' },
];

/** 真正带配色的主题（去掉 auto）；首帧脚本拿它校验 localStorage 里的旧值。 */
export const THEME_IDS = THEMES.filter((theme) => theme.id !== 'auto').map((theme) => theme.id);
