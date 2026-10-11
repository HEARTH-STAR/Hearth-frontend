import { afterEach, expect, it, vi } from 'vitest';
import {
  clampTree,
  LIMITS,
  saveTreeSize,
  savedTreeSize,
} from '../src/client/files-split';

afterEach(() => vi.unstubAllGlobals());

it('keeps the tree and the code each above their minimum', () => {
  expect(clampTree(50, 900, 'width')).toBe(LIMITS.width.tree);
  expect(clampTree(420.6, 900, 'width')).toBe(421);
  expect(clampTree(880, 900, 'width')).toBe(900 - LIMITS.width.code);
  expect(clampTree(10, 600, 'height')).toBe(LIMITS.height.tree);
  expect(clampTree(590, 600, 'height')).toBe(600 - LIMITS.height.code);
  // too little room for both: the tree keeps its minimum
  expect(clampTree(300, 200, 'width')).toBe(LIMITS.width.tree);
});

it('remembers the split per axis, and survives broken or blocked storage', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  expect(savedTreeSize()).toEqual({ width: undefined, height: undefined });
  saveTreeSize({ width: 380 });
  expect(savedTreeSize()).toEqual({ width: 380, height: undefined });
  values.set('hearth-files-tree', '{"width":"wide","height":-3}');
  expect(savedTreeSize()).toEqual({ width: undefined, height: undefined });
  values.set('hearth-files-tree', 'not json');
  expect(savedTreeSize()).toEqual({});
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  expect(savedTreeSize()).toEqual({});
  expect(() => saveTreeSize({ height: 200 })).not.toThrow();
});
