import { Moon, Sun } from 'lucide-react';
import type { Theme } from '../../lib/storage';

export function ThemeToggle({
  theme,
  onToggle,
  labelLight,
  labelDark,
}: {
  theme: Theme;
  onToggle: () => void;
  labelLight: string;
  labelDark: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="btn-ghost"
      title={theme === 'dark' ? labelLight : labelDark}
      aria-label={theme === 'dark' ? labelLight : labelDark}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
