// AI 生成元信息的纯逻辑测试：`npm test`
//
// 只测 src/lib/ai-draft.mjs，不联网、不调模型。关注的不是文案好不好，
// 而是「模型胡说了什么会被拦下来」：越界分区/分类、编造的依据、超长字段。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPrompt, extractJson, mergeDraft, parseDraft } from '../src/lib/ai-draft.mjs';

const taxonomy = JSON.parse(readFileSync('src/data/taxonomy.json', 'utf8'));
const PAGE = '这是一个宏观经济数据站。我们整理中国宏观指标，提供下载与 API 接口。所有数据按季度更新。';

test('提示词把词表与「只用页面正文」一起写死给模型', () => {
  const prompt = buildPrompt({
    url: 'https://x.example.com',
    pageTitle: '示例站点',
    text: PAGE,
    taxonomy,
  });
  assert.match(prompt, /只能依据/);
  assert.match(prompt, /https:\/\/x\.example\.com/);
  assert.match(prompt, /示例站点/);
  assert.ok(prompt.includes(PAGE));
  for (const section of taxonomy.sections) {
    assert.match(prompt, new RegExp(section.id));
    for (const facet of section.facets) assert.match(prompt, new RegExp(facet.id));
  }
  // 单选轴要标出「字符串」，否则模型会给数组
  assert.match(prompt, /kind（形态，单选，字符串）/);
});

test('模型外面包一层代码块或废话也能取出 JSON', () => {
  assert.equal(extractJson('{"a":1}'), '{"a":1}');
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(extractJson('好的，结果如下：\n{"a":1}\n希望有帮助'), '{"a":1}');
  assert.equal(extractJson('没有 JSON'), null);
});

test('正常输出：字段、分区分类与依据都通过', () => {
  const raw = JSON.stringify({
    title: '中国宏观经济数据',
    desc: '整理中国宏观指标，提供下载与 API。',
    section: ['data'],
    facets: { data: { kind: 'source', topic: ['macro'] } },
    evidence: ['我们整理中国宏观指标，提供下载与 API 接口'],
  });
  const result = parseDraft(raw, taxonomy, PAGE);
  assert.equal(result.ok, true);
  assert.equal(result.draft.title, '中国宏观经济数据');
  assert.equal(result.draft.desc, '整理中国宏观指标，提供下载与 API。');
  assert.deepEqual(result.draft.section, ['data']);
  assert.deepEqual(result.draft.facets, { data: { kind: 'source', topic: ['macro'] } });
  assert.deepEqual(result.draft.evidence, ['我们整理中国宏观指标，提供下载与 API 接口']);
  assert.equal(result.unverified, 0);
  assert.deepEqual(result.warnings, []);
});

test('编造的依据被丢掉并计数，不改写正文也能对上的（空白/大小写差异）保留', () => {
  const raw = JSON.stringify({
    title: 'T',
    desc: 'D',
    section: ['tools'],
    facets: { tools: { kind: 'tool' } },
    evidence: ['这个站点由麻省理工学院维护', '  我们整理中国宏观指标，  提供下载与 API 接口 '],
  });
  const result = parseDraft(raw, taxonomy, PAGE);
  assert.equal(result.ok, true);
  assert.equal(result.unverified, 1);
  assert.deepEqual(result.draft.evidence, ['我们整理中国宏观指标， 提供下载与 API 接口']);
});

test('越界的分区与分类值一律丢弃，并留下要人工补的提示', () => {
  const raw = JSON.stringify({
    title: 'T',
    desc: 'D',
    section: ['data', 'unknown-section'],
    facets: { data: { kind: 'not-a-kind', topic: ['macro', 'not-a-topic'] } },
    evidence: [],
  });
  const result = parseDraft(raw, taxonomy, PAGE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.draft.section, ['data']);
  assert.deepEqual(result.draft.facets, { data: { topic: ['macro'] } });
  const joined = result.warnings.join(' ');
  assert.match(joined, /unknown-section/);
  assert.match(joined, /not-a-kind/);
  assert.match(joined, /not-a-topic/);
  assert.match(joined, /kind（形态）没给或无效/);
});

test('单选轴给了数组取第一个，多选轴给了字符串也能收下', () => {
  const raw = JSON.stringify({
    title: 'T',
    desc: 'D',
    section: ['metrics'],
    facets: { metrics: { lang: 'python', kind: ['pkg', 'cli'] } },
    evidence: [],
  });
  const result = parseDraft(raw, taxonomy, PAGE);
  assert.equal(result.ok, true);
  assert.deepEqual(result.draft.facets.metrics, { lang: ['python'], kind: 'pkg' });
});

test('分区多于两个时截断；一个都不合法时提示手动勾选', () => {
  const many = parseDraft(
    JSON.stringify({ title: 'T', desc: 'D', section: ['data', 'scholar', 'tools'], facets: {} }),
    taxonomy,
    PAGE,
  );
  assert.equal(many.ok, true);
  assert.deepEqual(many.draft.section, ['data', 'scholar']);
  assert.match(many.warnings.join(' '), /只保留前两个/);

  const none = parseDraft(JSON.stringify({ title: 'T', desc: 'D', section: ['nope'], facets: {} }), taxonomy, PAGE);
  assert.equal(none.ok, true);
  assert.deepEqual(none.draft.section, []);
  assert.match(none.warnings.join(' '), /需要你手动勾选/);
});

test('标题与简介超长时截断，没给内容则整体失败', () => {
  const long = parseDraft(
    JSON.stringify({ title: 'A'.repeat(200), desc: 'B'.repeat(300), section: ['tools'], facets: { tools: { kind: 'tool' } } }),
    taxonomy,
    PAGE,
  );
  assert.equal(long.ok, true);
  assert.equal(long.draft.title.length, 80);
  assert.equal(long.draft.desc.length, 120);

  assert.equal(parseDraft('不是 JSON', taxonomy, PAGE).ok, false);
  assert.equal(parseDraft('{"title":"","desc":""}', taxonomy, PAGE).ok, false);
  assert.equal(parseDraft('[]', taxonomy, PAGE).ok, false);
});

test('合并：默认只填空白字段，已填的保留并记下来', () => {
  const draft = { title: 'AI 标题', desc: 'AI 简介', section: ['data'], facets: { data: { kind: 'source', topic: [] } }, evidence: [] };
  const merged = mergeDraft(
    { title: '我的标题', desc: '', section: [], facets: {} },
    draft,
  );
  assert.equal(merged.title, '我的标题');
  assert.equal(merged.desc, 'AI 简介');
  assert.deepEqual(merged.section, ['data']);
  assert.deepEqual(merged.kept, ['标题']);

  // 已选分区时不能把分区换成 AI 的推荐（否则分类与面板会对不上）
  const keepBoth = mergeDraft({ title: '', desc: '', section: ['tools'], facets: { tools: { kind: 'blog' } } }, draft);
  assert.deepEqual(keepBoth.section, ['tools']);
  assert.deepEqual(keepBoth.facets, { tools: { kind: 'blog' } });
  assert.deepEqual(keepBoth.kept, ['分区与分类']);
});

test('合并：overwrite 时整片替换，不再记保留项', () => {
  const draft = { title: 'AI 标题', desc: 'AI 简介', section: ['data'], facets: { data: { kind: 'source', topic: [] } }, evidence: [] };
  const merged = mergeDraft({ title: '我的标题', desc: '我的简介', section: ['tools'], facets: {} }, draft, {
    overwrite: true,
  });
  assert.equal(merged.title, 'AI 标题');
  assert.equal(merged.desc, 'AI 简介');
  assert.deepEqual(merged.section, ['data']);
  assert.deepEqual(merged.kept, []);
});
