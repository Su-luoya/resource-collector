import type { APIRoute } from 'astro';
import { links, SLUGS, SECTIONS } from '../lib/links';
import { homeUrl } from '../lib/site';

/** 不引 sitemap 集成：一共就是首页、分区页和每条资源的详情页，手写更省事 */
export const GET: APIRoute = () => {
  const urls = [
    homeUrl,
    ...SECTIONS.map((s) => `${homeUrl}${s.id}/`),
    ...links.map((l) => `${homeUrl}l/${SLUGS.get(l.url)}/`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.replace(/&/g, '&amp;')}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
