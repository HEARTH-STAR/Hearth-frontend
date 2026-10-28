import { useEffect, useRef, type ReactNode } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { treeStyles } from './code-view';

/** ``a/b/c.md`` → ``["a/", "a/b/"]``: the folders on the way, as the tree names them. */
export function foldersOf(path: string) {
  const parts = path.split('/').filter(Boolean);
  return parts
    .slice(0, path.endsWith('/') ? parts.length : parts.length - 1)
    .map((_, i) => `${parts.slice(0, i + 1).join('/')}/`);
}
/**
 * The tree shows a name's "…" once its hidden wrapped copy is taller than one line
 * (``@container measure (height > 1lh)``). At fractional zoom (90%, 110%, …) a name that fits
 * measures a hair over one line, so every name lost its middle (``st…ge``). A real overflow wraps
 * to two lines, so the "…" waits for 1.5 lines. Injected in the tree's own layer after its styles.
 */
export const TRUNCATION_FIX = `
@container measure (height > 1lh) {
  [data-truncate-marker] { opacity: 0; }
}
@container measure (height > 1.5lh) {
  [data-truncate-marker] { opacity: 1; }
}`;
/** Every folder in a listing, from its file paths. */
function allFolders(files: string[]) {
  return [...new Set(files.flatMap(foldersOf))];
}
/**
 * The container's workspace as a tree (trees.software, ``@pierre/trees``), in Pierre Dark. ``files`` are paths
 * relative to the workspace, with a trailing "/" for empty folders, as Hearth-Core lists them.
 * Folders start closed except ``open`` (the Dot's own folder) and the way to it.
 */
export function FileTreeView({
  files,
  open,
  header,
  selected,
  onSelect,
}: {
  files: string[];
  open?: string;
  /** Shown above the tree, like an editor's explorer title. */
  header?: ReactNode;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const select = useRef(onSelect);
  select.current = onSelect;
  const { model } = useFileTree({
    paths: files,
    initialExpansion: 'closed',
    initialExpandedPaths: open ? foldersOf(`${open}/`) : [],
    flattenEmptyDirectories: true,
    density: 'compact',
    icons: { set: 'complete', colored: true },
    unsafeCSS: TRUNCATION_FIX,
    initialSelectedPaths: selected ? [selected] : [],
    onSelectionChange: (paths) => {
      const path = paths[0];
      const item = path ? model.getItem(path) : null;
      if (path && item && !item.isDirectory()) select.current(path);
    },
  });
  const key = files.join('\n');
  const shown = useRef(key);
  useEffect(() => {
    if (shown.current === key) return;
    shown.current = key;
    // A new listing rebuilds the tree; keep the folders the owner had open.
    const expanded = allFolders(files).filter((folder) => {
      const item = model.getItem(folder);
      return !!item && 'isExpanded' in item && item.isExpanded();
    });
    model.resetPaths(files, { initialExpandedPaths: expanded });
  }, [model, key, files]);
  useEffect(() => {
    if (!selected) return;
    const item = model.getItem(selected);
    if (item && !item.isSelected()) {
      for (const folder of foldersOf(selected)) {
        const parent = model.getItem(folder);
        if (parent && 'expand' in parent && !parent.isExpanded())
          parent.expand();
      }
      for (const path of model.getSelectedPaths())
        model.getItem(path)?.deselect();
      item.select();
      model.scrollToPath(selected, { focus: false, offset: 'nearest' });
    }
  }, [model, selected, key]);
  return (
    <FileTree
      model={model}
      className="file-tree"
      style={treeStyles}
      header={header}
    />
  );
}
