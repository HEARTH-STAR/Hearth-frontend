import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import {
  dotFiles,
  insertReference,
  matchFiles,
} from '../src/client/file-reference';
import { FilePicker } from '../src/client/FilePicker';
import type { WorkspaceListing } from '../src/shared/computer-types';

const listing: WorkspaceListing = {
  directory: '',
  exists: true,
  truncated: false,
  files: [
    'hearth-core/server.py',
    'dots/scout-1234/',
    'dots/scout-1234/README.md',
    'dots/scout-1234/src/',
    'dots/scout-1234/src/billing/charge.ts',
    'dots/scout-1234/src/billing/refund.ts',
    'dots/scout-1234/src/api/webhooks.ts',
    'dots/scout-1234/node_modules/acme-pay/index.js',
    'dots/scout-1234/.git/HEAD',
    'dots/scout-12345/other.ts',
  ],
};

it('lists only the Dot’s own files, as the Dot sees them', () => {
  expect(dotFiles(listing, 'dots/scout-1234')).toEqual([
    'README.md',
    'src/billing/charge.ts',
    'src/billing/refund.ts',
    'src/api/webhooks.ts',
  ]);
  // A trailing slash on the folder changes nothing.
  expect(dotFiles(listing, 'dots/scout-1234/')).toHaveLength(4);
  // Another Dot whose folder name starts the same is not included.
  expect(dotFiles(listing, 'dots/scout-1234')).not.toContain('other.ts');
});

it('finds files by every word typed, file names first', () => {
  const files = dotFiles(listing, 'dots/scout-1234');
  expect(matchFiles(files, '')).toEqual([
    'README.md',
    'src/api/webhooks.ts',
    'src/billing/charge.ts',
    'src/billing/refund.ts',
  ]);
  expect(matchFiles(files, 'charge')).toEqual(['src/billing/charge.ts']);
  expect(matchFiles(files, 'BILLING ts')).toEqual([
    'src/billing/charge.ts',
    'src/billing/refund.ts',
  ]);
  // A folder name matches too: "api" finds the file inside src/api/.
  expect(matchFiles(files, 'api')).toEqual(['src/api/webhooks.ts']);
  expect(matchFiles(files, 'nothing-like-this')).toEqual([]);
  expect(matchFiles(files, '', 2)).toHaveLength(2);
});

it('puts @path at the cursor, with spaces around it', () => {
  // Empty composer.
  expect(insertReference('', 0, 0, 'a.ts')).toEqual({
    value: '@a.ts ',
    cursor: 6,
  });
  // After a word: a space before it.
  expect(insertReference('Fix', 3, 3, 'a.ts')).toEqual({
    value: 'Fix @a.ts ',
    cursor: 10,
  });
  // In the middle, next to existing spaces: no doubled spaces.
  expect(insertReference('Fix  please', 4, 4, 'a.ts')).toEqual({
    value: 'Fix @a.ts please',
    cursor: 9,
  });
  // Over a selection: the selection is replaced.
  expect(insertReference('Fix [file] now', 4, 10, 'src/a.ts')).toEqual({
    value: 'Fix @src/a.ts now',
    cursor: 13,
  });
});

it('opens with a search box and says it is loading', () => {
  const html = renderToStaticMarkup(
    <FilePicker
      name="Scout"
      load={() => new Promise(() => {})}
      onPick={() => {}}
      onClose={() => {}}
      onOpenFiles={() => {}}
    />,
  );
  expect(html).toContain('aria-label="Reference one of Scout’s files"');
  expect(html).toContain('placeholder="Search files"');
  expect(html).toContain('Loading Scout’s files…');
  expect(html).toContain('Open the Files panel');
});
