import pierreDark from '@pierre/theme/pierre-dark';
import { themeToTreeStyles } from '@pierre/trees';
// The Files tab looks like trees.software's editor: Pierre Dark for the tree and the code.

export const codeTheme = pierreDark;
/** ``--trees-theme-*`` variables for the file tree, from the same theme. */
export const treeStyles = themeToTreeStyles(pierreDark);
const colors = pierreDark.colors;
/** The editor's surfaces, as CSS variables for ``.code-workspace``. */
export const editorStyles = {
  '--code-bg': colors['editor.background'],
  '--code-fg': colors['editor.foreground'],
  '--code-sidebar': colors['sideBar.background'],
  '--code-tabs': colors['editorGroupHeader.tabsBackground'],
  '--code-line-number': colors['editorLineNumber.foreground'],
  '--code-muted':
    colors['sideBar.foreground'] ?? colors['editorLineNumber.foreground'],
} as Record<string, string>;

/** Above this the file shows as plain text: highlighting it would stall the panel. */
export const HIGHLIGHT_LIMIT = 200_000;

const BY_NAME: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'make',
  '.gitignore': 'ini',
  '.dockerignore': 'ini',
  '.env': 'dotenv',
  '.env.example': 'dotenv',
};
const BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  md: 'markdown',
  mdx: 'mdx',
  py: 'python',
  pyi: 'python',
  sh: 'shellscript',
  bash: 'shellscript',
  zsh: 'shellscript',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  lua: 'lua',
  diff: 'diff',
  patch: 'diff',
  txt: 'text',
};
/** Shiki's language for a file, from its name; ``text`` when unknown. */
export function languageFor(path: string) {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  if (BY_NAME[name]) return BY_NAME[name];
  if (name.startsWith('.env')) return 'dotenv';
  const dot = name.lastIndexOf('.');
  return (dot > 0 && BY_EXTENSION[name.slice(dot + 1)]) || 'text';
}

/** Highlighted HTML (Shiki escapes the text), or null for plain text. Loads Shiki on first use. */
export async function highlight(text: string, path: string) {
  const lang = languageFor(path);
  if (lang === 'text' || text.length > HIGHLIGHT_LIMIT) return null;
  const { codeToHtml } = await import('shiki');
  try {
    return await codeToHtml(text, {
      lang,
      theme: structuredClone(pierreDark) as never,
    });
  } catch {
    return null; // a language Shiki does not know
  }
}
