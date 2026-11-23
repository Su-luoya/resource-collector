#!/usr/bin/env node
// 数据校验：新增/修改 links.yaml 后跑 `npm run check`。
// 规则本体在 src/lib/link-data.mjs，与 dev 编辑端点共用同一份，避免两套规则漂移。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseLinks, validateRows } from '../src/lib/link-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const file = resolve(root, 'src/data/links.yaml');
const taxonomy = JSON.parse(readFileSync(resolve(root, 'src/data/taxonomy.json'), 'utf8'));
const rows = parseLinks(readFileSync(file, 'utf8'));

const { errors, warns } = validateRows(rows, taxonomy);

for (const w of warns) console.warn(`warn  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`error ${e}`);
  console.error(`\n✗ ${errors.length} 个问题`);
  process.exit(1);
}
console.log(`✓ ${rows.length} 条链接校验通过`);
