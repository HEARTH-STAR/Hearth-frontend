import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { setThemePreference } from '../client/theme';
// The landing page's light/dark switch. It saves the same choice as the app's
// Settings (src/client/theme.ts), so the two always match.

type Theme = 'light' | 'dark';

/** The theme on screen now: what theme.js or theme.ts put on <html>. */
function shownTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export const nextTheme = (current: Theme): Theme =>
  current === 'dark' ? 'light' : 'dark';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(shownTheme);
  // Follow every change, including the system switching while "System" is chosen.
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(shownTheme()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    setTheme(shownTheme());
    return () => observer.disconnect();
  }, []);
  const next = nextTheme(theme);
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => setThemePreference(next)}
    >
      {theme === 'dark' ? (
        <Sun size={17} aria-hidden="true" />
      ) : (
        <Moon size={17} aria-hidden="true" />
      )}
    </button>
  );
}
