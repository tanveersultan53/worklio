"use client";

import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { UserAvatar } from "@/components/chat/user-avatar";
import { ChannelTag } from "@/components/views/message-snippet";
import { useWorkspace } from "@/components/workspace/provider";
import type { AICitation } from "@/lib/ai";
import { decodeMentions } from "@/lib/format";
import { messagePath } from "@/lib/messages";
import { cn } from "@/lib/utils";

/** Navigate to a cited message (scrolls to it, opens its thread for replies). */
export function useJumpToCitation(onJump?: () => void) {
  const router = useRouter();
  const { workspaceId } = useWorkspace();
  return useCallback(
    (c: Pick<AICitation, "message_id" | "channel_id" | "parent_id">) => {
      router.push(messagePath({ id: c.message_id, channel_id: c.channel_id, parent_id: c.parent_id, workspace_id: workspaceId }));
      onJump?.();
    },
    [router, workspaceId, onJump],
  );
}

const shortDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
};

/** Inline numbered chip for a `[n]` marker in AI text. */
export function CitationChip({
  n,
  citation,
  onJump,
  label,
}: {
  n: number;
  citation: AICitation | undefined;
  onJump?: (c: AICitation) => void;
  /** Shown instead of `n` (e.g. "6–12" for a range; opens the first source). */
  label?: string;
}) {
  const ws = useWorkspace();
  const author = citation ? (ws.memberById[citation.author_id]?.full_name ?? "Someone") : "";
  const snippet = citation ? decodeMentions(citation.snippet, ws.memberById).replace(/\s+/g, " ").trim() : "";
  return (
    <button
      type="button"
      disabled={!citation || !onJump}
      onClick={() => citation && onJump?.(citation)}
      title={citation ? `${author}: ${snippet.length > 140 ? `${snippet.slice(0, 137)}…` : snippet}` : `Source ${n}`}
      aria-label={citation ? `Source ${n}: message from ${author}. Open message` : `Source ${n}`}
      className="mx-px inline-flex h-[1.15rem] min-w-[1.15rem] -translate-y-px items-center justify-center rounded-md bg-violet-500/12 px-1 align-middle text-[10.5px] font-bold text-violet-700 tabular-nums transition-colors hover:bg-violet-500/25 disabled:cursor-default disabled:opacity-70 dark:bg-violet-400/15 dark:text-violet-200 dark:hover:bg-violet-400/30"
    >
      {label ?? n}
    </button>
  );
}

/** Numbered source list under an answer. */
export function CitationList({
  citations,
  onJump,
  className,
  max = 12,
}: {
  citations: AICitation[];
  onJump: (c: AICitation) => void;
  className?: string;
  max?: number;
}) {
  const ws = useWorkspace();
  if (!citations.length) return null;
  const shown = citations.slice(0, max);
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">Sources</p>
      <ol className="space-y-1">
        {shown.map((c) => {
          const author = ws.memberById[c.author_id]?.full_name ?? "Someone";
          const snippet = decodeMentions(c.snippet, ws.memberById).replace(/\s+/g, " ").trim();
          return (
            <li key={`${c.n}-${c.message_id}`}>
              <button
                type="button"
                onClick={() => onJump(c)}
                className="group flex w-full items-start gap-2 rounded-lg border bg-background/60 px-2 py-1.5 text-left transition-colors hover:border-violet-500/40 hover:bg-violet-500/[0.04] focus-visible:ring-2 focus-visible:ring-violet-500/50 focus-visible:outline-none"
              >
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md bg-violet-500/12 text-[11px] font-bold text-violet-700 dark:bg-violet-400/15 dark:text-violet-200">
                  {c.n}
                </span>
                <UserAvatar id={c.author_id} name={author} size="sm" className="mt-px" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs">
                    <span className="truncate font-bold">{author}</span>
                    <ChannelTag channelId={c.channel_id} className="text-[11px] font-semibold text-muted-foreground" />
                    {c.parent_id && <span className="shrink-0 text-[11px] text-muted-foreground">· in thread</span>}
                    <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{shortDate(c.created_at)}</span>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{snippet || "(no text)"}</span>
                </span>
                <ArrowUpRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          );
        })}
      </ol>
      {citations.length > max && <p className="text-[11px] text-muted-foreground">+{citations.length - max} more sources</p>}
    </div>
  );
}
