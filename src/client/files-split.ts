// The Files tab's split between the tree and the open file: dragged, remembered per browser.
// ``width`` applies when they sit side by side, ``height`` when the tree is stacked above.

const KEY = 'hearth-files-tree';
export interface TreeSize {
  width?: number;
  height?: number;
}
/**
 * The least the tree and the code each keep, across and down. Below 220px across, the tree
 * shortens nested names to a few letters (``st…ge`` for ``storage``), so it stops there.
 */
export const LIMITS = {
  width: { tree: 220, code: 220 },
  height: { tree: 100, code: 120 },
} as const;

export function clampTree(size: number, total: number, axis: keyof TreeSize) {
  const { tree, code } = LIMITS[axis];
  return Math.round(
    Math.min(Math.max(size, tree), Math.max(tree, total - code)),
  );
}
const positive = (value: unknown) =>
  typeof value === 'number' && value > 0 ? value : undefined;
export function savedTreeSize(): TreeSize {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as TreeSize;
    return { width: positive(saved.width), height: positive(saved.height) };
  } catch {
    return {};
  }
}
export function saveTreeSize(size: TreeSize) {
  try {
    localStorage.setItem(KEY, JSON.stringify(size));
  } catch {
    // Private windows and blocked storage: the split just isn't remembered.
  }
}
