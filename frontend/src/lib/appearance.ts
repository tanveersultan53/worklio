/**
 * Appearance system: theme presets, fonts, text size, density and accessibility options.
 *
 * Preferences are turned into CSS custom properties on <html> (see `computeVars`), cached in
 * localStorage so the inline head script can paint the right theme before React loads, and
 * synced to the user's account (PATCH /auth/me/preferences) so they follow you across devices.
 */

export type Mode = "light" | "dark" | "system";
export type FontSize = "sm" | "md" | "lg" | "xl";
export type Density = "comfortable" | "compact";
export type SwitcherVisibility = "auto" | "always" | "never";
export type NotifyLevel = "all" | "mentions" | "nothing";
/** Sidebar nav items a user can hide (ids match NAV_ITEMS in components/views/nav-items). */
export const SIDEBAR_NAV_IDS = ["threads", "activity", "later", "drafts", "huddles", "calendar", "files", "canvases", "directory", "unreads"] as const;

/** Notifications are only delivered inside this weekly window (in `tz`). */
export type NotifySchedule = {
  enabled: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** "HH:MM", 24-hour. */
  start: string;
  end: string;
  /** IANA time zone, e.g. "Europe/Berlin". */
  tz: string;
};

export type Preferences = {
  theme: string;
  mode: Mode;
  accent: string | null; // custom accent overrides the theme's
  font: string;
  font_size: FontSize;
  density: Density;
  reduce_motion: boolean;
  underline_links: boolean;
  sidebar_width: number;
  /** Workspace switcher in the rail: auto hides it while you belong to a single workspace. */
  show_workspace_switcher: SwitcherVisibility;
  /** Tighter sidebar rows. */
  sidebar_compact: boolean;
  /** Nav items moved under "More" (≤ 20 ids from SIDEBAR_NAV_IDS). */
  sidebar_hidden_items: string[];
  notify_schedule: NotifySchedule | null;
  notify_sound: boolean;
  /** Desktop notifications: everything, DMs + mentions, or nothing. */
  desktop_notify: NotifyLevel;
};

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "classic", // product default: dark plum sidebar
  mode: "system",
  accent: null,
  font: "inter",
  font_size: "md",
  density: "comfortable",
  reduce_motion: false,
  underline_links: false,
  sidebar_width: 260,
  show_workspace_switcher: "auto",
  sidebar_compact: false,
  sidebar_hidden_items: [],
  notify_schedule: null,
  notify_sound: true,
  desktop_notify: "mentions",
};

type Palette = {
  frame: string; // window frame gradient
  chrome: string; // solid fallback of the frame
  side: string;
  sideForeground: string;
  sideStrong: string;
  sideHover: string;
  active: string;
  activeForeground: string;
  badge: string;
  tab: string;
};

export type ThemePreset = { id: string; name: string; description: string; premium?: boolean; light: Palette; dark: Palette };

const lightSide = (side: string, fg: string, strong: string, hoverRgb: string): Pick<Palette, "side" | "sideForeground" | "sideStrong" | "sideHover"> => ({
  side,
  sideForeground: fg,
  sideStrong: strong,
  sideHover: `rgb(${hoverRgb} / 0.08)`,
});

const darkSide = (side: string): Pick<Palette, "side" | "sideForeground" | "sideStrong" | "sideHover" | "activeForeground"> => ({
  side,
  sideForeground: "#b9babd",
  sideStrong: "#ffffff",
  sideHover: "rgb(255 255 255 / 0.06)",
  activeForeground: "#ffffff",
});

const gradient = (a: string, b: string, c: string) => `linear-gradient(135deg, ${a} 0%, ${b} 45%, ${c} 100%)`;

export const THEMES: ThemePreset[] = [
  {
    id: "aubergine",
    name: "Aubergine",
    description: "Warm plum to navy",
    light: {
      frame: gradient("#6b3a86", "#483a72", "#2a3d5f"),
      chrome: "#4a2c63",
      ...lightSide("#eeecf2", "#58365c", "#340a38", "52 10 56"),
      active: "#245178",
      activeForeground: "#e7f7fe",
      badge: "#7a3c86",
      tab: "#7a3c86",
    },
    dark: { frame: gradient("#241a2e", "#1d1a27", "#161a22"), chrome: "#19171d", ...darkSide("#211f26"), active: "#1164a3", badge: "#cd2553", tab: "#c592d4" },
  },
  {
    id: "ocean",
    name: "Ocean",
    description: "Deep teal and blue",
    light: {
      frame: gradient("#0e6d8c", "#145c9e", "#1b3b6f"),
      chrome: "#145c9e",
      ...lightSide("#e9f2f8", "#24506b", "#0b2a40", "11 42 64"),
      active: "#1264a3",
      activeForeground: "#ffffff",
      badge: "#e8572d",
      tab: "#1264a3",
    },
    dark: { frame: gradient("#0b2433", "#0d1d2e", "#0b1522"), chrome: "#0d1d2e", ...darkSide("#14212c"), active: "#1d7ac2", badge: "#e8572d", tab: "#5cb8e6" },
  },
  {
    id: "forest",
    name: "Forest",
    description: "Calm evergreen",
    light: {
      frame: gradient("#2d6a4f", "#1f5a43", "#163d32"),
      chrome: "#1f5a43",
      ...lightSide("#edf3ee", "#2f4d3a", "#10291a", "16 41 26"),
      active: "#2d6a4f",
      activeForeground: "#ffffff",
      badge: "#d64545",
      tab: "#2d6a4f",
    },
    dark: { frame: gradient("#12251b", "#0f1f18", "#0b1712"), chrome: "#0f1f18", ...darkSide("#16221c"), active: "#2f855a", badge: "#e05252", tab: "#7fd1a4" },
  },
  {
    id: "sunset",
    name: "Sunset",
    description: "Ember orange to wine",
    light: {
      frame: gradient("#c2552c", "#a8382f", "#6e2448"),
      chrome: "#a8382f",
      ...lightSide("#faf0ea", "#6b3a2e", "#3d1a12", "61 26 18"),
      active: "#c2410c",
      activeForeground: "#ffffff",
      badge: "#be123c",
      tab: "#c2410c",
    },
    dark: { frame: gradient("#2b1712", "#241314", "#1c1118"), chrome: "#241314", ...darkSide("#241a19"), active: "#c2410c", badge: "#e11d48", tab: "#fb923c" },
  },
  {
    id: "rose",
    name: "Rose",
    description: "Magenta and violet",
    light: {
      frame: gradient("#be185d", "#9d174d", "#5b21b6"),
      chrome: "#9d174d",
      ...lightSide("#fcf0f5", "#7a2948", "#4a0d27", "74 13 39"),
      active: "#be185d",
      activeForeground: "#ffffff",
      badge: "#7c3aed",
      tab: "#be185d",
    },
    dark: { frame: gradient("#2a1220", "#22101c", "#1a1024"), chrome: "#22101c", ...darkSide("#24161f"), active: "#db2777", badge: "#8b5cf6", tab: "#f472b6" },
  },
  {
    id: "graphite",
    name: "Graphite",
    description: "Neutral and focused",
    light: {
      frame: gradient("#3b3e44", "#2e3136", "#202226"),
      chrome: "#2e3136",
      ...lightSide("#f1f1f2", "#45474b", "#18191b", "24 25 27"),
      active: "#3f4651",
      activeForeground: "#ffffff",
      badge: "#e11d48",
      tab: "#3f4651",
    },
    dark: { frame: gradient("#1c1d20", "#18191b", "#141517"), chrome: "#18191b", ...darkSide("#1e1f22"), active: "#4b5563", badge: "#e11d48", tab: "#d1d5db" },
  },
  {
    id: "midnight",
    name: "Midnight",
    description: "Dark sidebar, indigo glow",
    light: {
      frame: gradient("#1e1b4b", "#172554", "#0f172a"),
      chrome: "#172554",
      side: "#111827",
      sideForeground: "#cbd5e1",
      sideStrong: "#ffffff",
      sideHover: "rgb(255 255 255 / 0.07)",
      active: "#4f46e5",
      activeForeground: "#ffffff",
      badge: "#f43f5e",
      tab: "#6366f1",
    },
    dark: { frame: gradient("#14123a", "#0f1730", "#0b1120"), chrome: "#0f1730", ...darkSide("#0f1522"), active: "#4f46e5", badge: "#f43f5e", tab: "#a5b4fc" },
  },
  {
    id: "classic",
    name: "Classic",
    description: "Dark plum sidebar",
    light: {
      frame: gradient("#3a1238", "#3a1238", "#3a1238"),
      chrome: "#3a1238",
      side: "#44193f",
      sideForeground: "rgb(255 255 255 / 0.75)",
      sideStrong: "#ffffff",
      sideHover: "rgb(255 255 255 / 0.08)",
      // Like Slack today: the selected item is a soft light pill with plum text, not blue.
      active: "#f6e9f5",
      activeForeground: "#3a1238",
      badge: "#cd2553",
      tab: "#44193f",
    },
    dark: {
      frame: gradient("#1d0f1c", "#1d0f1c", "#1d0f1c"),
      chrome: "#1d0f1c",
      ...darkSide("#261424"),
      active: "#e6d7e5",
      activeForeground: "#2a0f28",
      badge: "#cd2553",
      tab: "#d8a6d4",
    },
  },

  /* ---------- Premium collection ---------- */
  {
    id: "obsidian-gold",
    name: "Obsidian Gold",
    description: "Black lacquer, gold leaf",
    premium: true,
    light: {
      frame: gradient("#2a2418", "#1a1712", "#0d0c0a"),
      chrome: "#1a1712",
      ...lightSide("#f7f3ea", "#5a4a2a", "#2a2010", "42 32 16"),
      active: "#8a6408",
      activeForeground: "#ffffff",
      badge: "#b8860b",
      tab: "#a8790a",
    },
    dark: { frame: gradient("#1c1810", "#120f0a", "#0a0908"), chrome: "#120f0a", ...darkSide("#17150f"), active: "#8a6408", badge: "#d4a72c", tab: "#e0c068" },
  },
  {
    id: "aurora",
    name: "Aurora",
    description: "Northern lights shimmer",
    premium: true,
    light: {
      frame: gradient("#0f766e", "#4338ca", "#9d174d"),
      chrome: "#4338ca",
      ...lightSide("#eef3f7", "#2c4a5a", "#0c2733", "12 39 51"),
      active: "#4338ca",
      activeForeground: "#ffffff",
      badge: "#db2777",
      tab: "#0f766e",
    },
    dark: { frame: gradient("#0b2a2a", "#1a1840", "#2a0f20"), chrome: "#1a1840", ...darkSide("#14182a"), active: "#5b5bd6", badge: "#ec4899", tab: "#5eead4" },
  },
  {
    id: "royal",
    name: "Royal Sapphire",
    description: "Deep sapphire, amber accents",
    premium: true,
    light: {
      frame: gradient("#1e3a8a", "#312e81", "#1e1b4b"),
      chrome: "#312e81",
      ...lightSide("#eef1fb", "#2b3a6b", "#111c44", "17 28 68"),
      active: "#1e40af",
      activeForeground: "#ffffff",
      badge: "#d97706",
      tab: "#1e40af",
    },
    dark: { frame: gradient("#111a3a", "#14123a", "#0d0b26"), chrome: "#14123a", ...darkSide("#131830"), active: "#3b5bdb", badge: "#f59e0b", tab: "#93c5fd" },
  },
  {
    id: "emerald-luxe",
    name: "Emerald Luxe",
    description: "Jewel green and bronze",
    premium: true,
    light: {
      frame: gradient("#065f46", "#064e3b", "#022c22"),
      chrome: "#064e3b",
      ...lightSide("#ecf6f1", "#1f4d3c", "#062a1f", "6 42 31"),
      active: "#047857",
      activeForeground: "#ffffff",
      badge: "#b45309",
      tab: "#047857",
    },
    dark: { frame: gradient("#0a2a20", "#082219", "#051a13"), chrome: "#082219", ...darkSide("#10201a"), active: "#047857", badge: "#d97706", tab: "#6ee7b7" },
  },
  {
    id: "sakura",
    name: "Sakura",
    description: "Cherry blossom and lilac",
    premium: true,
    light: {
      frame: gradient("#ec4899", "#db2777", "#a855f7"),
      chrome: "#db2777",
      ...lightSide("#fff5f9", "#8a3a62", "#5a1238", "90 18 56"),
      active: "#db2777",
      activeForeground: "#ffffff",
      badge: "#7c3aed",
      tab: "#db2777",
    },
    dark: { frame: gradient("#3a1a2c", "#2e1426", "#24142e"), chrome: "#2e1426", ...darkSide("#26161f"), active: "#db2777", badge: "#a78bfa", tab: "#f9a8d4" },
  },
  {
    id: "nordic",
    name: "Nordic Frost",
    description: "Arctic blue, snow white",
    premium: true,
    light: {
      frame: gradient("#5e81ac", "#4c6a91", "#3b4f6b"),
      chrome: "#4c6a91",
      ...lightSide("#eceff4", "#3b4252", "#2e3440", "46 52 64"),
      active: "#4c6a91",
      activeForeground: "#ffffff",
      badge: "#bf616a",
      tab: "#5e81ac",
    },
    dark: { frame: gradient("#2e3440", "#2b303b", "#242933"), chrome: "#2b303b", ...darkSide("#2e3440"), active: "#4c6a91", badge: "#bf616a", tab: "#88c0d0" },
  },
  {
    id: "mocha",
    name: "Mocha",
    description: "Espresso and caramel",
    premium: true,
    light: {
      frame: gradient("#6f4e37", "#5a3e2b", "#3e2a1e"),
      chrome: "#5a3e2b",
      ...lightSide("#f6f0ea", "#5c4433", "#2e1f14", "46 31 20"),
      active: "#8b5e3c",
      activeForeground: "#ffffff",
      badge: "#c2410c",
      tab: "#8b5e3c",
    },
    dark: { frame: gradient("#2a1f18", "#231a14", "#1a130e"), chrome: "#231a14", ...darkSide("#221a15"), active: "#9a6a45", badge: "#ea580c", tab: "#d6a77a" },
  },
  {
    id: "neon",
    name: "Neon Night",
    description: "Synthwave magenta and cyan",
    premium: true,
    light: {
      frame: gradient("#0f0c29", "#302b63", "#24243e"),
      chrome: "#302b63",
      side: "#12122a",
      sideForeground: "#c4c8f0",
      sideStrong: "#ffffff",
      sideHover: "rgb(255 255 255 / 0.07)",
      active: "#c026d3",
      activeForeground: "#ffffff",
      badge: "#0891b2",
      tab: "#c026d3",
    },
    dark: { frame: gradient("#0a0820", "#1a1640", "#141428"), chrome: "#1a1640", ...darkSide("#0e0e22"), active: "#c026d3", badge: "#0891b2", tab: "#f0abfc" },
  },
  {
    id: "sandstone",
    name: "Sandstone",
    description: "Desert dune and terracotta",
    premium: true,
    light: {
      frame: gradient("#a8875a", "#8c6d43", "#5e4a2e"),
      chrome: "#8c6d43",
      ...lightSide("#faf6ef", "#6b5536", "#3a2c17", "58 44 23"),
      active: "#9a6b2f",
      activeForeground: "#ffffff",
      badge: "#b91c1c",
      tab: "#9a6b2f",
    },
    dark: { frame: gradient("#2a2318", "#221c13", "#1a150e"), chrome: "#221c13", ...darkSide("#221d15"), active: "#8f6230", badge: "#dc2626", tab: "#e5c79a" },
  },
  {
    id: "lavender",
    name: "Lavender Haze",
    description: "Soft violet dream",
    premium: true,
    light: {
      frame: gradient("#8b5cf6", "#7c3aed", "#5b21b6"),
      chrome: "#7c3aed",
      ...lightSide("#f6f3ff", "#5b4a8a", "#2e1f5e", "46 31 94"),
      active: "#7c3aed",
      activeForeground: "#ffffff",
      badge: "#e11d48",
      tab: "#7c3aed",
    },
    dark: { frame: gradient("#221a3a", "#1c1533", "#150f28"), chrome: "#1c1533", ...darkSide("#1c1830"), active: "#7c3aed", badge: "#f43f5e", tab: "#c4b5fd" },
  },
];

export const ACCENT_SWATCHES = ["#1264a3", "#2d6a4f", "#7a3c86", "#c2410c", "#be185d", "#6366f1", "#0e7490", "#ca8a04"];

/** Font ids map to next/font CSS variables declared in app/layout.tsx. */
export const FONTS = [
  { id: "inter", name: "Inter", cssVar: "--font-inter", note: "Crisp UI sans (default)" },
  { id: "lato", name: "Lato", cssVar: "--font-lato", note: "Friendly and rounded" },
  { id: "plex", name: "IBM Plex Sans", cssVar: "--font-plex", note: "Technical, slightly condensed" },
  { id: "nunito", name: "Nunito Sans", cssVar: "--font-nunito", note: "Soft and open" },
  { id: "atkinson", name: "Atkinson Hyperlegible", cssVar: "--font-atkinson", note: "Designed for low vision readers" },
  { id: "system", name: "System", cssVar: null, note: "Your device's own font" },
] as const;

export const FONT_SIZES: { id: FontSize; label: string; px: number }[] = [
  { id: "sm", label: "Small", px: 13 },
  { id: "md", label: "Default", px: 15 },
  { id: "lg", label: "Large", px: 17 },
  { id: "xl", label: "Extra large", px: 19 },
];

/** Readable text colour (black/white) on a given hex background. */
export function contrastText(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#1d1c1d" : "#ffffff";
}

export function themeById(id: string): ThemePreset {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function computeVars(p: Preferences, dark: boolean): Record<string, string> {
  const palette = themeById(p.theme)[dark ? "dark" : "light"];
  const accent = p.accent;
  const font = FONTS.find((f) => f.id === p.font) ?? FONTS[0];
  const size = FONT_SIZES.find((s) => s.id === p.font_size)?.px ?? 15;
  return {
    "--chrome": palette.chrome,
    "--chrome-gradient": palette.frame,
    "--side": palette.side,
    "--side-foreground": palette.sideForeground,
    "--side-strong": palette.sideStrong,
    "--side-hover": palette.sideHover,
    "--side-active": accent ?? palette.active,
    "--side-active-foreground": accent ? contrastText(accent) : palette.activeForeground,
    "--badge": palette.badge,
    "--tab": accent ?? palette.tab,
    "--app-font": font.cssVar ? `var(${font.cssVar})` : "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    "--msg-size": `${size}px`,
    "--msg-leading": `${Math.round(size * 1.47)}px`,
    "--sidebar-width": `${p.sidebar_width}px`,
  };
}

export const STORAGE_KEY = "worklio.appearance";
const VARS_KEY = (dark: boolean) => `worklio.appearance.vars.${dark ? "dark" : "light"}`;

export function loadPreferences(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const legacy = localStorage.getItem("worklio.theme"); // from the first dark-mode toggle
    return { ...DEFAULT_PREFERENCES, ...(legacy && !raw.mode ? { mode: legacy } : {}), ...raw };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(p: Preferences): boolean {
  return p.mode === "dark" || (p.mode === "system" && systemPrefersDark());
}

/** Apply to <html> and cache for the pre-paint script. */
export function applyPreferences(p: Preferences): void {
  const root = document.documentElement;
  const dark = resolveDark(p);
  root.classList.toggle("dark", dark);
  for (const [k, v] of Object.entries(computeVars(p, dark))) root.style.setProperty(k, v);
  root.dataset.density = p.density;
  root.toggleAttribute("data-reduce-motion", p.reduce_motion);
  root.toggleAttribute("data-underline-links", p.underline_links);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    localStorage.setItem(VARS_KEY(false), JSON.stringify(computeVars(p, false)));
    localStorage.setItem(VARS_KEY(true), JSON.stringify(computeVars(p, true)));
  } catch {}
}

/** Inlined in <head>: paints cached appearance before first render (no theme flash). */
export const appearanceScript = `try{var r=document.documentElement,p=JSON.parse(localStorage.getItem("${STORAGE_KEY}")||"{}"),m=p.mode||localStorage.getItem("worklio.theme")||"system",d=m==="dark"||(m==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);if(d)r.classList.add("dark");var v=JSON.parse(localStorage.getItem("worklio.appearance.vars."+(d?"dark":"light"))||"{}");for(var k in v)r.style.setProperty(k,v[k]);r.dataset.density=p.density||"comfortable";if(p.reduce_motion)r.setAttribute("data-reduce-motion","");if(p.underline_links)r.setAttribute("data-underline-links","")}catch(e){}`;
