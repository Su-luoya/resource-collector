import raw from '../data/links.yaml?raw';
import statusRaw from '../data/link-status.json?raw';
import iconsJson from '../data/icons.json';
import taxonomy from '../data/taxonomy.json';
import { parse } from 'yaml';

export type TypeId = keyof typeof TYPE_LABEL;
export type TopicId = string;

export type Resource = {
  title: string;
  url: string;
  /** 资源形态，单选：一条资源只属于一个类型轴取值 */
  type: string;
  /** 主题，可多选：一条资源可以同时讲计量与 Python */
  topics: string[];
  desc: string;
  added: string;
};

export type LinkStatus = {
  status: 'ok' | 'redirect' | 'warn' | 'fail';
  code?: number;
  final?: string;
  checked: string;
};

type Facet = { id: string; label: string; hint: string };

/** 分面分类的两条轴：type（是什么）与 topic（讲什么），定义见 src/data/taxonomy.json */
export const TYPES = taxonomy.types as Facet[];
export const TOPICS = taxonomy.topics as Facet[];

export const TYPE_LABEL: Record<string, string> = Object.fromEntries(
  TYPES.map((t) => [t.id, t.label]),
);
export const TOPIC_LABEL: Record<string, string> = Object.fromEntries(
  TOPICS.map((t) => [t.id, t.label]),
);

/** 数据里出现但 taxonomy.json 未登记的取值（构建时由 scripts/validate.mjs 拦截） */
export const unknownFacets = (rows: Resource[]) => {
  const types = new Set(TYPES.map((t) => t.id));
  const topics = new Set(TOPICS.map((t) => t.id));
  return {
    types: [...new Set(rows.map((r) => r.type))].filter((t) => !types.has(t)),
    topics: [...new Set(rows.flatMap((r) => r.topics ?? []))].filter((t) => !topics.has(t)),
  };
};

let statuses: Record<string, LinkStatus> = {};
try {
  statuses = JSON.parse((statusRaw as string) || '{}');
} catch {
  statuses = {};
}

export const links: Resource[] = (parse(raw) as Resource[])
  .map((r) => ({ ...r, topics: r.topics ?? [] }))
  .sort((a, b) => {
    if (a.added !== b.added) return a.added < b.added ? 1 : -1;
    return a.title.localeCompare(b.title, 'zh-Hans-CN');
  });

export type FacetWithCount = Facet & { count: number };

export const typeFacets: FacetWithCount[] = TYPES.map((t) => ({
  ...t,
  count: links.filter((l) => l.type === t.id).length,
}));

export const topicFacets: FacetWithCount[] = TOPICS.map((t) => ({
  ...t,
  count: links.filter((l) => l.topics.includes(t.id)).length,
}));

/** 本地图标表：host → public 下的相对路径（scripts/fetch-icons.mjs 生成） */
export const icons = iconsJson as Record<string, string>;
export const iconFor = (host: string): string | undefined => icons[host];

export const statusOf = (url: string): LinkStatus | undefined => statuses[url];

export const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** 供搜索与 JSON 导出复用：搜索会命中类型名与主题名，输入「学者」也能筛到 */
export const searchText = (l: Resource): string =>
  [
    l.title,
    l.desc,
    TYPE_LABEL[l.type] ?? l.type,
    l.topics.map((t) => TOPIC_LABEL[t] ?? t).join(' '),
    l.topics.join(' '),
    hostOf(l.url),
  ]
    .join(' ')
    .toLowerCase();

export const lastUpdated = links.reduce((m, l) => (l.added > m ? l.added : m), '');
