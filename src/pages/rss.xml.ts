import type { APIRoute } from 'astro';
import { links, TYPE_LABEL, TOPIC_LABEL } from '../lib/links';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const site = import.meta.env.SITE.replace(/\/$/, '');
const home = `${site}${base}/`;

export const GET: APIRoute = () => {
  const items = links
    .slice(0, 40)
    .map((l) => {
      const pub = new Date(`${l.added}T00:00:00Z`).toUTCString();
      return [
        '    <item>',
        `      <title>${esc(l.title)}</title>`,
        `      <link>${esc(l.url)}</link>`,
        `      <guid isPermaLink="false">${esc(l.url)}</guid>`,
        `      <pubDate>${pub}</pubDate>`,
        `      <description>${esc(l.desc)}</description>`,
        ...[TYPE_LABEL[l.type] ?? l.type, ...l.topics.map((t) => TOPIC_LABEL[t] ?? t)]
          .map((t) => `      <category>${esc(t)}</category>`),
        '    </item>',
      ].join('\n');
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>资源库 · 最近新增</title>
    <link>${esc(home)}</link>
    <description>个人网络资源库最新收录的链接</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${esc(home)}rss.xml" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
