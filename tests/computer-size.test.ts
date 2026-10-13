import { afterEach, expect, it, vi } from 'vitest';
import {
  clampComputerWidth,
  DEFAULT_COMPUTER_WIDTH,
  MIN_COMPUTER_WIDTH,
  saveComputerWidth,
  savedComputerWidth,
} from '../src/client/computer-size';

afterEach(() => vi.unstubAllGlobals());

it('keeps the computer between its minimum and what leaves the conversation room', () => {
  expect(clampComputerWidth(100, 1600)).toBe(MIN_COMPUTER_WIDTH);
  expect(clampComputerWidth(520.4, 1600)).toBe(520);
  // 1600 − 248 sidebar − 360 conversation
  expect(clampComputerWidth(5000, 1600)).toBe(992);
  // a narrow window never squeezes it below the minimum
  expect(clampComputerWidth(5000, 700)).toBe(MIN_COMPUTER_WIDTH);
});

it('remembers the width, and falls back when storage is missing or blocked', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  expect(savedComputerWidth()).toBe(DEFAULT_COMPUTER_WIDTH);
  saveComputerWidth(540);
  expect(savedComputerWidth()).toBe(540);
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  });
  expect(savedComputerWidth()).toBe(DEFAULT_COMPUTER_WIDTH);
  expect(() => saveComputerWidth(400)).not.toThrow();
});
