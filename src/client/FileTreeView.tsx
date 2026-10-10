import { useEffect, useRef } from 'react';
import { FileTree, useFileTree } from '@pierre/trees/react';
/**
 * A Dot's workspace folder as a tree (trees.software, ``@pierre/trees``). ``files`` are paths
 * relative to the folder, with a trailing "/" for empty folders, as Hearth-Core lists them.
 */
export function FileTreeView({
  files,
  selected,
  onSelect,
}: {
  files: string[];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const select = useRef(onSelect);
  select.current = onSelect;
  const { model } = useFileTree({
    paths: files,
    initialExpansion: 'open',
    flattenEmptyDirectories: true,
    density: 'compact',
    icons: { set: 'standard', colored: true },
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
    model.resetPaths(files);
  }, [model, key, files]);
  useEffect(() => {
    if (!selected) return;
    const item = model.getItem(selected);
    if (item && !item.isSelected()) {
      for (const path of model.getSelectedPaths())
        model.getItem(path)?.deselect();
      item.select();
      model.scrollToPath(selected, { focus: false, offset: 'nearest' });
    }
  }, [model, selected, key]);
  return <FileTree model={model} className="file-tree" />;
}
