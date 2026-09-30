"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export function ThemeToggle({ labels }: { labels: { dark: string; light: string } }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("qkern-theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = stored ? stored === "dark" : prefersDark;
    setDark(initial);
    document.documentElement.dataset.theme = initial ? "dark" : "light";
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("qkern-theme", next ? "dark" : "light");
  }

  return (
    <button className="icon-button" onClick={toggle} aria-label={dark ? labels.light : labels.dark}>
      {dark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}
