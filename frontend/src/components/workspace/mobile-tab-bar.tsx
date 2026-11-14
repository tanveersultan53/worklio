"use client";

import { AtSign, Home, MessagesSquare, UserRound } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { UserAvatar } from "@/components/chat/user-avatar";
import { useNavBadges } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

import { useWorkspace } from "./provider";
import type { SidebarView } from "./rail";

/**
 * Phones: Slack-style bottom tabs (Home · DMs · Activity · You). Hidden inside a conversation,
 * where the header's back button returns to the list.
 */
export function MobileTabBar({ view, onView }: { view: SidebarView; onView: (v: SidebarView) => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const badges = useNavBadges();
  const home = `/w/${ws.workspaceId}`;
  const onHomeList = pathname === home;
  const onActivity = pathname.endsWith("/activity");
  const dmUnread = ws.channels.filter((c) => c.kind === "dm").reduce((n, c) => n + c.unread_count, 0);

  const tabs = [
    {
      key: "home",
      label: "Home",
      icon: Home,
      active: onHomeList && view === "home",
      onClick: () => {
        onView("home");
        if (!onHomeList) router.push(home);
      },
    },
    {
      key: "dms",
      label: "DMs",
      icon: MessagesSquare,
      badge: dmUnread,
      active: onHomeList && view === "dms",
      onClick: () => {
        onView("dms");
        if (!onHomeList) router.push(home);
      },
    },
    {
      key: "activity",
      label: "Activity",
      icon: AtSign,
      badge: badges.activity,
      active: onActivity,
      onClick: () => router.push(`${home}/activity`),
    },
    {
      key: "you",
      label: "You",
      icon: UserRound,
      active: false,
      onClick: () => ws.setProfileOpen(true),
    },
  ];

  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 items-stretch justify-around border-t border-white/10 bg-chrome px-1 pt-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] text-chrome-foreground md:hidden"
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={t.onClick}
          aria-current={t.active ? "page" : undefined}
          className="relative flex min-w-16 flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <span
            className={cn(
              "relative flex h-8 w-12 items-center justify-center rounded-full transition-colors",
              t.active ? "bg-side-active text-side-active-foreground" : "text-chrome-muted",
            )}
          >
            {t.key === "you" && ws.me ? (
              <UserAvatar id={ws.me.id} name={ws.me.full_name} size="sm" />
            ) : (
              <t.icon className="size-[22px]" aria-hidden />
            )}
            {!!t.badge && (
              <span className="absolute -top-0.5 right-1 min-w-4 rounded-full bg-badge px-1 text-center text-[10px] leading-4 font-bold text-badge-foreground ring-2 ring-chrome">
                {t.badge > 99 ? "99+" : t.badge}
              </span>
            )}
          </span>
          <span className={t.active ? "text-chrome-foreground" : "text-chrome-muted"}>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
