// 链接维护对话框：体检判为失效或需要确认的条目，可单条复查、改地址或直接采用新地址。
import {
  $,
  actionButton,
  externalLink,
  type Deps,
  type LinkTask,
} from './editor-shared';
import { toast } from './toast';

export const setupMaintenance = ({ send, say, flash, refresh, guardBatch, openForm }: Deps) => {
  const maintenanceBtn = $<HTMLButtonElement>('dev-maintenance');
  const maintenanceDlg = $<HTMLDialogElement>('dev-maintenance-dialog');
  const maintenanceList = $<HTMLDivElement>('dev-maintenance-list');
  const maintenanceClose = $<HTMLButtonElement>('dev-maintenance-close');

  function maintenanceItem(task: LinkTask) {
    const item = document.createElement('article');
    item.className = 'dev-maintenance-item';

    const head = document.createElement('div');
    head.className = 'dev-maintenance-item-head';
    const name = document.createElement('strong');
    name.textContent = task.row.title;
    const kind = document.createElement('span');
    kind.className = `dev-maintenance-kind ${task.kind}`;
    kind.textContent = task.kind === 'fail' ? '可能失效' : '重定向待确认';
    head.append(name, kind);

    const reason = document.createElement('p');
    reason.className = 'dev-maintenance-reason';
    const checked = task.status.checked ? ` · 最近检查 ${task.status.checked}` : '';
    reason.textContent = `${task.reason}${checked}`;

    const original = document.createElement('p');
    original.className = 'dev-maintenance-url';
    original.append(document.createTextNode('原地址：'), externalLink(task.row.url, task.row.url));
    item.append(head, reason, original);

    if (task.status.final && task.status.final !== task.row.url) {
      const final = document.createElement('p');
      final.className = 'dev-maintenance-url';
      final.append(document.createTextNode('最终地址：'), externalLink(task.status.final, task.status.final));
      item.append(final);
    }

    const actions = document.createElement('div');
    actions.className = 'dev-maintenance-actions';
    const recheck = actionButton('单条复查');
    recheck.addEventListener('click', async () => {
      recheck.disabled = true;
      recheck.textContent = '复查中…';
      const res = await send('recheck', { url: task.row.url });
      if (!res.ok) {
        toast(res.message || '复查失败', { tone: 'bad' });
        recheck.disabled = false;
        recheck.textContent = '单条复查';
        return;
      }
      await loadMaintenance();
    });

    const edit = actionButton(task.kind === 'redirect' ? '编辑替代地址' : '编辑链接');
    edit.addEventListener('click', () => {
      maintenanceDlg.close();
      openForm(task.row, task.kind === 'redirect' ? task.status.final : undefined);
    });
    actions.append(recheck, edit);

    if (task.kind === 'redirect' && task.status.final) {
      const adopt = actionButton('采用新地址');
      adopt.className = 'primary';
      adopt.addEventListener('click', async () => {
        adopt.disabled = true;
        const res = await send('edit', {
          action: 'update',
          url: task.row.url,
          newUrl: task.status.final,
        });
        if (!res.ok) {
          adopt.disabled = false;
          toast(res.errors?.join('；') || res.message || '更新失败', { tone: 'bad' });
          return;
        }
        say(res.message || '已采用新地址');
        flash(res.message || '已采用新地址', 'ok');
        refresh();
      });
      actions.append(adopt);
    }

    item.append(actions);
    return item;
  }

  async function loadMaintenance() {
    const res = await send('maintenance');
    if (!res.ok) {
      maintenanceBtn.textContent = '链接维护（读取失败）';
      return;
    }
    const tasks = res.tasks ?? [];
    maintenanceBtn.textContent = `链接维护${tasks.length ? `（${tasks.length}）` : ''}`;
    maintenanceList.replaceChildren();
    if (!tasks.length) {
      const empty = document.createElement('p');
      empty.className = 'dev-maintenance-empty';
      empty.textContent = '暂无需要处理的链接。';
      maintenanceList.append(empty);
      return;
    }
    maintenanceList.append(...tasks.map(maintenanceItem));
  }

  maintenanceBtn.addEventListener('click', () => {
    if (!guardBatch('处理链接维护')) return;
    maintenanceDlg.showModal();
    void loadMaintenance();
  });
  maintenanceClose.addEventListener('click', () => maintenanceDlg.close());

  return { load: loadMaintenance };
};
