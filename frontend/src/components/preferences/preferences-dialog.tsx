"use client";

import {
  Accessibility,
  Bell,
  Check,
  Keyboard,
  Monitor,
  Moon,
  Palette,
  PanelLeft,
  RotateCcw,
  Sun,
  Type,
} from "lucide-react";
import { useSyncExternalStore } from "react";

import { useAppearance } from "@/components/appearance-provider";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NAV_ITEMS } from "@/components/views/nav-items";
import { NotificationsSection, PrefSwitch } from "@/components/workspace/notification-prefs";
import {
  ACCENT_SWATCHES,
  computeVars,
  DEFAULT_PREFERENCES,
  FONT_SIZES,
  FONTS,
  type Mode,
  type SwitcherVisibility,
  THEMES,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";

export type PreferencesSection = "appearance" | "text" | "sidebar" | "notifications" | "accessibility" | "shortcuts";
type Section = PreferencesSection;

const SECTIONS: { id: Section; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "appearance", label: "Themes & color", icon: Palette },
  { id: "text", label: "Text & density", icon: Type },
  { id: "sidebar", label: "Sidebar", icon: PanelLeft },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "accessibility", label: "Accessibility", icon: Accessibility },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard },
];

/* The open section lives outside React so other components can deep-link: setPreferencesSection("sidebar"). */
let currentSection: Section = "appearance";
const sectionListeners = new Set<() => void>();

/** Choose the section the preferences dialog shows (call before opening it to deep-link). */
export function setPreferencesSection(section: PreferencesSection) {
  if (section === currentSection) return;
  currentSection = section;
  sectionListeners.forEach((fn) => fn());
}

function subscribeSection(fn: () => void) {
  sectionListeners.add(fn);
  return () => {
    sectionListeners.delete(fn);
  };
}

export function PreferencesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const section = useSyncExternalStore(subscribeSection, () => currentSection, () => "appearance" as Section);
  const setSection = setPreferencesSection;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(720px,calc(100dvh-2rem))] max-w-[calc(100%-2rem)] gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">Preferences</DialogTitle>
        <nav className="hidden w-56 shrink-0 flex-col gap-0.5 border-r bg-muted/40 p-3 sm:flex">
          <div className="px-2 pt-1 pb-3 text-xl font-black">Preferences</div>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm",
                section === s.id ? "bg-side-active font-bold text-side-active-foreground" : "hover:bg-muted",
              )}
            >
              <s.icon className="size-4" /> {s.label}
            </button>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 border-b sm:hidden">
            <div className="px-4 pt-3 pr-12 text-lg font-black">Preferences</div>
            <div className="flex gap-1 overflow-x-auto p-2 pr-4 [scrollbar-width:none]">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm",
                    section === s.id ? "bg-side-active font-bold text-side-active-foreground" : "hover:bg-muted",
                  )}
                >
                  <s.icon className="size-3.5" /> {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            {section === "appearance" && <AppearanceSection />}
            {section === "text" && <TextSection />}
            {section === "sidebar" && <SidebarPrefsSection />}
            {section === "notifications" && <NotificationsSection />}
            {section === "accessibility" && <AccessibilitySection />}
            {section === "shortcuts" && <ShortcutsSection />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Heading({ title, description }: { title: React.ReactNode; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-[15px] font-bold">{title}</h3>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/* ---------------- Themes & colour ---------------- */

/** Small gradient pill marking premium themes. */
function PremiumBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-gradient-to-r from-amber-400 via-fuchsia-500 to-violet-600 px-1.5 py-px text-[10px] leading-4 font-bold tracking-wide text-white uppercase shadow-sm",
        className,
      )}
    >
      Premium
    </span>
  );
}

function ThemeGrid({ themes, premium }: { themes: typeof THEMES; premium?: boolean }) {
  const { prefs, dark, update } = useAppearance();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {themes.map((t) => {
        const vars = computeVars({ ...prefs, theme: t.id, accent: null }, dark);
        const selected = prefs.theme === t.id;
        return (
          <button
            key={t.id}
            onClick={() => update({ theme: t.id })}
            aria-pressed={selected}
            className={cn(
              "group relative overflow-hidden rounded-xl border-2 text-left transition focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              selected ? "border-side-active shadow-md" : "border-transparent hover:shadow-md",
            )}
          >
            <div className="flex h-20 p-1.5" style={{ background: vars["--chrome-gradient"] }}>
              <div className="flex w-2/5 flex-col gap-1 rounded-l-md p-1.5" style={{ background: vars["--side"] }}>
                <span className="h-1.5 w-3/4 rounded-full" style={{ background: vars["--side-strong"], opacity: 0.8 }} />
                <span className="h-2.5 rounded" style={{ background: vars["--side-active"] }} />
                <span className="h-1.5 w-2/3 rounded-full" style={{ background: vars["--side-foreground"], opacity: 0.5 }} />
                <span className="h-1.5 w-1/2 rounded-full" style={{ background: vars["--side-foreground"], opacity: 0.5 }} />
              </div>
              <div className="flex flex-1 flex-col gap-1 rounded-r-md bg-background p-1.5">
                <span className="h-1.5 w-1/2 rounded-full bg-foreground/60" />
                <span className="h-1.5 w-5/6 rounded-full bg-foreground/20" />
                <span className="h-1.5 w-2/3 rounded-full bg-foreground/20" />
              </div>
            </div>
            {premium && <PremiumBadge className="absolute top-2 right-2" />}
            <div className="flex items-center justify-between gap-2 bg-muted/40 px-2.5 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{t.name}</div>
                <div className="line-clamp-2 text-xs text-muted-foreground">{t.description}</div>
              </div>
              {selected && <Check className="size-4 shrink-0 text-side-active" />}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function AppearanceSection() {
  const { prefs, update } = useAppearance();
  const modes: { id: Mode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "Sync with OS", icon: Monitor },
  ];

  return (
    <div className="space-y-8">
      <LivePreview />

      <section>
        <Heading title="Color mode" description="Choose light or dark, or follow your device automatically." />
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          {modes.map((m) => (
            <button
              key={m.id}
              onClick={() => update({ mode: m.id })}
              className={cn(
                "flex min-w-0 flex-col items-center gap-2 rounded-xl border-2 p-2 text-sm font-bold transition sm:p-3",
                prefs.mode === m.id ? "border-side-active" : "border-transparent bg-muted/50 hover:bg-muted",
              )}
            >
              <ModeSwatch mode={m.id} />
              <span className="flex flex-col items-center gap-1 text-center text-xs sm:flex-row sm:gap-1.5 sm:text-sm">
                <m.icon className="size-4 shrink-0" /> {m.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <Heading title="Themes" description="Sets the window frame and sidebar. Every theme has a tuned dark version." />
        <ThemeGrid themes={THEMES.filter((t) => !t.premium)} />
      </section>

      {THEMES.some((t) => t.premium) && (
        <section>
          <Heading
            title={
              <span className="flex items-center gap-2">
                Premium <PremiumBadge />
              </span>
            }
            description="Richer gradients and hand-tuned palettes for the window frame and sidebar."
          />
          <ThemeGrid themes={THEMES.filter((t) => t.premium)} premium />
        </section>
      )}

      <section>
        <Heading title="Accent color" description="Highlights the active conversation and tabs. Use the theme's or pick your own." />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => update({ accent: null })}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-full border-2 px-3 text-sm font-bold",
              prefs.accent === null ? "border-side-active" : "border-border hover:bg-muted",
            )}
          >
            <RotateCcw className="size-3.5" /> Theme default
          </button>
          {ACCENT_SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => update({ accent: c })}
              aria-label={`Accent ${c}`}
              className={cn(
                "flex size-9 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition hover:scale-110",
                prefs.accent === c && "ring-2 ring-foreground",
              )}
              style={{ background: c }}
            >
              {prefs.accent === c && <Check className="size-4 text-white" />}
            </button>
          ))}
          <label
            className="relative flex size-9 cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 border-dashed text-xs font-bold text-muted-foreground hover:bg-muted"
            title="Custom color"
          >
            +
            <input
              type="color"
              value={prefs.accent ?? "#1264a3"}
              onChange={(e) => update({ accent: e.target.value })}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          {prefs.accent && !ACCENT_SWATCHES.includes(prefs.accent) && (
            <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-xs">
              <span className="size-3 rounded-full" style={{ background: prefs.accent }} /> {prefs.accent}
            </span>
          )}
        </div>
      </section>
    </div>
  );
}

function ModeSwatch({ mode }: { mode: Mode }) {
  const light = (
    <div className="flex h-full flex-1 flex-col gap-1 bg-white p-1.5">
      <span className="h-1.5 w-2/3 rounded-full bg-neutral-800/70" />
      <span className="h-1.5 w-full rounded-full bg-neutral-300" />
    </div>
  );
  const dark = (
    <div className="flex h-full flex-1 flex-col gap-1 bg-[#1a1d21] p-1.5">
      <span className="h-1.5 w-2/3 rounded-full bg-neutral-200/80" />
      <span className="h-1.5 w-full rounded-full bg-neutral-600" />
    </div>
  );
  return (
    <div className="flex h-14 w-full overflow-hidden rounded-lg border">
      {mode === "light" ? light : mode === "dark" ? dark : <>{light}{dark}</>}
    </div>
  );
}

/** A miniature of the real app, painted with the live CSS variables. */
function LivePreview() {
  return (
    <div className="overflow-hidden rounded-xl border shadow-sm" aria-hidden>
      <div className="flex h-44 gap-1.5 p-1.5" style={{ background: "var(--chrome-gradient)" }}>
        <div className="hidden w-8 shrink-0 flex-col items-center gap-1.5 pt-1 sm:flex">
          <span className="size-6 rounded-md bg-white/90" />
          <span className="size-5 rounded-md bg-white/20" />
          <span className="size-5 rounded-md bg-white/20" />
        </div>
        <div className="flex flex-1 overflow-hidden rounded-lg">
          <div className="w-24 shrink-0 space-y-1 overflow-hidden bg-side p-2 text-[11px] text-side-foreground sm:w-40">
            <div className="pb-1 text-xs font-black text-side-strong">Acme Inc</div>
            <div className="rounded px-1.5 py-0.5 bg-side-active text-side-active-foreground"># general</div>
            <div className="flex justify-between px-1.5 font-bold text-side-strong">
              # design <span className="rounded-full bg-badge px-1.5 text-[9px] text-badge-foreground">3</span>
            </div>
            <div className="px-1.5"># random</div>
          </div>
          <div className="min-w-0 flex-1 space-y-2 overflow-hidden bg-background p-2 sm:p-3">
            <div className="border-b border-tab pb-1 text-xs font-black text-foreground"># general</div>
            <div className="flex gap-2">
              <span className="size-7 shrink-0 rounded-md bg-emerald-600" />
              <div className="min-w-0 text-msg font-sans text-foreground">
                <span className="font-black">Maya Ortiz</span>{" "}
                <span className="text-[11px] text-muted-foreground">9:41 AM</span>
                <div>
                  Shipping the new themes today <span className="rounded bg-mention px-0.5 font-bold text-mention-foreground">@team</span> 🚀
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Text & density ---------------- */

function TextSection() {
  const { prefs, update } = useAppearance();
  return (
    <div className="space-y-8">
      <LivePreview />
      <section>
        <Heading title="Font" description="Applies to the whole app. Fonts load only when you pick them." />
        <div className="grid gap-2 sm:grid-cols-2">
          {FONTS.map((f) => (
            <button
              key={f.id}
              onClick={() => update({ font: f.id })}
              className={cn(
                "flex items-center gap-3 rounded-xl border-2 p-3 text-left transition",
                prefs.font === f.id ? "border-side-active" : "border-transparent bg-muted/50 hover:bg-muted",
              )}
              style={{ fontFamily: f.cssVar ? `var(${f.cssVar})` : "system-ui, sans-serif" }}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-lg font-bold shadow-xs">
                Aa
              </span>
              <span className="min-w-0">
                <span className="block font-bold">{f.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{f.note}</span>
              </span>
              {prefs.font === f.id && <Check className="ml-auto size-4 shrink-0 text-side-active" />}
            </button>
          ))}
        </div>
      </section>

      <section>
        <Heading title="Text size" description="Message text in channels, threads and the composer." />
        <div className="grid w-full grid-cols-4 rounded-xl bg-muted p-1 sm:inline-flex sm:w-auto">
          {FONT_SIZES.map((s) => (
            <button
              key={s.id}
              onClick={() => update({ font_size: s.id })}
              className={cn(
                "flex h-11 min-w-0 flex-col items-center justify-center rounded-lg px-1 sm:min-w-20 sm:px-3",
                prefs.font_size === s.id ? "bg-background font-bold shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span style={{ fontSize: s.px }} className="leading-none font-bold">
                Aa
              </span>
              <span className="text-[10px]">{s.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <Heading title="Message density" />
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              { id: "comfortable", title: "Comfortable", note: "Avatars and names above each message." },
              { id: "compact", title: "Compact", note: "Time and name inline. More messages on screen." },
            ] as const
          ).map((d) => (
            <button
              key={d.id}
              onClick={() => update({ density: d.id })}
              className={cn(
                "rounded-xl border-2 p-3 text-left transition",
                prefs.density === d.id ? "border-side-active" : "border-transparent bg-muted/50 hover:bg-muted",
              )}
            >
              <div className="mb-3 space-y-1.5 rounded-lg bg-background p-2.5">
                {d.id === "comfortable" ? (
                  [0, 1].map((i) => (
                    <div key={i} className="flex gap-2">
                      <span className={cn("size-6 rounded-md", i ? "bg-sky-600" : "bg-emerald-600")} />
                      <div className="flex-1 space-y-1">
                        <span className="block h-1.5 w-1/3 rounded-full bg-foreground/60" />
                        <span className="block h-1.5 w-5/6 rounded-full bg-foreground/20" />
                      </div>
                    </div>
                  ))
                ) : (
                  [0, 1, 2, 3].map((i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-5 rounded-full bg-foreground/20" />
                      <span className="h-1.5 w-8 rounded-full bg-foreground/60" />
                      <span className="h-1.5 flex-1 rounded-full bg-foreground/20" />
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold">{d.title}</div>
                  <div className="text-xs text-muted-foreground">{d.note}</div>
                </div>
                {prefs.density === d.id && <Check className="size-4 shrink-0 text-side-active" />}
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ---------------- Sidebar ---------------- */

const SWITCHER_OPTIONS: { id: SwitcherVisibility; title: string; note: string }[] = [
  { id: "auto", title: "Automatic", note: "Shown when you're in more than one workspace." },
  { id: "always", title: "Always show", note: "Keep workspace icons in the rail." },
  { id: "never", title: "Never show", note: "Switch from the workspace menu instead." },
];

function SidebarPrefsSection() {
  const { prefs, update } = useAppearance();
  const hidden = new Set(prefs.sidebar_hidden_items ?? []);
  const toggleItem = (id: string) => {
    const next = new Set(hidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update({ sidebar_hidden_items: [...next].slice(0, 20) });
  };
  return (
    <div className="space-y-8">
      <section>
        <Heading title="Workspace switcher" description="The column of workspace icons beside your sidebar. Toggle it any time with ⌘⇧S." />
        <div role="radiogroup" aria-label="Workspace switcher" className="grid gap-2 sm:grid-cols-3">
          {SWITCHER_OPTIONS.map((o) => {
            const selected = (prefs.show_workspace_switcher ?? "auto") === o.id;
            return (
              <button
                key={o.id}
                role="radio"
                aria-checked={selected}
                onClick={() => update({ show_workspace_switcher: o.id })}
                className={cn(
                  "rounded-xl border-2 p-3 text-left transition",
                  selected ? "border-side-active" : "border-transparent bg-muted/50 hover:bg-muted",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-bold">{o.title}</span>
                  {selected && <Check className="size-4 shrink-0 text-side-active" />}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{o.note}</div>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <Heading title="Layout" />
        <div className="divide-y rounded-xl border">
          <label className="flex cursor-pointer items-center gap-4 p-4">
            <span className="flex-1">
              <span className="block text-sm font-bold">Compact sidebar</span>
              <span className="block text-sm text-muted-foreground">Tighter rows, so more conversations fit on screen.</span>
            </span>
            <PrefSwitch checked={!!prefs.sidebar_compact} onChange={(v) => update({ sidebar_compact: v })} label="Compact sidebar" />
          </label>
        </div>
      </section>

      <section>
        <Heading title="Show in sidebar" description="Unchecked views move under “More”. You can also right-click a view to hide it." />
        <div className="grid gap-2 sm:grid-cols-2">
          {NAV_ITEMS.map((item) => {
            const visible = !hidden.has(item.id);
            return (
              <button
                key={item.id}
                role="checkbox"
                aria-checked={visible}
                onClick={() => toggleItem(item.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 text-left transition hover:bg-muted/60",
                  !visible && "opacity-70",
                )}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <item.icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">{item.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                </span>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded border-2",
                    visible ? "border-side-active bg-side-active text-side-active-foreground" : "border-muted-foreground/40",
                  )}
                >
                  {visible && <Check className="size-3.5" />}
                </span>
              </button>
            );
          })}
        </div>
        {hidden.size > 0 && (
          <button
            onClick={() => update({ sidebar_hidden_items: [] })}
            className="mt-3 flex items-center gap-1.5 text-sm font-bold text-link hover:underline"
          >
            <RotateCcw className="size-3.5" /> Show all views
          </button>
        )}
      </section>
    </div>
  );
}

/* ---------------- Accessibility ---------------- */

function AccessibilitySection() {
  const { prefs, update } = useAppearance();
  const rows = [
    {
      key: "reduce_motion" as const,
      title: "Reduce motion",
      note: "Turns off animations like typing dots, popovers and theme transitions.",
    },
    { key: "underline_links" as const, title: "Underline links", note: "Makes links in messages easier to spot." },
  ];
  return (
    <div className="space-y-8">
      <section>
        <Heading title="Accessibility" description="Tip: Atkinson Hyperlegible and a larger text size (Text & density) help low-vision reading." />
        <div className="divide-y rounded-xl border">
          {rows.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-center gap-4 p-4">
              <span className="flex-1">
                <span className="block text-sm font-bold">{r.title}</span>
                <span className="block text-sm text-muted-foreground">{r.note}</span>
              </span>
              <Switch checked={prefs[r.key]} onChange={(v) => update({ [r.key]: v })} label={r.title} />
            </label>
          ))}
        </div>
      </section>
      <section>
        <Heading title="Reset" />
        <button
          onClick={() => update({ ...DEFAULT_PREFERENCES })}
          className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold hover:bg-muted"
        >
          <RotateCcw className="size-4" /> Restore default appearance
        </button>
      </section>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-6 w-11 shrink-0 rounded-full transition", checked ? "bg-send" : "bg-muted-foreground/30")}
    >
      <span className={cn("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/* ---------------- Shortcuts ---------------- */

const SHORTCUTS: [string, string[]][] = [
  ["Search or jump to a conversation", ["⌘", "K"]],
  ["Open preferences", ["⌘", ","]],
  ["Focus mode (hide sidebar)", ["⌘", "."]],
  ["Show / hide workspace switcher", ["⌘", "Shift", "S"]],
  ["Switch to workspace 1–9", ["⌘", "1…9"]],
  ["Previous / next conversation", ["⌥", "↑ / ↓"]],
  ["Previous / next unread conversation", ["⌥", "Shift", "↑ / ↓"]],
  ["Mark the open conversation as read", ["Esc"]],
  ["Bold / italic selected text", ["⌘", "B / I"]],
  ["Send message", ["Return"]],
  ["New line in message", ["Shift", "Return"]],
  ["Pick a mention", ["↑ ↓", "Return"]],
  ["Close panel or dialog", ["Esc"]],
];

function ShortcutsSection() {
  return (
    <section>
      <Heading title="Keyboard shortcuts" description="On Windows and Linux use Ctrl instead of ⌘ and Alt instead of ⌥." />
      <div className="divide-y rounded-xl border">
        {SHORTCUTS.map(([label, keys]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <span className="min-w-0">{label}</span>
            <span className="flex shrink-0 gap-1">
              {keys.map((k) => (
                <kbd key={k} className="min-w-7 rounded-md border border-b-2 bg-muted px-1.5 py-0.5 text-center font-mono text-xs">
                  {k}
                </kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
