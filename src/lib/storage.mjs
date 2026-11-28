/**
 * Supabase Storage 的最小封装：图标字节存在这里，仓库不再保存图片文件。
 *
 * 桶 `icons` 是 public read：构建时 `npm run sync` 用只读 key 直接下载，
 * 页面产物里仍是本地静态文件（`dist/icons/*`），线上不依赖任何外部服务。
 * 写（抓新图标）只走 secret key，CI 从不写。
 *
 * 与 cloud.mjs 一样不 import node 内建模块，chunk 纯函数可直接被 node --test 跑。
 */

export const BUCKET = 'icons';

/** `icons/fred.stlouisfed.org.ico` → `fred.stlouisfed.org.ico`（表里存的是 public 下的相对路径） */
export const objectName = (file) => String(file ?? '').replace(/^icons\//, '');

/** 公开对象的地址。只用于构建期下载，页面里不出现它 */
export const publicUrl = (url, file) =>
  `${url.replace(/\/+$/, '')}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(objectName(file))}`;

export const createStorage = ({ url, key, fetchImpl = fetch }) => {
  const base = `${url.replace(/\/+$/, '')}/storage/v1`;
  const auth = { apikey: key, Authorization: `Bearer ${key}` };

  return {
    /** 同名覆盖写（x-upsert）：重新抓到的图标直接替换，不用先删 */
    upload: async (name, bytes, contentType) => {
      const object = objectName(name);
      const res = await fetchImpl(`${base}/object/${BUCKET}/${encodeURIComponent(object)}`, {
        method: 'POST',
        headers: {
          ...auth,
          'Content-Type': contentType || 'application/octet-stream',
          'cache-control': 'public, max-age=604800',
          'x-upsert': 'true',
        },
        body: bytes,
      });
      if (!res.ok) {
        const detail = (await res.text()).trim().slice(0, 200) || res.statusText;
        throw new Error(`上传 ${object} 失败：HTTP ${res.status} ${detail}`);
      }
      return object;
    },

    /** 走公开地址读，不带鉴权头；对象不存在返回 null，由调用方决定是警告还是报错 */
    download: async (file) => {
      const res = await fetchImpl(publicUrl(url, file));
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      return bytes.length ? bytes : null;
    },

    /** 批量删对象（域名已从数据里删掉时用）。对象本来就不存在也算成功 */
    remove: async (files) => {
      const prefixes = files.map(objectName).filter(Boolean);
      if (!prefixes.length) return;
      const res = await fetchImpl(`${base}/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes }),
      });
      if (!res.ok) {
        const detail = (await res.text()).trim().slice(0, 200) || res.statusText;
        throw new Error(`删除 ${prefixes.length} 个对象失败：HTTP ${res.status} ${detail}`);
      }
    },
  };
};
