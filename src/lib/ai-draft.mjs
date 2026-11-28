// dev 期「AI 生成元信息」的纯逻辑：提示词组装、模型输出解析与词表过滤、与表单已有内容的合并。
// 与 link-data.mjs 同规矩：不 import node 内建模块，node --test 直接跑。

const escapeLine = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const describeSection = (section) => {
  const facets = (section.facets ?? []).map((facet) => {
    const shape = facet.multi ? '数组' : '字符串';
    const values = (facet.values ?? []).map((v) => `${v.id}=${v.label}`).join('、');
    return `  - ${facet.id}（${facet.label}，${facet.multi ? '可多选' : '单选'}，${shape}）：${values}`;
  });
  return [`- ${section.id}（${section.label}）：${section.hint ?? ''}`.trim(), ...facets].join('\n');
};

/**
 * 提示词：只给 URL、页面 <title>、正文字段与词表，明确禁止使用页面之外的知识。
 * 正文过长时截断——模型只需要够写 120 字简介。
 */
export const buildPrompt = ({ url, pageTitle = '', text = '', taxonomy }) => {
  const sections = (taxonomy?.sections ?? []).map(describeSection).join('\n');
  return [
    '你在给一个个人网络书库 Stacks（书签收藏）补元信息。只能依据下面给出的页面正文，',
    '不要用你自己的知识补充作者、机构、版本、功能或任何正文里没写的事实。',
    '',
    `目标 URL：${escapeLine(url)}`,
    `页面 <title>：${escapeLine(pageTitle) || '（无）'}`,
    '',
    '页面正文：',
    '"""',
    String(text ?? ''),
    '"""',
    '',
    '分区与分类词表（section 只能取这些 id；facets 的值只能取列出的 id）：',
    sections,
    '',
    '要求：',
    '1. title：≤80 字，用页面自称的名字，去掉「首页」「GitHub」这类站点后缀与书名号。',
    '2. desc：≤120 字中文，说清「是什么 + 有什么用」，只写正文能支持的事实，不要「提供丰富资源」这类空话，不要车轱辘话。',
    '3. section：1–2 个 id，按「资源主体是什么」判断，不是页面长得像什么。',
    '4. facets：只写入选 section 自己的轴，值必须来自词表；单选轴给字符串，多选轴给数组。',
    '   每个入选 section 的单选轴都必须给（漏一个就要人工补），多选轴至少勾一个能站住的。',
    '   学者页的 field 只有正文明确写了研究方向才填，否则给空数组，不要猜。',
    '5. evidence：2–4 条中文短语，逐字摘自上面正文，用来支撑 desc；摘不到就少给。',
    '',
    '只输出一个 JSON 对象，不要代码块，不要任何解释：',
    '{"title":"…","desc":"…","section":["…"],"facets":{"…":{"…":…}},"evidence":["…"]}',
  ].join('\n');
};

/** 模型偶尔会包一层 ```json 或加前后废话，取出最外层对象 */
export const extractJson = (raw) => {
  const text = String(raw ?? '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  return start >= 0 && end > start ? body.slice(start, end + 1) : null;
};

const pickText = (value, max) => escapeLine(value).slice(0, max);

/** 比对时忽略空白与大小写，避免模型改标点就被判成编造 */
const normalize = (value) => String(value ?? '').toLowerCase().replace(/\s+/g, '');

/**
 * 解析模型输出并按词表过滤。越界的 section / facet 值一律丢弃并记入 warnings，
 * evidence 只保留能在正文里逐字找到的片段，找不到的计入 unverified。
 */
export const parseDraft = (raw, taxonomy, text = '') => {
  // 失败与成功返回同一种形状，调用方只需要多看 draft 是否为空
  const failed = (reason, extra = {}) => ({ ok: false, reason, draft: null, warnings: [], unverified: 0, ...extra });
  const body = extractJson(raw);
  if (!body) return failed('模型没有返回 JSON');

  let data;
  try {
    data = JSON.parse(body);
  } catch (error) {
    return failed(`模型返回的 JSON 解析失败：${error.message}`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return failed('模型返回的不是对象');
  }

  const warnings = [];
  const title = pickText(data.title, 80);
  const desc = pickText(data.desc, 120);
  if (!title && !desc) return failed('模型没给出标题和简介');

  const byId = new Map((taxonomy?.sections ?? []).map((section) => [section.id, section]));
  const asked = Array.isArray(data.section) ? data.section : [data.section];
  const section = [];
  for (const item of asked) {
    const id = String(item ?? '').trim();
    if (!id) continue;
    if (!byId.has(id)) {
      warnings.push(`分区 ${id} 不在词表里，已丢弃`);
      continue;
    }
    if (!section.includes(id)) section.push(id);
  }
  if (section.length > 2) {
    warnings.push(`模型给了 ${section.length} 个分区，只保留前两个`);
    section.length = 2;
  }
  if (!section.length) warnings.push('模型没给出可用分区，需要你手动勾选');

  const rawFacets =
    data.facets && typeof data.facets === 'object' && !Array.isArray(data.facets) ? data.facets : {};
  const facets = {};
  for (const id of section) {
    const def = byId.get(id);
    const given =
      rawFacets[id] && typeof rawFacets[id] === 'object' && !Array.isArray(rawFacets[id]) ? rawFacets[id] : {};
    const out = {};
    for (const axis of def.facets ?? []) {
      const allowed = new Set((axis.values ?? []).map((value) => value.id));
      const given_ = given[axis.id];
      if (axis.multi) {
        const list = (Array.isArray(given_) ? given_ : [given_])
          .map((value) => String(value ?? '').trim())
          .filter((value) => {
            if (!value) return false;
            if (allowed.has(value)) return true;
            warnings.push(`${id}.${axis.id} 的 ${value} 不在词表里，已丢弃`);
            return false;
          });
        out[axis.id] = [...new Set(list)];
        if (!out[axis.id].length) warnings.push(`${id}.${axis.id}（${axis.label}）没勾，需要你手动选`);
      } else {
        const pick = String((Array.isArray(given_) ? given_[0] : given_) ?? '').trim();
        if (pick && allowed.has(pick)) out[axis.id] = pick;
        else {
          if (pick) warnings.push(`${id}.${axis.id} 的 ${pick} 不在词表里，已丢弃`);
          warnings.push(`${id}.${axis.id}（${axis.label}）没给或无效，需要你手动选`);
        }
      }
    }
    facets[id] = out;
  }

  const haystack = normalize(text);
  const evidence = [];
  let unverified = 0;
  for (const item of (Array.isArray(data.evidence) ? data.evidence : []).slice(0, 6)) {
    const quote = pickText(item, 160);
    if (!quote) continue;
    if (!haystack.includes(normalize(quote))) {
      unverified++;
      continue;
    }
    if (!evidence.includes(quote)) evidence.push(quote);
    if (evidence.length >= 4) break;
  }
  if (!evidence.length) warnings.push('模型没给出能在正文里找到的依据，简介需自己核对');

  return { ok: true, reason: '', draft: { title, desc, section, facets, evidence }, warnings, unverified };
};

/**
 * 把草稿叠到表单当前内容上。默认只填空白字段，不覆盖用户已经写的东西；
 * overwrite 为真才整片替换。kept 记录哪些字段因为已有内容而被保留。
 */
export const mergeDraft = (current, draft, { overwrite = false } = {}) => {
  const userTitle = escapeLine(current?.title);
  const userDesc = escapeLine(current?.desc);
  const userSection = Array.isArray(current?.section) ? current.section.filter(Boolean) : [];
  const kept = [];

  const title = !overwrite && userTitle ? userTitle : draft.title || userTitle;
  const desc = !overwrite && userDesc ? userDesc : draft.desc || userDesc;
  const keepSection = !overwrite && userSection.length > 0;
  const section = keepSection ? userSection : draft.section.length ? draft.section : userSection;
  const facets =
    keepSection && current?.facets && typeof current.facets === 'object'
      ? current.facets
      : section.length
        ? draft.facets
        : {};

  if (!overwrite) {
    if (userTitle && userTitle !== draft.title) kept.push('标题');
    if (userDesc && userDesc !== draft.desc) kept.push('简介');
    if (keepSection) kept.push('分区与分类');
  }
  return { title, desc, section, facets, kept };
};
