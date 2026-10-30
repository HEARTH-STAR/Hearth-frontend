import { expect, it } from 'vitest';
import { parsePatch } from '../src/client/pull-diff';

it('numbers both sides of each hunk', () => {
  const rows = parsePatch(
    [
      '@@ -1,3 +1,4 @@ import',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' export { a };',
      '@@ -20,2 +21,2 @@ function pay()',
      '-  stripe.charges.create(x);',
      '+  stripe.paymentIntents.create(x);',
      ' }',
      '',
    ].join('\n'),
  );
  expect(rows.map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([
    ['hunk', null, null],
    ['context', 1, 1],
    ['del', 2, null],
    ['add', null, 2],
    ['add', null, 3],
    ['context', 3, 4],
    ['hunk', null, null],
    ['del', 20, null],
    ['add', null, 21],
    ['context', 21, 22],
  ]);
  expect(rows[0].text).toBe('@@ -1,3 +1,4 @@ import');
  expect(rows[2].text).toBe('const b = 2;');
  expect(rows[8].text).toBe('  stripe.paymentIntents.create(x);');
});

it('keeps "No newline at end of file" as a note without a line number', () => {
  const rows = parsePatch(
    '@@ -1 +1 @@\r\n-old\r\n\\ No newline at end of file\r\n+new\r\n\\ No newline at end of file',
  );
  expect(rows).toEqual([
    { kind: 'hunk', text: '@@ -1 +1 @@', oldLine: null, newLine: null },
    { kind: 'del', text: 'old', oldLine: 1, newLine: null },
    {
      kind: 'note',
      text: 'No newline at end of file',
      oldLine: null,
      newLine: null,
    },
    { kind: 'add', text: 'new', oldLine: null, newLine: 1 },
    {
      kind: 'note',
      text: 'No newline at end of file',
      oldLine: null,
      newLine: null,
    },
  ]);
});

it('reads a new file and an empty context line', () => {
  const rows = parsePatch('@@ -0,0 +1,2 @@\n+a\n+b');
  expect(rows.slice(1).map((row) => row.newLine)).toEqual([1, 2]);
  const context = parsePatch('@@ -5,3 +5,3 @@\n x\n\n-y\n+z');
  expect(context.map((row) => [row.kind, row.oldLine, row.newLine])).toEqual([
    ['hunk', null, null],
    ['context', 5, 5],
    ['context', 6, 6],
    ['del', 7, null],
    ['add', null, 7],
  ]);
});
