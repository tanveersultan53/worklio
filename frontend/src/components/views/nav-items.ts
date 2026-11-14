import {
  AtSign,
  Bookmark,
  BookUser,
  CalendarDays,
  Files,
  FileText,
  Headphones,
  Inbox,
  MessagesSquare,
  SendHorizontal,
  type LucideIcon,
} from "lucide-react";

/** Ids accepted by Preferences.sidebar_hidden_items (plus "activity"). */
export type NavItemId =
  | "threads"
  | "activity"
  | "later"
  | "drafts"
  | "huddles"
  | "calendar"
  | "files"
  | "canvases"
  | "directory"
  | "unreads";

export type NavItem = {
  id: NavItemId;
  label: string;
  /** Short helper text for tooltips / the "customise sidebar" list. */
  description: string;
  icon: LucideIcon;
  href: (workspaceId: string) => string;
};

/** The workspace-level views shown at the top of the sidebar, in display order. */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    id: "unreads",
    label: "Unreads",
    description: "Every unread message, grouped by conversation",
    icon: Inbox,
    href: (ws) => `/w/${ws}/unreads`,
  },
  {
    id: "threads",
    label: "Threads",
    description: "Conversations you follow, with inline replies",
    icon: MessagesSquare,
    href: (ws) => `/w/${ws}/threads`,
  },
  {
    id: "activity",
    label: "Activity",
    description: "Mentions, reactions, replies and invites",
    icon: AtSign,
    href: (ws) => `/w/${ws}/activity`,
  },
  {
    id: "later",
    label: "Later",
    description: "Saved messages, to-dos and reminders",
    icon: Bookmark,
    href: (ws) => `/w/${ws}/later`,
  },
  {
    id: "drafts",
    label: "Drafts & sent",
    description: "Unsent drafts, scheduled and sent messages",
    icon: SendHorizontal,
    href: (ws) => `/w/${ws}/drafts`,
  },
  {
    id: "huddles",
    label: "Huddles",
    description: "Live huddles and call history",
    icon: Headphones,
    href: (ws) => `/w/${ws}/huddles`,
  },
  {
    id: "calendar",
    label: "Calendar",
    description: "Scheduled huddles you're organizing or invited to",
    icon: CalendarDays,
    href: (ws) => `/w/${ws}/calendar`,
  },
  {
    id: "files",
    label: "Files",
    description: "Everything shared across your conversations",
    icon: Files,
    href: (ws) => `/w/${ws}/files`,
  },
  {
    id: "canvases",
    label: "Canvases",
    description: "Shared docs, edited together in real time",
    icon: FileText,
    href: (ws) => `/w/${ws}/canvas`,
  },
  {
    id: "directory",
    label: "Directory",
    description: "People and channels in this workspace",
    icon: BookUser,
    href: (ws) => `/w/${ws}/directory`,
  },
];

export const NAV_ITEM_BY_ID: Readonly<Record<NavItemId, NavItem>> = Object.fromEntries(
  NAV_ITEMS.map((i) => [i.id, i]),
) as Record<NavItemId, NavItem>;
