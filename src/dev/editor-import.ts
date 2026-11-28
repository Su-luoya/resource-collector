// 导入浏览器书签文件：先出草稿让人确认，再一次性写入。
import { $, externalLink, type Deps, type ImportDraft, type ImportReply } from './editor-shared';
import { toast } from './toast';

export const setupImport = ({ send }: Pick<Deps, 'send'>) => {
  const importBtn = $<HTMLButtonElement>('dev-import');
  const importFile = $<HTMLInputElement>('dev-import-file');
  const importDlg = $<HTMLDialogElement>('dev-import-dialog');
  const importList = $<HTMLDivElement>('dev-import-list');
  const importSummary = $<HTMLParagraphElement>('dev-import-summary');
  const importMsg = $<HTMLParagraphElement>('dev-import-msg');
  const importCommit = $<HTMLButtonElement>('dev-import-commit');
  const importClose = $<HTMLButtonElement>('dev-import-close');
  let importRows: ImportDraft[] = [];

  const renderImport = (reply: ImportReply) => {
    const drafts = reply.drafts ?? [];
    importRows = drafts.filter((draft) => draft.ready);
    const skipped = reply.skipped ?? [];
    const incomplete = drafts.length - importRows.length;
    const total = reply.total ?? drafts.length;
    importSummary.textContent = `文件里共 ${total} 条链接：可导入 ${importRows.length} 条，重复或无效 ${total - drafts.length} 条${incomplete ? `，${incomplete} 条需补分区或分类（去「＋ 新增」里逐条收）` : ''}。导入的条目都会标成「待看」，简介先写成占位文字。`;
    importList.replaceChildren();
    for (const draft of drafts.slice(0, 200)) {
      const line = document.createElement('p');
      const text = document.createElement('span');
      const host = (() => {
        try {
          return new URL(draft.url).hostname.replace(/^www\./, '');
        } catch {
          return '';
        }
      })();
      text.textContent = `${draft.ready ? '✓' : '·'} ${draft.title} — ${host}${draft.folder ? `（${draft.folder}）` : ''} `;
      if (!draft.ready) text.className = 'dev-skip';
      line.append(text);
      line.append(externalLink('打开', draft.url));
      importList.append(line);
    }
    importMsg.textContent = skipped.length ? `已跳过：${skipped.slice(0, 5).map((item) => item.reason).join(' / ')}${skipped.length > 5 ? ' …' : ''}` : '';
    importCommit.textContent = importRows.length ? `导入 ${importRows.length} 条` : '没有可导入的条目';
    importCommit.disabled = importRows.length === 0;
    importDlg.showModal();
  };

  importBtn.addEventListener('click', () => importFile.click());
  importClose.addEventListener('click', () => importDlg.close());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) return;
    if (file.size > 8_000_000) {
      toast('书签文件太大（上限 8 MB）', { tone: 'bad' });
      return;
    }
    const html = await file.text();
    const reply = await send<ImportReply>('import-bookmarks', { html });
    if (!reply.ok) {
      toast(reply.message ?? '读不出这个书签文件', { tone: 'bad' });
      return;
    }
    renderImport(reply);
  });
  importCommit.addEventListener('click', async () => {
    importCommit.disabled = true;
    importMsg.textContent = '写入中…';
    const reply = await send<{ ok: boolean; message?: string; total?: number }>('import-bookmarks', {
      commit: true,
      rows: importRows,
    });
    importCommit.disabled = false;
    if (!reply.ok) {
      importMsg.textContent = reply.message ?? '导入失败';
      return;
    }
    importDlg.close();
    toast(reply.message ?? `已导入 ${importRows.length} 条`, { tone: 'ok' });
    window.setTimeout(() => location.reload(), 600);
  });
};
