// Small drawings for the two large feature cards. They tell the same story as the
// hero demo (acme-pay v4: 7 usages in 4 files, 42 tests passing), in markup.

export const USAGES = [
  { file: 'src/billing/charge.ts', count: 3 },
  { file: 'src/billing/refund.ts', count: 2 },
  { file: 'src/api/webhooks.ts', count: 1 },
  { file: 'scripts/backfill.ts', count: 1 },
];
export const TEST_FILES = [
  { file: 'billing/charge.test.ts', count: 12 },
  { file: 'billing/refund.test.ts', count: 9 },
  { file: 'api/webhooks.test.ts', count: 21 },
];

export function UsageVisual() {
  const total = USAGES.reduce((sum, usage) => sum + usage.count, 0);
  return (
    <div className="visual visual-usages" aria-hidden="true">
      <div className="visual-search">
        <code>acme.charges.create</code>
        <span>
          {total} results in {USAGES.length} files
        </span>
      </div>
      <ul>
        {USAGES.map((usage) => (
          <li key={usage.file}>
            <code>{usage.file}</code>
            <span className="visual-count">{usage.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TestsVisual() {
  const total = TEST_FILES.reduce((sum, test) => sum + test.count, 0);
  return (
    <div className="visual visual-terminal" aria-hidden="true">
      <p className="visual-prompt">$ npm test</p>
      {TEST_FILES.map((test) => (
        <p key={test.file}>
          <span className="visual-pass">✓</span> {test.file}{' '}
          <span className="visual-dim">({test.count})</span>
        </p>
      ))}
      <p className="visual-summary">
        Tests <span className="visual-pass">{total} passed</span> ({total})
      </p>
    </div>
  );
}
