import type { WorkspaceListing } from '../shared/computer-types';
// The composer's "+" references a file from the Dot's computer as @path, written the
// way the Dot sees it: relative to its own folder, where Claude Code runs.

/** Folders nobody means to point a Dot at; listing them would bury real files. */
const NOISE = /(^|\/)(node_modules|\.git|\.venv|venv|__pycache__|dist)\//;

/** The Dot's own files (not folders), relative to its folder. */
export function dotFiles(listing: WorkspaceListing, directory: string) {
  const prefix = `${directory.replace(/\/+$/, '')}/`;
  return listing.files
    .filter((path) => path.startsWith(prefix) && !path.endsWith('/'))
    .map((path) => path.slice(prefix.length))
    .filter((path) => path && !NOISE.test(path));
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * Files matching every word of the query, best first: a match in the file's own name
 * beats one only in its folders, and shorter paths come before deeper ones.
 */
export function matchFiles(files: string[], query: string, limit = 50) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = files
    .filter((path) => {
      const lower = path.toLowerCase();
      return words.every((word) => lower.includes(word));
    })
    .map((path) => {
      const name = baseName(path).toLowerCase();
      const inName = words.filter((word) => name.includes(word)).length;
      return { path, inName, depth: path.split('/').length };
    });
  scored.sort(
    (a, b) =>
      b.inName - a.inName || a.depth - b.depth || a.path.localeCompare(b.path),
  );
  return scored.slice(0, limit).map((item) => item.path);
}

/**
 * The composer's text with "@path" put where the selection was, and where the cursor
 * goes after it. Spaces keep the reference apart from the words around it.
 */
export function insertReference(
  value: string,
  start: number,
  end: number,
  path: string,
) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = /^\s/.test(after) ? '' : ' ';
  const reference = `${lead}@${path}${trail}`;
  return {
    value: before + reference + after,
    cursor: before.length + reference.length,
  };
}
