import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cache from '../../.cache/links.json';
import { objectName } from './storage.mjs';
import taxonomy from '../data/taxonomy.json';
import { hostKey, validateRows } from './link-data.mjs';
import { sortLinks } from './ordering.mjs';
import { slugMap } from './slug.mjs';
import { base } from './site';

export type FacetValue = { id: string; label: string; hint?: string };

export type FacetDef = {
  id: string;
  label: string;
  hint?: string;
  /** 可多选：数据里写数组；单选写字符串 */
  multi?: boolean;
  values: FacetValue[];
};

export type SectionDef = {
  id: string;
  label: string;
  hint: string;
  /** 卡片徽标用哪条轴的取值，必须是本分区 facets 里的 id */
  badge: string;
  facets: FacetDef[];
};

export type Resource = {
  title: string;
  url: string;
  /** 进哪几个分区：可多值，tidy-finance 这类既是数据处理代码又是包 */
  section: string[];
  /** 分类值按分区嵌套：facets[section][facet] = 单值或数组 */
  facets: Record<string, Record<string, string | string[]>>;
  desc: string;
  added: string;
  /** 待看：只有 read: false 才写进数据，没有这个字段就是「已看过」 */
  read?: boolean;
};

export type LinkStatus = {
  status: 'ok' | 'redirect' | 'warn' | 'fail';
  code?: number;
  error?: string;
  final?: string;
  redirects?: number[];
  fixedFrom?: string;
  checked: string;
};

/** 分区与每区的分类轴，定义见 src/data/taxonomy.json */
export const SECTIONS = taxonomy.sections as SectionDef[];
export const SECTION_BY_ID = new Map(SECTIONS.map((s) => [s.id, s]));

export const SECTION_LABEL: Record<string, string> = Object.fromEntries(
  SECTIONS.map((s) => [s.id, s.label]),
);

/**
 * 数据来自 `.cache/links.json`，由 `npm run sync` 从 Supabase 拉下来（prebuild / predev 自动跑）。
 * 库是唯一事实源，所以这里不再解析 YAML，也不再容忍坏数据：直接在这里把不合规的行拦住。
 */
const rows = cache.links as unknown as Resource[];
const { errors } = validateRows(rows, taxonomy);
if (errors.length) throw new Error(`云端数据校验未通过：\n${errors.join('\n')}`);
export const links: Resource[] = sortLinks(rows) as Resource[];

/** 某个分区里的条目，排序规则与首页一致 */
export const sectionLinks = (id: string): Resource[] =>
  links.filter((l) => l.section.includes(id));

export const sectionCount = (id: string): number => sectionLinks(id).length;

const asList = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value : value ? [value] : [];

export const valueLabel = (sid: string, fid: string, vid: string): string =>
  SECTION_BY_ID.get(sid)?.facets.find((f) => f.id === fid)?.values.find((v) => v.id === vid)?.label ?? vid;

/** 某条资源在某个分区下的分类标签，按词表顺序排 */
export const facetLabels = (l: Resource, sid: string): string[] => {
  const def = SECTION_BY_ID.get(sid);
  if (!def) return [];
  return def.facets.flatMap((f) => asList(l.facets?.[sid]?.[f.id]).map((v) => valueLabel(sid, f.id, v)));
};

/** 卡片徽标：分区页用该分区的主轴（badge），首页用分区名 */
export const badgeLabels = (l: Resource, sid?: string): string[] => {
  if (!sid) return l.section.map((id) => SECTION_LABEL[id] ?? id);
  const def = SECTION_BY_ID.get(sid);
  if (!def) return [];
  return asList(l.facets?.[sid]?.[def.badge]).map((v) => valueLabel(sid, def.badge, v));
};

export type FacetTag = {
  /** 分类属于哪个分区，链接就落到哪个分区页 */
  sid: string;
  fid: string;
  value: string;
  label: string;
  /** 分区页的筛选视图：`#轴=取值`，由 src/client/filter.ts 还原 */
  href: string;
};

/** 详情页的分类标签：每个取值都链到对应分区页的筛选视图，同一轴+取值跨分区只留第一个 */
export const facetTags = (l: Resource): FacetTag[] => {
  const seen = new Set<string>();
  const tags: FacetTag[] = [];
  for (const sid of l.section) {
    const def = SECTION_BY_ID.get(sid);
    if (!def) continue;
    for (const f of def.facets) {
      for (const value of asList(l.facets?.[sid]?.[f.id])) {
        const key = `${f.id}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push({
          sid,
          fid: f.id,
          value,
          label: valueLabel(sid, f.id, value),
          href: `${base}${sid}/#${encodeURIComponent(f.id)}=${encodeURIComponent(value)}`,
        });
      }
    }
  }
  return tags;
};

/** 卡片上的小标签：去掉徽标那条轴之后的其余分类 */
export const tagLabels = (l: Resource, sid?: string): string[] => {
  if (!sid) return l.section.flatMap((id) => facetLabels(l, id));
  const def = SECTION_BY_ID.get(sid);
  if (!def) return [];
  return def.facets
    .filter((f) => f.id !== def.badge)
    .flatMap((f) => asList(l.facets?.[sid]?.[f.id]).map((v) => valueLabel(sid, f.id, v)));
};

/** 卡片上用于客户端筛选的属性：分区页按该分区的轴，首页只有分区一条轴 */
export const facetAttrs = (l: Resource, sid?: string): Record<string, string> => {
  const read = l.read === false ? 'unread' : '';
  if (!sid) return { 'data-facet-section': l.section.join(' '), 'data-facet-read': read };
  const def = SECTION_BY_ID.get(sid);
  if (!def) return {};
  const attrs: Record<string, string> = { 'data-facet-section': l.section.join(' '), 'data-facet-read': read };
  for (const f of def.facets) attrs[`data-facet-${f.id}`] = asList(l.facets?.[sid]?.[f.id]).join(' ');
  return attrs;
};

export type FacetWithCount = FacetDef & { values: (FacetValue & { count: number })[] };

/** 某分区里各条轴的取值与计数，供筛选 chip 使用 */
export const facetsFor = (sid: string, rows: Resource[] = sectionLinks(sid)): FacetWithCount[] => {
  const def = SECTION_BY_ID.get(sid);
  if (!def) return [];
  return def.facets.map((f) => ({
    ...f,
    values: f.values.map((v) => ({
      ...v,
      count: rows.filter((l) => asList(l.facets?.[sid]?.[f.id]).includes(v.id)).length,
    })),
  }));
};

/** 图标表：host → public 下的相对路径，由 scripts/fetch-icons.mjs 写好并同步进库 */
export const icons = cache.icons as Record<string, string>;
export const iconFor = (host: string): string | undefined => {
  const name = objectName(icons[host]);
  return name && existsSync(resolve('public/icons', name)) ? `icons/${name}` : undefined;
};

const statuses = (cache.status ?? {}) as Record<string, LinkStatus>;
export const statusOf = (url: string): LinkStatus | undefined => statuses[url];

/** 域名键：去掉 www. 与小写化，与 scripts/fetch-icons.mjs 用同一份规则 */
export const hostOf = (url: string): string => hostKey(url);

/** 供搜索与 JSON 导出复用：搜索会命中分区名与分类名，输入「数据」也能筛到 */
export const searchText = (l: Resource): string =>
  [
    l.title,
    l.desc,
    l.section.map((id) => SECTION_LABEL[id] ?? id).join(' '),
    l.section.flatMap((id) => facetLabels(l, id)).join(' '),
    Object.entries(l.facets ?? {})
      .flatMap(([, values]) => Object.entries(values).flatMap(([k, v]) => [k, asList(v).join(' ')]))
      .join(' '),
    hostOf(l.url),
  ]
    .join(' ')
    .toLowerCase();

/** 待看条目：字段只在 read === false 时出现 */
export const unreadLinks = (rows: Resource[] = links): Resource[] => rows.filter((l) => l.read === false);
export const unreadCount = (rows: Resource[] = links): number => unreadLinks(rows).length;

/** 详情页地址表：url → slug，纯由 URL 推导，重排 YAML 不会改地址 */
export const SLUGS: Map<string, string> = slugMap(links);
export const linkHref = (l: Resource): string => `${base}l/${SLUGS.get(l.url) ?? ''}/`;

/** 顶部导航：首页「全部」+ 每个分区，计数按分区去重（跨区条目会在两页都算） */
export const navItems = (active?: string) => {
  return [
    { id: 'all', label: '全部', count: links.length, href: base, active: !active },
    ...SECTIONS.map((s) => ({
      id: s.id,
      label: s.label,
      count: sectionCount(s.id),
      href: `${base}${s.id}/`,
      active: s.id === active,
    })),
  ];
};
