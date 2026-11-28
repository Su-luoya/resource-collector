// 发布对话框：先看数据差异，再建一个后台任务，进度靠轮询任务表。
// 任务 id 存 sessionStorage：补图标会触发 Vite 整页重载，刷新后要能把进度接回来。
import {
  $,
  externalLink,
  formatValue,
  progressLine,
  type ApiReply,
  type Deps,
  type PublishPreview,
  type Row,
} from './editor-shared';
import { emptyTask, pollTask, renderTask, type TaskSnapshot } from './task';
import { toast } from './toast';

const PUBLISH_KEY = 'dev-publish-task';

export const setupPublish = ({ send, say, guardBatch }: Deps) => {
  const publishBtn = $<HTMLButtonElement>('dev-publish');
  const publishDlg = $<HTMLDialogElement>('dev-publish-dialog');
  const publishSummary = $<HTMLParagraphElement>('dev-publish-summary');
  const publishList = $<HTMLDivElement>('dev-publish-list');
  const publishErr = $<HTMLParagraphElement>('dev-publish-err');
  const publishConfirm = $<HTMLButtonElement>('dev-publish-confirm');
  const publishCancel = $<HTMLButtonElement>('dev-publish-cancel');
  const publishProgress = $<HTMLDivElement>('dev-publish-progress');

  let publishTaskId: string | null = null;
  let publishFinished = false;

  function showStatus(status: ApiReply) {
    const { dirty, ahead, behind, branch, head, added = 0, removed = 0, changed = 0 } = status;
    publishBtn.textContent = '发布';
    const notes: string[] = [];
    if (behind) notes.push(`落后 origin/${branch} ${behind} 个提交，请先在终端同步`);
    if (dirty) notes.push(added || removed || changed ? `未发布：+${added} −${removed} ~${changed}` : '有未发布的体检或图标变化');
    if (ahead) notes.push(`${ahead} 个本地提交尚未推送`);
    if (ahead === null) notes.push(`没有 origin/${branch} 的本地记录`);
    const summary = status.ok ? notes.join('；') || `已同步 ${branch}@${head}` : status.message || '读不到状态';
    say(summary, !status.ok || behind ? 'bad' : notes.length ? 'dirty' : 'idle');
    return summary;
  }

  function renderPublish(status: ApiReply, preview: PublishPreview | null) {
    // 后端没给的字段一律当空：缺一个数组不该让整个对话框打不开。
    const added = preview?.added ?? [];
    const removed = preview?.removed ?? [];
    const changed = preview?.changed ?? [];
    const icons = preview?.icons ?? [];
    const statusChanged = Boolean(preview?.statusChanged);
    const counts = `资源 +${added.length} −${removed.length} ~${changed.length}`;
    publishSummary.textContent = `目标：origin/${status.branch ?? '?'} · ${counts}`;
    publishList.replaceChildren();

    const group = (label: string, rows: Row[], className: string) => {
      if (!rows.length) return;
      const titleEl = document.createElement('h4');
      titleEl.textContent = `${label}（${rows.length}）`;
      publishList.append(titleEl);
      for (const row of rows) {
        const item = document.createElement('article');
        item.className = `dev-publish-item ${className}`;
        const name = document.createElement('strong');
        name.textContent = row.title;
        const link = document.createElement('p');
        link.append(externalLink(row.url, row.url));
        item.append(name, link);
        publishList.append(item);
      }
    };

    if (preview) {
      group('新增资源', added, 'added');
      group('删除资源', removed, 'removed');
      if (changed.length) {
        const titleEl = document.createElement('h4');
        titleEl.textContent = `修改资源（${changed.length}）`;
        publishList.append(titleEl);
        for (const { before, after } of changed) {
          const item = document.createElement('article');
          item.className = 'dev-publish-item changed';
          const name = document.createElement('strong');
          name.textContent = after.title;
          item.append(name);
          const fields = [
            ['title', '标题'], ['url', 'URL'], ['desc', '简介'],
            ['section', '分区'], ['facets', '分类'], ['added', '收录日期'], ['read', '阅读状态'],
          ] as const;
          for (const [key, label] of fields) {
            if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
            const line = document.createElement('p');
            line.className = 'dev-diff-field';
            const show = (row: Row) => key === 'read' ? (row.read === false ? '待看' : '已看') : formatValue(row[key]);
            line.textContent = `${label}：${show(before)} → ${show(after)}`;
            item.append(line);
          }
          publishList.append(item);
        }
      }

      const extras = document.createElement('div');
      extras.className = 'dev-publish-extras';
      if (statusChanged) {
        const line = document.createElement('p');
        line.textContent = '链接体检状态有变化，页面重建后会跟着更新。';
        extras.append(line);
      }
      if (icons.length) {
        const titleEl = document.createElement('h4');
        titleEl.textContent = '图标与图标索引变化';
        extras.append(titleEl);
        for (const icon of icons) {
          const line = document.createElement('code');
          line.textContent = icon;
          extras.append(line);
        }
      }
      if (!added.length && !removed.length && !changed.length && !statusChanged && !icons.length) {
        const line = document.createElement('p');
        line.textContent = '资源内容、体检状态和图标均无差异，可能只有格式或注释变化。';
        extras.append(line);
      }
      publishList.append(extras);
    } else {
      const line = document.createElement('p');
      line.textContent = '与上次触发重建时的数据一致；仍可重新构建。';
      publishList.append(line);
    }

    const plan = document.createElement('p');
    plan.className = 'dev-publish-plan';
    plan.textContent = '步骤：同步并校验云端数据 → 补抓缺失图标 → 触发远端重建。本地提交不会推送。';
    publishList.append(plan);
    publishErr.hidden = true;
    publishErr.textContent = '';
  }

  publishBtn.addEventListener('click', async () => {
    if (!guardBatch('发布')) return;
    if (publishTaskId) {
      publishDlg.showModal();
      return;
    }
    publishBtn.disabled = true;
    try {
      const status = await send('status');
      const summary = showStatus(status);
      if (!status.ok || status.behind) return;
      const preview = status.dirty ? await send<PublishPreview>('publish-preview') : null;
      if (preview && !preview.ok) {
        say(preview.message || '读取变更预览失败', 'bad');
        toast(preview.message || '读取变更预览失败', { tone: 'bad' });
        return;
      }
      publishFinished = false;
      publishConfirm.textContent = '确认发布';
      publishProgress.hidden = true;
      publishProgress.replaceChildren();
      renderPublish(status, preview);
      publishDlg.showModal();
      publishSummary.title = summary;
    } catch (error) {
      // 任何意外都要说出来，不能只剩一个没反应的按钮。
      const message = `发布检查失败：${(error as Error).message}`;
      say(message, 'bad');
      toast(message, { tone: 'bad' });
    } finally {
      publishBtn.disabled = false;
    }
  });

  /** 收尾：成功后保留步骤结果，失败则给可重试的 Toast */
  function finishPublish(snap: TaskSnapshot) {
    renderTask(publishProgress, snap);
    say(progressLine(snap), snap.status === 'ok' ? 'idle' : 'bad');
    publishConfirm.disabled = false;
    publishCancel.disabled = false;
    const res = (snap.result ?? {}) as ApiReply;
    if (snap.status !== 'ok' || !res.ok) {
      const message = [snap.message || res.message || '发布失败', ...(res.errors ?? [])].join('\n');
      publishErr.textContent = message;
      publishErr.hidden = false;
      say(res.message || snap.message || '发布失败', 'bad');
      toast('发布失败', {
        tone: 'bad',
        detail: message,
        action: { label: '重试', run: () => { if (!publishConfirm.disabled) publishConfirm.click(); } },
      });
      return;
    }
    publishBtn.textContent = '发布';
    const warns = res.warns ?? [];
    say(res.message || '已触发重建', warns.length ? 'dirty' : 'idle');
    toast(warns.length ? '已触发重建，有提醒' : '已触发重建', {
      tone: warns.length ? 'warn' : 'ok',
      detail: warns.length ? warns.join('；') : undefined,
      timeout: warns.length ? 15_000 : 6000,
    });
    publishFinished = true;
    publishConfirm.textContent = '完成并刷新';
    publishConfirm.disabled = false;
    publishCancel.disabled = false;
  }

  /** 轮询一个发布任务直到结束。整页刷新会重置脚本（图标写盘会触发 Vite 重载），
   *  所以这段必须在加载时能重新接上，不能只活在确认按钮的回调里。 */
  async function watchPublish(id: string) {
    publishTaskId = id;
    let snap: TaskSnapshot;
    try {
      snap = await pollTask(id, {
        interval: 300,
        onUpdate: (state) => {
          renderTask(publishProgress, state);
          if (state.status === 'running') say(progressLine(state), 'dirty');
        },
      });
    } finally {
      publishTaskId = null;
    }
    finishPublish(snap);
  }

  publishConfirm.addEventListener('click', async () => {
    // 发布完成后按钮变成「完成并刷新」，让人看完结果再刷新
    if (publishFinished) {
      location.reload();
      return;
    }
    // 不拿 pendingPublish 做闸门：整页重载后接着跑的那次失败发布，这里本来就没有预览状态，
    // 拦住只会让 Toast 上的「重试」变成一个空的按钮。发布本身在服务端还要过校验。
    publishConfirm.disabled = true;
    publishErr.hidden = true;
    publishProgress.hidden = false;
    renderTask(publishProgress, emptyTask('publish'));
    // send 没给 body 会发 GET；发布必须 POST，所以传一个空对象把方法扳过去
    const created = await send<{ ok: boolean; id?: string; message?: string }>('publish', {});
    if (!created.ok || !created.id) {
      publishConfirm.disabled = false;
      publishErr.textContent = created.message || '发布任务创建失败';
      publishErr.hidden = false;
      return;
    }
    sessionStorage.setItem(PUBLISH_KEY, created.id);
    await watchPublish(created.id);
  });

  /** 发布成功后：关对话框才刷新，避免页面在进度条刚走满时闪掉 */
  const closePublished = (event?: Event) => {
    if (event) event.preventDefault();
    if (publishFinished) {
      sessionStorage.removeItem(PUBLISH_KEY);
      location.reload();
      return;
    }
    publishDlg.close();
  };

  publishCancel.addEventListener('click', () => closePublished());
  publishDlg.addEventListener('cancel', (event) => {
    // 发布中允许关掉对话框：任务在服务端继续跑，工具条上的进度仍能看到
    if (publishFinished) return closePublished(event);
  });

  const resumePublish = async () => {
    const id = sessionStorage.getItem(PUBLISH_KEY);
    if (!id) return;
    const state = await send<{ ok: boolean; task?: TaskSnapshot }>(`task?id=${encodeURIComponent(id)}`);
    if (!state.ok || !state.task) {
      sessionStorage.removeItem(PUBLISH_KEY);
      return;
    }
    const snapshot = state.task;
    publishFinished = false;
    publishProgress.hidden = false;
    publishList.replaceChildren();
    publishConfirm.textContent = '确认发布';
    renderTask(publishProgress, snapshot);
    publishSummary.textContent = snapshot.status === 'running' ? '发布正在进行（仍在后台跑）' : '上次发布的进度';
    publishDlg.showModal();
    if (snapshot.status === 'running') {
      publishConfirm.disabled = true;
      await watchPublish(snapshot.id);
    } else {
      finishPublish(snapshot);
    }
    sessionStorage.removeItem(PUBLISH_KEY);
  };

  void send('status').then(showStatus);
  void resumePublish();
};
