/**
 * Claude Code works with absolute paths; people read them relative to the Dot's folder.
 * ``wc -l /workspace/dots/scout/notes/a.md`` → ``wc -l ~/notes/a.md`` for the Dot in ``dots/scout``.
 * Windows paths (``C:\…\dots\scout\notes\a.md``) shorten the same way, with forward slashes.
 */
export function shortPath(text: string, directory: string) {
  const folder = directory.replace(/^\/+|\/+$/g, '');
  if (!folder) return text;
  const escaped = folder
    .split('/')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[/\\\\]');
  return text.replace(
    new RegExp(`[^\\s'"]*[/\\\\]${escaped}(?=$|[\\s'"/\\\\])([^\\s'"]*)`, 'g'),
    (_match, rest: string) => `~${rest.replaceAll('\\', '/')}`,
  );
}
/** ``~/notes/a.md`` → ``notes/a.md`` (a path the Files tab can open), or null outside the folder. */
export function folderRelative(path: string) {
  const match = /^~\/(.+)$/.exec(path.replaceAll('\\', '/'));
  return match && !match[1].split('/').includes('..') ? match[1] : null;
}
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
