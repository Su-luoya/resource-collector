const plainText = (value: string) =>
  value.trim().replace(/\s+/g, ' ').replace(/[\\[\]`*_~<>]|&(?=[#\w]+;)/g, '\\$&');

export function markdownItem(title: string, url: string, desc: string): string {
  const href = url.replace(/[\\()]|&(?=[#\w]+;)/g, '\\$&');
  return `- [${plainText(title)}](${href}) — ${plainText(desc)}`;
}
