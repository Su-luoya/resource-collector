export type ParsedQuery = {
  /** 剥掉前缀后的自由词 */
  text: string;
  sections: string[];
  domains: string[];
  flags: string[];
  /** 写了 is: 但不认识的值，原样报回去让界面提示，不静默吃成自由词 */
  unknownFlags: string[];
};

const KNOWN_FLAGS = new Set(['unread', 'read', 'note', 'fail', 'warn']);

/**
 * 把搜索串拆成「前缀行 + 自由词」。
 * 支持 `#分区`、`domain:xxx`、`is:unread|read|note|fail|warn`；其余照旧当自由词做 AND。
 * 同一类前缀之间取并集，不同类之间取交集——和左侧 chips 的语义保持一致。
 */
export function parseQuery(query: string): ParsedQuery {
  const out: ParsedQuery = { text: '', sections: [], domains: [], flags: [], unknownFlags: [] };
  const terms: string[] = [];

  for (const raw of query.trim().match(/\S+/g) ?? []) {
    const token = raw.toLowerCase();
    if (token.startsWith('#')) {
      const id = token.slice(1);
      if (id) out.sections.push(id);
      continue;
    }
    const sep = token.indexOf(':');
    if (sep > 0) {
      const key = token.slice(0, sep);
      const value = token.slice(sep + 1);
      if (key === 'domain' && value) {
        out.domains.push(value.replace(/^www\./, ''));
        continue;
      }
      if (key === 'is' && value) {
        if (KNOWN_FLAGS.has(value)) out.flags.push(value);
        else out.unknownFlags.push(value);
        continue;
      }
    }
    terms.push(token);
  }

  out.text = terms.join(' ');
  return out;
}

export type QueryTarget = {
  /** 已小写化的搜索文本 */
  haystack: string;
  sections: string[];
  host: string;
  unread: boolean;
  hasNote: boolean;
  /** 最近一次体检结果：ok / redirect / warn / fail，没有记录是空串 */
  status: string;
};

/** domain: 只认这个域名本身和它的子域；`example.com` 不该命中 `notexample.com` */
const hostMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

export const matchesQuery = (parsed: ParsedQuery, target: QueryTarget): boolean => {
  if (parsed.sections.length && !parsed.sections.some((id) => target.sections.includes(id))) return false;
  if (parsed.domains.length && !parsed.domains.some((d) => hostMatches(target.host, d))) return false;
  for (const flag of parsed.flags) {
    if (flag === 'unread' && !target.unread) return false;
    if (flag === 'read' && target.unread) return false;
    if (flag === 'note' && !target.hasNote) return false;
    if (flag === 'fail' && target.status !== 'fail') return false;
    if (flag === 'warn' && target.status !== 'warn') return false;
  }
  return queryMatcher(parsed.text)(target.haystack);
};

/** 每次输入只拆一次词；卡片的 data-search 已由 searchText 转为小写。 */
export function queryMatcher(query: string) {
  const terms = query.toLowerCase().match(/\S+/g) ?? [];
  return (text: string) => terms.every((term) => text.includes(term));
}

/** 把查询词变成一个用于高亮的正则；没有词时返回 null */
export const highlightPattern = (query: string): RegExp | null => {
  const terms = query.trim().match(/\S+/g) ?? [];
  if (!terms.length) return null;
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(${escaped.join('|')})`, 'gi');
};

export type Piece = { text: string; hit: boolean };

/** 纯函数：把一段文字按正则切成「命中 / 未命中」片段，渲染交给调用方 */
export const highlightPieces = (text: string, pattern: RegExp | null): Piece[] => {
  if (!pattern || !text) return [{ text, hit: false }];
  const out: Piece[] = [];
  let last = 0;
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), hit: false });
    out.push({ text: match[0], hit: true });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
};
