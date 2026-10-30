// GitHub's ``patch`` for one file of a pull request (unified diff hunks), as rows to render with the
// line numbers of both sides.

export interface DiffRow {
  kind: 'hunk' | 'add' | 'del' | 'context' | 'note';
  /** The line without its +, - or space marker (the whole header for a hunk). */
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): DiffRow[] {
  const lines = patch.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.at(-1) === '') lines.pop();
  const rows: DiffRow[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of lines) {
    const hunk = HUNK.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: 'hunk', text: line, oldLine: null, newLine: null });
    } else if (!inHunk || line.startsWith('\\')) {
      // "\ No newline at end of file", or a header before the first hunk.
      rows.push({
        kind: 'note',
        text: line.replace(/^\\ ?/, ''),
        oldLine: null,
        newLine: null,
      });
    } else if (line.startsWith('+'))
      rows.push({
        kind: 'add',
        text: line.slice(1),
        oldLine: null,
        newLine: newLine++,
      });
    else if (line.startsWith('-'))
      rows.push({
        kind: 'del',
        text: line.slice(1),
        oldLine: oldLine++,
        newLine: null,
      });
    // A context line keeps its leading space; some tools strip it from an empty line.
    else
      rows.push({
        kind: 'context',
        text: line.slice(1),
        oldLine: oldLine++,
        newLine: newLine++,
      });
  }
  return rows;
}
