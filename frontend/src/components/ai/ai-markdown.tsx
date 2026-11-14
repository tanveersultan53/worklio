"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useGroupsById } from "@/components/messaging/use-groups";
import { useWorkspace } from "@/components/workspace/provider";
import { CITATION_RE, citationNumbers, joinCitationRanges, type AICitation } from "@/lib/ai";
import { formatMessage, type MentionGroup } from "@/lib/format";
import type { Member } from "@/lib/api";
import { cn } from "@/lib/utils";

import { StreamingCursor } from "./brand";
import { CitationChip } from "./citations";

/**
 * Renders model markdown (headings, bullets, numbered lists, code fences, **bold**) with the
 * app's own message formatter for inline content, so mentions (<@id>), links, code and emoji
 * look exactly like messages. `[n]` markers become citation chips. Never injects HTML.
 */

type Ctx = {
  names: Record<string, Member>;
  meId?: string;
  groups: Record<string, MentionGroup>;
  citations: Map<number, AICitation>;
  onCite?: (c: AICitation) => void;
  channelHref?: (name: string) => string | null;
};

const INLINE_RE = new RegExp(`${CITATION_RE.source}|\\[([^\\]\\n]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)`, "g");

/** Markdown emphasis → message markup that formatMessage understands. */
const normalize = (s: string) => s.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "*$1*").replace(/__(?=\S)(.+?)(?<=\S)__/g, "_$1_");

function inline(raw: string, ctx: Ctx, key: string): ReactNode[] {
  const text = joinCitationRanges(raw);
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  const fmt = (s: string, k: string) => {
    if (s) out.push(<span key={k}>{formatMessage(normalize(s), ctx)}</span>);
  };
  for (const m of text.matchAll(INLINE_RE)) {
    const start = m.index ?? 0;
    fmt(text.slice(last, start), `${key}-t${i}`);
    if (m[1]) {
      const nums = citationNumbers(m[1]);
      const isRange = nums.length > 2 && nums.every((n, j) => j === 0 || n === nums[j - 1] + 1);
      if (isRange) {
        // A run like 6–12 is one chip (opens the first source); the full list is under "sources".
        const n = nums[0];
        out.push(
          <CitationChip key={`${key}-c${i}-r`} n={n} label={`${n}–${nums[nums.length - 1]}`} citation={ctx.citations.get(n)} onJump={ctx.onCite} />,
        );
      } else {
        for (const n of nums) {
          out.push(<CitationChip key={`${key}-c${i}-${n}`} n={n} citation={ctx.citations.get(n)} onJump={ctx.onCite} />);
        }
      }
    } else if (m[2] && m[3]) {
      out.push(
        <a key={`${key}-a${i}`} href={m[3]} target="_blank" rel="noreferrer noopener" className="text-link hover:underline">
          {m[2]}
        </a>,
      );
    }
    last = start + m[0].length;
    i++;
  }
  fmt(text.slice(last), `${key}-end`);
  return out;
}

/** A heading like "#design" or "design (5 new)" links to the channel when one matches. */
function headingContent(text: string, ctx: Ctx, key: string): ReactNode {
  const match = /^(?:\*\*)?#([\w.-]+)(?:\*\*)?(.*)$/.exec(text.trim());
  const href = match ? ctx.channelHref?.(match[1]) : null;
  if (match && href)
    return (
      <>
        <Link href={href} className="hover:underline">
          #{match[1]}
        </Link>
        {inline(match[2], ctx, key)}
      </>
    );
  return inline(text, ctx, key);
}

type Block = { node: (tail: ReactNode) => ReactNode };

function blocks(md: string, ctx: Ctx): Block[] {
  const out: Block[] = [];
  const parts = md.split("```");
  parts.forEach((part, pi) => {
    if (pi % 2 === 1) {
      // Code fence (close an unterminated one while streaming so it renders as code).
      const fenced = `\`\`\`${part}\`\`\``;
      out.push({ node: (tail) => <div key={`code-${pi}`} className="my-2">{formatMessage(fenced, ctx)}{tail}</div> });
      return;
    }
    const rows = part.split("\n");
    let list: { ordered: boolean; items: { text: string; indent: number; n?: string }[] } | null = null;
    let para: string[] = [];
    const flushPara = () => {
      if (!para.length) return;
      const text = para.join("\n");
      const k = `p-${pi}-${out.length}`;
      para = [];
      out.push({
        node: (tail) => (
          <p key={k} className="my-1.5 break-words whitespace-pre-wrap first:mt-0 last:mb-0">
            {text.split("\n").map((line, li, all) => (
              <span key={li}>
                {inline(line, ctx, `${k}-${li}`)}
                {li < all.length - 1 && "\n"}
              </span>
            ))}
            {tail}
          </p>
        ),
      });
    };
    const flushList = () => {
      if (!list) return;
      const l = list;
      list = null;
      const k = `l-${pi}-${out.length}`;
      const Tag = l.ordered ? "ol" : "ul";
      out.push({
        node: (tail) => (
          <Tag key={k} className={cn("my-1.5 space-y-0.5 pl-5", l.ordered ? "list-decimal" : "list-disc", "marker:text-violet-500/70")}>
            {l.items.map((it, ii) => (
              <li
                key={ii}
                value={l.ordered && it.n ? Number(it.n) : undefined}
                className="break-words pl-0.5"
                style={it.indent ? { marginLeft: `${Math.min(it.indent, 3) * 1.1}rem` } : undefined}
              >
                {inline(it.text, ctx, `${k}-${ii}`)}
                {ii === l.items.length - 1 && tail}
              </li>
            ))}
          </Tag>
        ),
      });
    };

    for (const row of rows) {
      const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(row);
      const bullet = /^(\s*)[-*•]\s+(.*)$/.exec(row);
      const ordered = /^(\s*)(\d{1,3})[.)]\s+(.*)$/.exec(row);
      if (heading) {
        flushPara();
        flushList();
        const level = heading[1].length;
        const text = heading[2].replace(/\s*#+\s*$/, "");
        const k = `h-${pi}-${out.length}`;
        out.push({
          node: (tail) => (
            <p
              key={k}
              role="heading"
              aria-level={Math.min(level + 2, 6)}
              className={cn(
                "mt-3 mb-1 font-black first:mt-0",
                level <= 2 ? "text-[15px]" : "text-[14px]",
              )}
            >
              {headingContent(text, ctx, k)}
              {tail}
            </p>
          ),
        });
      } else if (bullet || ordered) {
        flushPara();
        const isOrdered = !!ordered && !bullet;
        if (list && (list as { ordered: boolean }).ordered !== isOrdered) flushList();
        if (!list) list = { ordered: isOrdered, items: [] };
        const indent = Math.floor(((bullet ? bullet[1] : ordered![1]) ?? "").length / 2);
        (list as { items: { text: string; indent: number; n?: string }[] }).items.push(
          bullet ? { text: bullet[2], indent } : { text: ordered![3], indent, n: ordered![2] },
        );
      } else if (/^\s*([-*_])\1{2,}\s*$/.test(row)) {
        flushPara();
        flushList();
        const k = `hr-${pi}-${out.length}`;
        out.push({ node: (tail) => <div key={k}><hr className="my-3 border-border" />{tail}</div> });
      } else if (!row.trim()) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(row);
      }
    }
    flushPara();
    flushList();
  });
  return out;
}

export function AIMarkdown({
  text,
  citations = [],
  streaming,
  onCite,
  linkChannels,
  className,
}: {
  text: string;
  citations?: AICitation[];
  streaming?: boolean;
  onCite?: (c: AICitation) => void;
  /** Turn "#channel" headings into links (catch-up digests). */
  linkChannels?: boolean;
  className?: string;
}) {
  const ws = useWorkspace();
  const groups = useGroupsById(ws.workspaceId);
  const byName = new Map(ws.channels.filter((c) => c.kind !== "dm").map((c) => [c.name.toLowerCase(), c.id]));
  const ctx: Ctx = {
    names: ws.memberById,
    meId: ws.me?.id,
    groups,
    citations: new Map(citations.map((c) => [c.n, c])),
    onCite,
    channelHref: linkChannels
      ? (name) => {
          const id = byName.get(name.toLowerCase());
          return id ? `/w/${ws.workspaceId}/c/${id}` : null;
        }
      : undefined,
  };
  const list = blocks(text, ctx);
  const cursor = streaming ? <StreamingCursor key="cursor" /> : null;
  return (
    <div className={cn("text-[14.5px] leading-relaxed", className)}>
      {list.map((b, i) => b.node(i === list.length - 1 ? cursor : null))}
      {!list.length && cursor}
    </div>
  );
}
