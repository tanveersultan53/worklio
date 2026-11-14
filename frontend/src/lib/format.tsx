import { Fragment, type ReactNode } from "react";

import { CodeBlock, resolveLanguage } from "@/components/messaging/code-block";
import type { Member } from "@/lib/api";
import { replaceShortcodes } from "@/lib/emoji";

/**
 * Lightweight, safe message formatting (builds React nodes; never injects raw message HTML).
 *   *bold*  _italic_  ~strike~  `code`  ```lang code block```  > quote  links
 *   <@user_id> people · <!here> <!channel> <!everyone> broadcasts · <!subteam^GROUP_ID> user groups
 */

/** Minimal user-group shape the formatter needs (see lib/messaging.ts UserGroup). */
export type MentionGroup = { id: string; handle: string; name: string; member_ids: string[] };

const MENTION_RE = /<@([0-9a-f-]{36})>/g;
const SPECIAL_RE = /<!(here|channel|everyone)>/g;
const SUBTEAM_RE = /<!subteam\^([0-9a-f-]{36})>/g;
export const BROADCASTS = ["here", "channel", "everyone"] as const;
export type Broadcast = (typeof BROADCASTS)[number];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `@Full Name` (as typed in the composer) → `<@user_id>` (as stored). Longest names first.
 * Also encodes `@here` / `@channel` / `@everyone` and `@group-handle` when groups are given.
 */
export function encodeMentions(text: string, members: Member[], groups: MentionGroup[] = []): string {
  const sorted = [...members].sort((a, b) => b.full_name.length - a.full_name.length);
  let out = text;
  for (const m of sorted) {
    out = out.replace(new RegExp(`@${escapeRe(m.full_name)}(?![\\w])`, "g"), `<@${m.user_id}>`);
  }
  out = out.replace(/(^|[^\w<])@(here|channel|everyone)(?![\w-])/g, (_, pre: string, word: string) => `${pre}<!${word}>`);
  for (const g of [...groups].sort((a, b) => b.handle.length - a.handle.length)) {
    out = out.replace(
      new RegExp(`(^|[^\\w<])@${escapeRe(g.handle)}(?![\\w-])`, "g"),
      (_, pre: string) => `${pre}<!subteam^${g.id}>`,
    );
  }
  return out;
}

/** Stored tokens → `@Full Name` / `@here` / `@handle`, for editing and plain-text previews. */
export function decodeMentions(
  text: string,
  names: Record<string, Member>,
  groups: Record<string, MentionGroup> = {},
): string {
  return text
    .replace(MENTION_RE, (_, id: string) => `@${names[id]?.full_name ?? "unknown"}`)
    .replace(SPECIAL_RE, (_, word: string) => `@${word}`)
    .replace(SUBTEAM_RE, (_, id: string) => `@${groups[id]?.handle ?? "group"}`);
}

/**
 * Does this message mention `userId`? Direct mentions, @here/@channel/@everyone (the server
 * only delivers those to channel members) and groups the user belongs to.
 */
export function mentionsUser(
  text: string,
  userId: string | undefined,
  groups: Record<string, MentionGroup> = {},
): boolean {
  if (!userId) return false;
  if (text.includes(`<@${userId}>`)) return true;
  if (/<!(?:here|channel|everyone)>/.test(text)) return true;
  for (const match of text.matchAll(SUBTEAM_RE)) {
    if (groups[match[1]]?.member_ids.includes(userId)) return true;
  }
  return false;
}

const EMOJI_ONLY_RE = /^(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*\s*){1,5}$/u;
export const isJumboEmoji = (text: string) => EMOJI_ONLY_RE.test(text.trim());

type Ctx = {
  names: Record<string, Member>;
  meId?: string;
  /** User groups by id, for `<!subteam^ID>` chips. */
  groups?: Record<string, MentionGroup>;
  /** Search terms to highlight (case-insensitive) in plain text. */
  highlight?: string[];
};

const ME_CHIP =
  "rounded bg-amber-200/70 px-0.5 font-bold text-amber-900 dark:bg-amber-500/30 dark:text-amber-200";
const MENTION_CHIP = "rounded bg-mention px-0.5 font-bold text-mention-foreground";

/** Wrap search matches in <mark>. */
function marked(text: string, ctx: Ctx, key: string): ReactNode[] {
  const terms = ctx.highlight?.filter((t) => t.trim().length > 0);
  if (!terms?.length || !text) return [text];
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  return text.split(re).map((piece, i) =>
    i % 2 === 1 ? (
      <mark key={`${key}-m${i}`} className="rounded-sm bg-amber-200 px-px text-inherit dark:bg-amber-500/40">
        {piece}
      </mark>
    ) : (
      piece
    ),
  );
}

// Emphasis markers only count at word boundaries and must hug their text, like Slack:
// `my_var_name`, `2*3*4` and `a * b * c` stay literal.
const INLINE_RE =
  /(`[^`\n]+`)|(<@[0-9a-f-]{36}>)|(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"])|((?<![\p{L}\p{N}_*])\*(?!\s)[^*\n]+?(?<!\s)\*(?![\p{L}\p{N}_*]))|((?<![\p{L}\p{N}_])_(?!\s)[^_\n]+?(?<!\s)_(?![\p{L}\p{N}_]))|((?<![\p{L}\p{N}_~])~(?!\s)[^~\n]+?(?<!\s)~(?![\p{L}\p{N}_~]))|(<!(?:here|channel|everyone)>)|(<!subteam\^[0-9a-f-]{36}>)|(¯\\_\(ツ\)_\/¯)/gu;

function inline(text: string, ctx: Ctx, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const [token] = match;
    const start = match.index ?? 0;
    if (start > last) nodes.push(...marked(replaceShortcodes(text.slice(last, start)), ctx, `${keyPrefix}-t${i}`));
    const key = `${keyPrefix}-${i++}`;
    if (match[9]) {
      // The /shrug kaomoji: its underscores are not italics.
      nodes.push(...marked(token, ctx, key));
    } else if (match[7]) {
      // @here / @channel / @everyone notify every member, including me.
      nodes.push(
        <span key={key} className={ME_CHIP}>
          @{token.slice(2, -1)}
        </span>,
      );
    } else if (match[8]) {
      const group = ctx.groups?.[token.slice(10, -1)];
      const mine = !!ctx.meId && !!group?.member_ids.includes(ctx.meId);
      nodes.push(
        <span key={key} className={mine ? ME_CHIP : MENTION_CHIP} title={group?.name}>
          @{group?.handle ?? "group"}
        </span>,
      );
    } else if (match[1]) {
      nodes.push(
        <code key={key} className="rounded border bg-muted px-1 py-px font-mono text-[0.85em] text-rose-600 dark:text-rose-400">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (match[2]) {
      const id = token.slice(2, -1);
      const isMe = id === ctx.meId;
      nodes.push(
        <span
          key={key}
          className={isMe ? ME_CHIP : MENTION_CHIP}
        >
          @{ctx.names[id]?.full_name ?? "unknown"}
        </span>,
      );
    } else if (match[3]) {
      nodes.push(
        <a key={key} href={token} target="_blank" rel="noreferrer noopener" className="text-link hover:underline">
          {token}
        </a>,
      );
    } else {
      const inner = inline(token.slice(1, -1), ctx, key);
      if (match[4]) nodes.push(<strong key={key} className="font-bold">{inner}</strong>);
      else if (match[5]) nodes.push(<em key={key}>{inner}</em>);
      else nodes.push(<s key={key}>{inner}</s>);
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(...marked(replaceShortcodes(text.slice(last)), ctx, `${keyPrefix}-end`));
  return nodes;
}

function lines(text: string, ctx: Ctx, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const rows = text.split("\n");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].startsWith("> ") || rows[i] === ">") {
      const quote: string[] = [];
      while (i < rows.length && (rows[i].startsWith("> ") || rows[i] === ">")) quote.push(rows[i++].slice(2));
      i--;
      out.push(
        <blockquote key={`${keyPrefix}-q${i}`} className="my-0.5 border-l-4 border-border pl-3 text-muted-foreground">
          {lines(quote.join("\n"), ctx, `${keyPrefix}-q${i}`)}
        </blockquote>,
      );
      continue;
    }
    out.push(
      <Fragment key={`${keyPrefix}-l${i}`}>
        {inline(rows[i], ctx, `${keyPrefix}-l${i}`)}
        {i < rows.length - 1 && !rows[i + 1]?.startsWith("> ") && "\n"}
      </Fragment>,
    );
  }
  return out;
}

/** ```ts\ncode``` → language "typescript"; an unknown first word stays part of the code. */
function splitFence(part: string): { code: string; language: string | null } {
  const hint = /^([\w+#.-]{1,20})[ \t]*\n/.exec(part);
  const language = hint ? resolveLanguage(hint[1]) : null;
  const body = language && hint ? part.slice(hint[0].length) : part;
  return { code: body.replace(/^\n|\n$/g, ""), language };
}

export function formatMessage(text: string, ctx: Ctx): ReactNode {
  const parts = text.split(/```/);
  // An unterminated fence is literal text, not a code block.
  const closed = parts.length % 2 === 1;
  return parts.map((part, i) => {
    if (i % 2 === 1 && (closed || i < parts.length - 1)) {
      const { code, language } = splitFence(part);
      return <CodeBlock key={i} code={code} language={language} />;
    }
    const literal = i % 2 === 1 ? `\`\`\`${part}` : part;
    return <Fragment key={i}>{lines(literal, ctx, String(i))}</Fragment>;
  });
}
