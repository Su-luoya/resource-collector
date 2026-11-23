import type { APIRoute } from 'astro';
import { links, hostOf } from '../lib/links';

export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        count: links.length,
        links: links.map((l) => ({ ...l, host: hostOf(l.url) })),
      },
      null,
      2,
    ),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } },
  );
