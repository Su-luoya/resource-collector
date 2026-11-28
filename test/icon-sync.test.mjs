// `npm test`：图标字节的唯一事实源是 Supabase Storage，构建前由 icon-sync 下到 public/icons/。
// 这里钉的是：只补本地缺的、已有的不重下、取不到只记名字不抛（图标缺了页面退化成首字母占位，
// 不该因此停掉整次构建）。真实网络不参与，storage 是假的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { syncIcons } from '../src/lib/icon-sync.mjs';
import { objectName, publicUrl } from '../src/lib/storage.mjs';

test('objectName 去掉 icons/ 前缀；publicUrl 拼到 /object/public/icons/ 下', () => {
  assert.equal(objectName('icons/x.ico'), 'x.ico');
  assert.equal(objectName('x.png'), 'x.png');
  assert.equal(
    publicUrl('https://p.supabase.co/', 'icons/x.ico'),
    'https://p.supabase.co/storage/v1/object/public/icons/x.ico',
  );
});

test('只下载本地缺的图标；取不到的只记失败，不抛也不落空文件', async (t) => {
  const scratch = join(process.cwd(), '.scratch');
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, 'icons-'));
  mkdirSync(join(dir, 'public/icons'), { recursive: true });
  writeFileSync(join(dir, 'public/icons/have.ico'), 'old');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const asked = [];
  const storage = {
    download: async (file) => {
      asked.push(file);
      return file.includes('gone') ? null : new Uint8Array([1, 2, 3]);
    },
  };
  const cache = {
    icons: {
      'have.example': 'icons/have.ico',
      'new.example': 'icons/new.ico',
      'gone.example': 'icons/gone.ico',
    },
  };

  const result = await syncIcons({ dir, cache, storage });

  assert.deepEqual(asked.sort(), ['icons/gone.ico', 'icons/new.ico']);
  assert.equal(result.total, 3);
  assert.equal(result.downloaded, 1);
  assert.deepEqual(result.failed, ['gone.example']);
  // 已在本地的不重下、不被覆盖
  assert.equal(readFileSync(join(dir, 'public/icons/have.ico'), 'utf8'), 'old');
  assert.equal(readFileSync(join(dir, 'public/icons/new.ico')).length, 3);
  assert.ok(!existsSync(join(dir, 'public/icons/gone.ico')), '取不到的对象不该留下空文件');
});
