import { createServer } from 'node:http';

/**
 * 一个够用的 PostgREST 假服务器：只实现本项目用到的四种请求。
 * 测试里把它当 Supabase：账号密码随便填，URL 指向它就行。
 */
export const startFakeCloud = async ({ links = [], status = [], icons = [] } = {}) => {
  const tables = {
    links: new Map(links.map((row) => [row.url, { ...row }])),
    link_status: new Map(status.map((row) => [row.url, { ...row }])),
    icons: new Map(icons.map((row) => [row.host, { ...row }])),
  };
  const requests = [];
  /** 一次性故障：验证「一半写成功」时接口到底怎么报 */
  let fault = null;

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const table = url.pathname.split('/').pop() ?? '';
    const store = tables[table];
    const reply = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      requests.push({ method: req.method, table, query: url.search, body });
      if (!store) return reply(404, { message: `no table ${table}` });
      if (fault && fault.method === req.method && fault.table === table) {
        const { code } = fault;
        fault = null;
        return reply(code, { message: 'injected failure' });
      }

      if (req.method === 'GET') {
        const select = url.searchParams.get('select') ?? '*';
        const rows = [...store.values()];
        return reply(200, select === 'url' ? rows.map((row) => ({ url: row.url })) : rows);
      }

      if (req.method === 'POST') {
        for (const row of Array.isArray(body) ? body : [body]) {
          const key = table === 'icons' ? row.host : row.url;
          store.set(key, { ...store.get(key), ...row });
        }
        return reply(201, '');
      }

      if (req.method === 'DELETE') {
        const filter = url.searchParams.get('url') ?? '';
        if (filter.startsWith('eq.')) {
          store.delete(decodeURIComponent(filter.slice(3)));
        } else if (filter.startsWith('in.(')) {
          const list = filter.slice(4, -1);
          for (const raw of list.match(/"[^"]*"/g) ?? []) store.delete(raw.slice(1, -1));
        }
        return reply(204, '');
      }

      return reply(405, { message: 'unsupported' });
    });
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    tables,
    requests,
    rows: () => [...tables.links.values()],
    urls: () => [...tables.links.keys()],
    iconRows: () => [...tables.icons.values()],
    /** 让下一次指定方法/表的请求失败：cloud.failNext('DELETE', 'link_status', 500) */
    failNext(method, table, code = 500) {
      fault = { method, table, code };
    },
    /** 让 dev server 与脚本都连到这个假库 */
    use: () => {
      process.env.SUPABASE_URL = url;
      process.env.SUPABASE_ANON_KEY = 'fake-anon-key';
      process.env.SUPABASE_SECRET_KEY = 'fake-secret-key';
    },
    close: () => new Promise((done) => server.close(done)),
  };
};
