"use client";

import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bug,
  CircleHelp,
  Clock,
  Hash,
  Keyboard,
  Lock,
  Menu,
  PanelLeft,
  Search,
  Settings2,
  Sparkles,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { AskWorklioButton } from "@/components/ai/ask-worklio";
import { UserAvatar } from "@/components/chat/user-avatar";
import { setPreferencesSection } from "@/components/preferences/preferences-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { recordRecent, recordVisit, travel, useNavHistory, useRecentConversations } from "@/lib/nav-history";
import { cn } from "@/lib/utils";

import { useWorkspace } from "./provider";
import { setSidebarHidden, useSidebarHidden } from "./sidebar";

const REPO = "https://github.com/tanveersultan53/worklio";
const chromeBtn =
  "flex size-8 shrink-0 items-center justify-center rounded-md text-chrome-foreground outline-none hover:bg-chrome-hover focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-40 disabled:hover:bg-transparent data-popup-open:bg-chrome-hover";

export function TopBar() {
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const hidden = useSidebarHidden();
  const { canBack, canForward } = useNavHistory();

  // Feed ← → and 🕘 with every page change.
  useEffect(() => {
    recordVisit(pathname);
    const m = /^\/w\/[^/]+\/c\/([^/?#]+)/.exec(pathname);
    if (m && ws.workspaceId) recordRecent(ws.workspaceId, m[1]);
  }, [pathname, ws.workspaceId]);

  const go = (step: -1 | 1) => {
    const to = travel(step);
    if (to) router.push(to);
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-1.5 px-2 text-chrome-foreground md:h-11 md:gap-1">
      <button
        onClick={() => ws.setSidebarOpen(true)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-chrome-hover md:hidden"
        aria-label="Open navigation"
      >
        <Menu className="size-5" />
      </button>

      {/* Desktop, like Slack: sidebar toggle over the rail, then back / forward / history before search. */}
      <div className="hidden w-[62px] shrink-0 justify-center md:flex">
        <button
          type="button"
          onClick={() =>
            setSidebarHidden((h) => {
              ws.setFocusMode(!h);
              return !h;
            })
          }
          aria-label={hidden ? "Show sidebar" : "Hide sidebar"}
          aria-keyshortcuts="Meta+."
          className={chromeBtn}
        >
          <PanelLeft className="size-4" aria-hidden />
        </button>
      </div>
      <div className="hidden items-center gap-0.5 md:flex">
        <button type="button" onClick={() => go(-1)} disabled={!canBack} aria-label="Back" className={chromeBtn}>
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <button type="button" onClick={() => go(1)} disabled={!canForward} aria-label="Forward" className={chromeBtn}>
          <ArrowRight className="size-4" aria-hidden />
        </button>
        <RecentMenu />
      </div>

      <div className="flex min-w-0 flex-1 justify-center md:px-2">
        <button
          onClick={() => ws.setSwitcherOpen(true)}
          className="flex h-9 w-full max-w-2xl items-center gap-2 rounded-md bg-chrome-hover px-3 text-sm text-chrome-muted ring-1 ring-white/10 hover:bg-white/15 md:h-7"
        >
          <Search className="size-3.5" />
          <span className="truncate">Search {ws.workspace?.name ?? ""}</span>
          <kbd className="ml-auto hidden rounded border border-white/20 px-1 text-[10px] sm:inline">⌘K</kbd>
        </button>
      </div>
      <AskWorklioButton />
      <ThemeToggle className="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-chrome-hover md:size-8" />
      <HelpMenu />
      <button
        onClick={() => ws.setPreferencesOpen(true)}
        className="flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-chrome-hover md:size-8"
        aria-label="Preferences"
        aria-keyshortcuts="Meta+,"
      >
        <Settings2 className="size-4" />
      </button>
    </header>
  );
}

/** 🕘 Recently viewed conversations in this workspace. */
function RecentMenu() {
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const ids = useRecentConversations(ws.workspaceId);
  const current = /^\/w\/[^/]+\/c\/([^/?#]+)/.exec(pathname)?.[1];
  const items = ids
    .filter((id) => id !== current)
    .map((id) => ws.channels.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .slice(0, 12);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="History: recently viewed" className={chromeBtn}>
        <Clock className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
        <DropdownMenuLabel>Recently viewed</DropdownMenuLabel>
        {items.length === 0 && (
          <p className="px-2 py-3 text-sm text-muted-foreground">Conversations you open show up here.</p>
        )}
        {items.map((c) => {
          const label = ws.channelLabel(c);
          const peer = c.kind === "dm" ? c.member_ids?.find((id) => id !== ws.me?.id) : undefined;
          return (
            <DropdownMenuItem key={c.id} onClick={() => router.push(`/w/${ws.workspaceId}/c/${c.id}`)}>
              {c.kind === "dm" ? (
                <UserAvatar id={peer ?? c.id} name={label} size="sm" />
              ) : c.kind === "private" ? (
                <Lock className="size-4" aria-hidden />
              ) : (
                <Hash className="size-4" aria-hidden />
              )}
              <span className="min-w-0 truncate">{label}</span>
            </DropdownMenuItem>
          );
        })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** ? Help: shortcuts, docs, what's new, report a problem. */
function HelpMenu() {
  const ws = useWorkspace();
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Help" className={cn(chromeBtn, "size-9 md:size-8")}>
        <CircleHelp className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem
          onClick={() => {
            setPreferencesSection("shortcuts");
            ws.setPreferencesOpen(true);
          }}
        >
          <Keyboard className="size-4" aria-hidden />
          Keyboard shortcuts
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => open(`${REPO}/tree/main/docs`)}>
          <BookOpen className="size-4" aria-hidden />
          Documentation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => open(`${REPO}/blob/main/CHANGELOG.md`)}>
          <Sparkles className="size-4" aria-hidden />
          What&apos;s new
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => open(`${REPO}/issues/new/choose`)}>
          <Bug className="size-4" aria-hidden />
          Report a problem
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
