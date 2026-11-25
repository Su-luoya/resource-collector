// 「按域名猜分类」的规则表。
//
// 只收录平台性质没有歧义的域名：arxiv 必然是论文流，fred 必然是指标，kaggle 必然是数据源。
// 一旦开始猜（github 上的仓库可能是包、也可能是研究代码、也可能是个文档站），
// 就会把 AI 生成里最容易错的那部分搬到这里来，反而更难发现。
//
// 分区按主题切分之后，「包注册表」这一类只剩下一半的确定性：pypi 必然是个包，
// 但它属于计量、机器学习还是工具，域名看不出来。这里默认落在 tools 的「通用库」，
// 采集者如果发现它其实是某个领域的估计库，自己改成 metrics / ml 即可。
//
// 输出永远是「建议」：编辑层只把它摆在表单旁边当候选，绝不自动写盘。

const paper = { section: ['lit'], facets: { lit: { kind: 'stream' } } };
const registry = { section: ['tools'], facets: { tools: { kind: 'lib' } } };
const blog = { section: ['tools'], facets: { tools: { kind: 'blog' } } };

const RULES = [
  { host: 'pypi.org', ...registry },
  { host: 'npmjs.com', ...registry },
  { host: 'crates.io', ...registry },
  { host: 'cran.r-project.org', ...registry },
  { host: 'ctan.org', ...registry },
  { host: 'huggingface.co', section: ['data'], facets: { data: { kind: 'dataset' } } },
  { host: 'arxiv.org', ...paper },
  { host: 'ssrn.com', ...paper },
  { host: 'nber.org', ...paper },
  { host: 'sciencedirect.com', ...paper },
  { host: 'jstor.org', ...paper },
  { host: 'pubmed.ncbi.nlm.nih.gov', ...paper },
  { host: 'scholar.google.com', section: ['lit'], facets: { lit: { kind: 'search' } } },
  { host: 'fred.stlouisfed.org', section: ['data'], facets: { data: { kind: 'index', topic: ['macro'] } } },
  { host: 'kaggle.com', section: ['data'], facets: { data: { kind: 'source' } } },
  { host: 'substack.com', ...blog },
  { host: 'medium.com', ...blog },
  { host: 'github.com', section: ['tools'], facets: {} },
];

const hostOf = (input) => {
  try {
    const url = new URL(String(input ?? '').trim());
    return url.hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
};

/** 命中的规则：自身相等或作为子域命中（docs.pypi.org 也算 pypi.org） */
const ruleFor = (host) => RULES.find((r) => host === r.host || host.endsWith(`.${r.host}`));

/**
 * 按域名给出分类建议；越出词表的值会被丢掉并记在 dropped 里。
 * taxonomy 传入是为了让建议与 `src/data/taxonomy.json` 对齐：删了某个分类值，规则自然失效，不会写进坏数据。
 */
export const suggestFor = (url, taxonomy) => {
  const host = hostOf(url);
  if (!host) return null;
  const rule = ruleFor(host);
  if (!rule) return null;

  const byId = new Map((taxonomy?.sections ?? []).map((s) => [s.id, s]));
  const dropped = [];

  const section = rule.section.filter((id) => {
    if (byId.has(id)) return true;
    dropped.push(`分区 ${id}`);
    return false;
  });
  if (!section.length) return null;

  const facets = {};
  for (const sid of section) {
    const given = rule.facets?.[sid] ?? {};
    const out = {};
    for (const axis of byId.get(sid).facets ?? []) {
      const value = given[axis.id];
      if (value === undefined) continue;
      const allowed = new Set((axis.values ?? []).map((v) => v.id));
      if (axis.multi) {
        const list = (Array.isArray(value) ? value : [value]).filter((v) => {
          if (allowed.has(v)) return true;
          dropped.push(`${sid}.${axis.id}=${v}`);
          return false;
        });
        if (list.length) out[axis.id] = list;
      } else if (allowed.has(value)) {
        out[axis.id] = value;
      } else {
        dropped.push(`${sid}.${axis.id}=${value}`);
      }
    }
    if (Object.keys(out).length) facets[sid] = out;
  }

  return { host, matched: rule.host, section, facets, dropped };
};
