import raw from '../data/links.yaml?raw';
import statusRaw from '../data/link-status.json?raw';
import iconsJson from '../data/icons.json';
import { parse } from 'yaml';

export type Resource = {
  title: string;
  url: string;
  tags: string[];
  desc: string;
  added: string;
};

export type LinkStatus = {
  status: 'ok' | 'redirect' | 'warn' | 'fail';
  code?: number;
  final?: string;
  checked: string;
};

export const TAGS = [
  { id: 'econ', label: '经济金融', hint: '学者主页、期刊、工作论文、机构' },
  { id: 'method', label: '研究方法', hint: '计量与实证方法、讲义、在线书、工作流' },
  { id: 'search', label: '学术检索', hint: '文献数据库与学术搜索引擎' },
  { id: 'data', label: '数据源', hint: '数据集、数据库入口与文本数据' },
  { id: 'python', label: 'Python', hint: 'Python 包、库与文档' },
  { id: 'ml', label: '机器学习', hint: '深度学习、强化学习、科学计算' },
  { id: 'latex', label: '论文写作', hint: 'LaTeX、参考文献、写作工具' },
  { id: 'quant', label: '量化计算', hint: '定量金融与计算经济学' },
  { id: 'ai', label: 'AI 工具', hint: 'AI 产品、Agent 技能、提示与模型服务' },
  { id: 'service', label: '平台服务', hint: '付费/账号类服务的官网首页' },
  { id: 'read', label: '阅读资讯', hint: '博客、通讯、资讯与评测' },
] as const;

export const TAG_LABEL = new Map(TAGS.map((t) => [t.id, t.label]));

/** 数据里出现但 TAGS 未登记的标签（构建时会报错，防止手滑写错标签） */
export const unknownTags = (rows: Resource[]): string[] => {
  const known = new Set(TAGS.map((t) => t.id));
  return [...new Set(rows.flatMap((r) => r.tags))].filter((t) => !known.has(t));
};

let statuses: Record<string, LinkStatus> = {};
try {
  statuses = JSON.parse((statusRaw as string) || '{}');
} catch {
  statuses = {};
}

export const links: Resource[] = (parse(raw) as Resource[]).sort((a, b) => {
  if (a.added !== b.added) return a.added < b.added ? 1 : -1;
  return a.title.localeCompare(b.title, 'zh-Hans-CN');
});

export const allTags = TAGS.map((t) => ({
  ...t,
  count: links.filter((l) => l.tags.includes(t.id)).length,
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

/** 供搜索与 JSON 导出复用的可搜索文本 */
export const searchText = (l: Resource): string =>
  [l.title, l.desc, l.tags.join(' '), hostOf(l.url)].join(' ').toLowerCase();

export const lastUpdated = links.reduce((m, l) => (l.added > m ? l.added : m), '');
