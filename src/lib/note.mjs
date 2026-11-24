// 笔记的 Markdown 子集渲染。
//
// 故意只支持一点点：段落、无序列表、**粗体**、`代码`、[文字](链接)。
// 不做表格/标题/嵌套，避免在自己写的半吊子解析器上踩坑；够写「为什么收它 + 关键结论」即可。
// 输出前先转义 HTML，所以贴进来的标签不会变成结构。

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const linkify = (href, label) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;

const inline = (text) =>
  escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // 只认 http(s)：别让 javascript: 之类的东西混进 href
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => linkify(href, label));

const isBullet = (line) => /^\s*[-*]\s+/.test(line);

export const renderNote = (text) => {
  const source = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!source) return '';

  const blocks = source.split(/\n{2,}/);
  const out = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim());
    if (!lines.length) continue;

    if (lines.every(isBullet)) {
      const items = lines.map((line) => `<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`).join('');
      out.push(`<ul>${items}</ul>`);
      continue;
    }

    const body = lines.map((line) => inline(line.trim())).join('<br />');
    out.push(`<p>${body}</p>`);
  }

  return out.join('\n');
};
