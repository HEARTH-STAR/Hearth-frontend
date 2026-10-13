import { useEffect, useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Element, ElementContent } from 'hast';

/** The text of a hast node, as the code block holds it. */
export function textOf(node: Element | ElementContent): string {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map(textOf).join('') : '';
}
/** ``language-python`` on the block's ``<code>`` → ``python``. */
export function languageOf(pre?: Element) {
  const code = pre?.children.find(
    (child): child is Element =>
      child.type === 'element' && child.tagName === 'code',
  );
  const classes = code?.properties?.className;
  const names = Array.isArray(classes) ? classes.map(String) : [];
  return names.find((name) => name.startsWith('language-'))?.slice(9) ?? null;
}

/** A code block in a reply, as a card: its language and a Copy button above the code. */
export function CodeCard({
  node,
  children,
}: {
  node?: Element;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const text = node ? textOf(node).replace(/\n$/, '') : '';
  return (
    <div className="code-card">
      <div className="code-card-head">
        <span>{languageOf(node) ?? 'code'}</span>
        <button
          type="button"
          aria-label={copied ? 'Copied' : 'Copy code'}
          onClick={() => {
            void navigator.clipboard
              ?.writeText(text)
              .then(() => setCopied(true))
              .catch(() => {});
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}
