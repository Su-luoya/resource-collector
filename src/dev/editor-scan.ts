// 全库查重对话框：点一次按钮，把重复条目按规则分组列出来。
import { $, type Deps, type Row, type ScanGroup } from './editor-shared';

export const setupScan = ({ send }: Pick<Deps, 'send'>) => {
  const scanBtn = $<HTMLButtonElement>('dev-scan');
  const scanDlg = $<HTMLDialogElement>('dev-scan-dialog');
  const scanList = $<HTMLDivElement>('dev-scan-list');
  const scanClose = $<HTMLButtonElement>('dev-scan-close');

  function renderScan(reply: { ok: boolean; message?: string; checked?: number; groups?: ScanGroup[] }) {
    scanList.replaceChildren();
    if (!reply.ok) {
      const p = document.createElement('p');
      p.className = 'dev-err';
      p.textContent = reply.message || '查重失败';
      scanList.append(p);
      return;
    }
    const groups = reply.groups ?? [];
    const head = document.createElement('p');
    head.className = 'dev-scan-head';
    head.textContent = groups.length
      ? `检查了 ${reply.checked ?? 0} 条，发现 ${groups.length} 组重复`
      : `检查了 ${reply.checked ?? 0} 条，没发现能确定的重复`;
    scanList.append(head);

    for (const group of groups) {
      const block = document.createElement('div');
      block.className = 'dev-scan-group';
      const label = document.createElement('p');
      label.className = 'dev-scan-label';
      label.textContent = `${group.label}（${group.items.length} 条）`;
      block.append(label);

      const list = document.createElement('ul');
      for (const row of group.items) {
        const item = document.createElement('li');
        const open = document.createElement('a');
        open.href = row.url;
        open.target = '_blank';
        open.rel = 'noreferrer';
        open.textContent = row.title;
        const where = document.createElement('span');
        where.className = 'dev-scan-url';
        where.textContent = row.url;
        item.append(open, where);
        list.append(item);
      }
      block.append(list);
      scanList.append(block);
    }
  }

  scanBtn.addEventListener('click', async () => {
    scanList.textContent = '正在查…';
    scanDlg.showModal();
    scanBtn.disabled = true;
    const reply = await send<{ ok: boolean; message?: string; checked?: number; groups?: (ScanGroup & { items: Row[] })[] }>(
      'duplicates-scan',
    );
    scanBtn.disabled = false;
    renderScan(reply);
  });
  scanClose.addEventListener('click', () => scanDlg.close());
};
