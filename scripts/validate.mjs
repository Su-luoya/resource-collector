#!/usr/bin/env node
// 数据校验：新增/修改 links.yaml 后跑 `npm run check`。
// 校验结构、去重、以及 type/topics 是否落在 taxonomy.json 的白名单内。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'src/data/links.yaml');
const taxonomy = JSON.parse(readFileSync(resolve(root, 'src/data/taxonomy.json'), 'utf8'));
const typeIds = new Set(taxonomy.types.map((t) => t.id));
const topicIds = new Set(taxonomy.topics.map((t) => t.id));
const parsed = parse(readFileSync(file, 'utf8'));
const rows = Array.isArray(parsed) ? parsed : parsed?.links;

const errors = [];
const warn = [];
const err = (m) => errors.push(m);

if (!Array.isArray(rows)) err('links.yaml 顶层必须是链接数组');
if (!errors.length) {
  const seen = new Map();
  const today = new Date().toISOString().slice(0, 10);

  rows.forEach((l, i) => {
    const at = `links[${i}]`;
    if (!l || typeof l !== 'object') return err(`${at} 不是对象`);

    for (const k of ['title', 'url', 'desc']) {
      if (typeof l[k] !== 'string' || !l[k].trim()) err(`${at}.${k} 缺失或为空`);
    }
    if (typeof l.title === 'string' && l.title.length > 80) err(`${at}.title 超过 80 字`);
    if (typeof l.desc === 'string' && l.desc.length > 120) err(`${at}.desc 超过 120 字（卡片会截断）`);

    if (typeof l.url === 'string') {
      if (!/^https?:\/\//.test(l.url)) err(`${at}.url 必须以 http(s):// 开头：${l.url}`);
      const prev = seen.get(l.url);
      if (prev) err(`${at}.url 与 links[${prev}] 重复：${l.url}`);
      else seen.set(l.url, i);
    }

    if (typeof l.type !== 'string' || !l.type.trim()) err(`${at}.type 缺失（必须是 taxonomy.json 里的一个类型 id）`);
    else if (!typeIds.has(l.type)) err(`${at}.type 未登记：${l.type}（可选：${[...typeIds].join(', ')}）`);

    if (!Array.isArray(l.topics)) err(`${at}.topics 必须是数组（可为空，但字段要写）`);
    else {
      const seenTopic = new Set();
      for (const t of l.topics) {
        if (typeof t !== 'string' || !/^[a-z0-9-]+$/.test(t)) err(`${at}.topics 含非法取值：${JSON.stringify(t)}`);
        else if (!topicIds.has(t)) err(`${at}.topics 未登记：${t}（可选：${[...topicIds].join(', ')}）`);
        else if (seenTopic.has(t)) err(`${at}.topics 重复：${t}`);
        else seenTopic.add(t);
      }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(l.added ?? ''))) err(`${at}.added 必须是 YYYY-MM-DD`);
    else if (String(l.added) > today) warn.push(`${at}.added 是未来日期：${l.added}`);
  });

  for (const l of rows) {
    if (typeof l.url === 'string' && /^http:\/\//.test(l.url)) warn.push(`非 HTTPS 链接：${l.url}`);
  }
}

for (const w of warn) console.warn(`warn  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error ${e}`);
  console.error(`\n✗ ${errors.length} 个问题`);
  process.exit(1);
}
console.log(`✓ ${rows.length} 条链接校验通过`);
