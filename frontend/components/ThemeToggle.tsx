"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Moon, Sun, Monitor } from "lucide-react";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  // useEffect only runs on the client, so now we can safely show the UI
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const cycleTheme = () => {
    if (theme === "light") setTheme("dark");
    else if (theme === "dark") setTheme("system");
    else setTheme("light");
  };

  return (
    <button
      onClick={cycleTheme}
      className="p-2 rounded-md hover:bg-neutral-200 dark:hover:bg-neutral-800 transition-colors"
      aria-label="Toggle theme"
    >
      {theme === "light" && <Sun className="w-5 h-5 text-yellow-500" />}
      {theme === "dark" && <Moon className="w-5 h-5 text-blue-400" />}
      {theme === "system" && <Monitor className="w-5 h-5 text-neutral-500 dark:text-neutral-400" />}
    </button>
  );
}
