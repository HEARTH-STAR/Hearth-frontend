import type {
  Heading,
  Paragraph,
  PhrasingContent,
  Root,
  RootContent,
} from 'mdast';

/** A paragraph that is only bold text (``**The core loop**``, maybe with a colon): a title. */
function boldTitle(node: RootContent): PhrasingContent[] | null {
  if (node.type !== 'paragraph') return null;
  const [first, ...rest] = (node as Paragraph).children;
  if (first?.type !== 'strong') return null;
  const tail = rest
    .map((child) => (child.type === 'text' ? child.value : '\u0000'))
    .join('')
    .trim();
  if (tail !== '' && tail !== ':') return null;
  // "**Second part:**" titles the card "Second part".
  const children = [...first.children];
  const last = children.at(-1);
  if (last?.type === 'text')
    children[children.length - 1] = {
      ...last,
      value: last.value.replace(/\s*:\s*$/, ''),
    };
  return children;
}

/** A card node: remark-rehype renders it as ``<section class="reply-card …">`` (data.hName). */
function card(children: RootContent[], className: string[]) {
  return {
    // Not an mdast type; data.hName and data.hProperties make it an element.
    type: 'replySection',
    children,
    data: { hName: 'section', hProperties: { className } },
  } as unknown as RootContent & { children: RootContent[] };
}

/**
 * A remark plugin for Dot replies: every reply is set in cards. Each section under the reply's
 * top headings becomes a card (``<section class="reply-card">``), the heading as its title; text
 * before the first heading stays plain, and deeper headings stay inside their card. Bold lines
 * used as titles (two or more, in a reply without headings) count as headings. Any other reply
 * is one untitled card (``reply-card whole``).
 */
export function remarkReplySections() {
  return (tree: Root) => {
    if (!tree.children.some((node) => node.type === 'heading')) {
      const titles = tree.children.filter((node) => boldTitle(node));
      if (titles.length >= 2)
        tree.children = tree.children.map((node) => {
          const title = boldTitle(node);
          return title
            ? ({ type: 'heading', depth: 2, children: title } as Heading)
            : node;
        });
    }
    const depths = tree.children
      .filter((node): node is Heading => node.type === 'heading')
      .map((heading) => heading.depth);
    const depth = depths.length ? Math.min(...depths) : 0;
    if (!depth || depth > 3) {
      if (tree.children.length)
        tree.children = [card(tree.children, ['reply-card', 'whole'])];
      return;
    }
    const children: RootContent[] = [];
    let section: ReturnType<typeof card> | undefined;
    for (const node of tree.children) {
      if (node.type === 'heading' && node.depth === depth) {
        section = card([node], ['reply-card']);
        children.push(section);
      } else if (section) section.children.push(node);
      else children.push(node);
    }
    tree.children = children;
  };
}
