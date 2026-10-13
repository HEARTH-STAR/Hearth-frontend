// How wide the computer panel is: dragged by its left edge, remembered per browser.

const KEY = 'hearth-computer-width';
export const DEFAULT_COMPUTER_WIDTH = 360;
export const MIN_COMPUTER_WIDTH = 300;
/** The sidebar and the room the conversation keeps beside the panel. */
const SIDEBAR = 248;
const MIN_CONVERSATION = 360;

export function clampComputerWidth(width: number, viewport: number) {
  const widest = Math.max(
    MIN_COMPUTER_WIDTH,
    viewport - SIDEBAR - MIN_CONVERSATION,
  );
  return Math.round(Math.min(Math.max(width, MIN_COMPUTER_WIDTH), widest));
}
export function savedComputerWidth() {
  try {
    const saved = Number(localStorage.getItem(KEY));
    return saved > 0 ? saved : DEFAULT_COMPUTER_WIDTH;
  } catch {
    return DEFAULT_COMPUTER_WIDTH;
  }
}
export function saveComputerWidth(width: number) {
  try {
    localStorage.setItem(KEY, String(width));
  } catch {
    // Private windows and blocked storage: the width just isn't remembered.
  }
}
