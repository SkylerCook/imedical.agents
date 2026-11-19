import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const key = "agents-workbench-appearance-v1";
const choices = {
  dark: { label: "深色", icon: Moon },
  light: { label: "浅色", icon: Sun },
  system: { label: "跟随系统", icon: Monitor },
};
type Appearance = keyof typeof choices;
const valid = (value: string | null): Appearance => value === "light" || value === "system" ? value : "dark";
function initial(): Appearance {
  try { return valid(localStorage.getItem(key)); } catch { return "dark"; }
}
const system = () => matchMedia("(prefers-color-scheme: dark)");
function apply(mode: Appearance, systemDark = system().matches) {
  document.documentElement.classList.toggle("dark", mode === "dark" || mode === "system" && systemDark);
}

// Run before mounting the first page so persisted preferences apply to every entry.
apply(initial());

export function AppearanceMenu() {
  const [mode, setMode] = useState(initial);
  useEffect(() => {
    const media = system();
    apply(mode, media.matches);
    const change = (event: MediaQueryListEvent) => apply(mode, event.matches);
    if (mode === "system") media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [mode]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setMode(valid(event.newValue));
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, []);
  const Icon = choices[mode].icon;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="sm" aria-label={`外观：${choices[mode].label}`} title="外观">
        <Icon aria-hidden="true" /><span className="hidden sm:inline">外观</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-36">
      <DropdownMenuLabel>外观</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={mode} onValueChange={value => {
        const next = valid(value);
        try { localStorage.setItem(key, next); } catch { /* The current window still uses the chosen theme. */ }
        apply(next);
        setMode(next);
      }}>
        {(Object.keys(choices) as Appearance[]).map(name => {
          const ChoiceIcon = choices[name].icon;
          return <DropdownMenuRadioItem key={name} value={name}><ChoiceIcon aria-hidden="true" />{choices[name].label}</DropdownMenuRadioItem>;
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}
