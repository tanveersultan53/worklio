"use client";

import {
  AtSign,
  BarChart3,
  Bold,
  CalendarClock,
  ChevronDown,
  Code,
  Italic,
  Link2,
  Loader2,
  Megaphone,
  MonitorPlay,
  Paperclip,
  Plus,
  Quote,
  Radio,
  SendHorizontal,
  Smile,
  Sparkles,
  SquareCode,
  SquareSlash,
  Strikethrough,
  Users,
  Video,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  AGENT_ADD_HINT,
  AIBadge,
  AIComposeMenuItems,
  AIComposePreview,
  AIComposeUnavailableButton,
  askWorklio,
  BotAvatar,
  isBotMember,
  locateSource,
  parseAskCommand,
  useComposeAssistant,
  useWorklioAgent,
  useWorklioBot,
  WorklioAddNudge,
  type ComposeAction,
} from "@/components/ai/composer-assistant";
import { AgentWorkingLine, useAgentWorking } from "@/components/ai/agent-message";
import { DateTimeDialog } from "@/components/messaging/datetime-dialog";
import { describeWhen, presetTimes } from "@/components/messaging/natural-time";
import { PollDialog } from "@/components/messaging/poll";
import {
  filterCommands,
  runSlash,
  SLASH_QUERY,
  SlashMenu,
  type SlashCommand,
} from "@/components/messaging/slash-commands";
import { useGroupsById, useUserGroups } from "@/components/messaging/use-groups";
import { RecordClipButton } from "@/components/recording";
import { useWorkspace } from "@/components/workspace/provider";
import { VideoClipButton } from "@/components/voice/video-clip-recorder";
import { VoiceRecordButton, VoiceRecorder, type VoiceStart } from "@/components/voice/voice-recorder";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { aiGateMessage, useAIGate } from "@/lib/ai";
import { api, type Attachment, type Member, type Message, uploadFile } from "@/lib/api";
import { drafts } from "@/lib/drafts";
import { editLast, sameScope } from "@/lib/edit-last";
import { decodeMentions, encodeMentions } from "@/lib/format";
import { media } from "@/lib/messages";
import { messaging, type UserGroup } from "@/lib/messaging";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { EmojiPicker } from "./emoji-picker";
import { UserAvatar } from "./user-avatar";

type Pending = { key: string; name: string; preview?: string; attachment?: Attachment; error?: string };

// --- "Aa": formatting toolbar shown or hidden, per device (hidden by default, like Slack) ---

const FORMATTING_KEY = "worklio.composer.formatting";
const formattingListeners = new Set<() => void>();

function readFormattingPref(): boolean {
  try {
    return localStorage.getItem(FORMATTING_KEY) === "1";
  } catch {
    return false;
  }
}

function setFormattingPref(on: boolean) {
  try {
    localStorage.setItem(FORMATTING_KEY, on ? "1" : "0");
  } catch {
    // storage blocked: the toggle still works for this page
  }
  formattingOverride = on;
  formattingListeners.forEach((fn) => fn());
}

let formattingOverride: boolean | null = null;

function useFormattingPref(): boolean {
  return useSyncExternalStore(
    (fn) => {
      formattingListeners.add(fn);
      return () => {
        formattingListeners.delete(fn);
      };
    },
    () => formattingOverride ?? readFormattingPref(),
    () => false,
  );
}

/** Formatting toolbar: markers wrapped around the selection. */
const TOOLS: { icon: typeof Bold; label: string; keys?: string; before: string; after: string; fill: string }[] = [
  { icon: Bold, label: "Bold", keys: "⌘B", before: "*", after: "*", fill: "" },
  { icon: Italic, label: "Italic", keys: "⌘I", before: "_", after: "_", fill: "" },
  { icon: Strikethrough, label: "Strikethrough", before: "~", after: "~", fill: "" },
  { icon: Link2, label: "Link", before: "", after: "", fill: "https://" },
  { icon: Quote, label: "Quote", before: "> ", after: "", fill: "" },
  { icon: Code, label: "Code", before: "`", after: "`", fill: "" },
  { icon: SquareCode, label: "Code block", before: "```\n", after: "\n```", fill: "" },
];

const MENTION_QUERY = /(^|\s)@([^\s@]{0,20}(?: [^\s@]{0,20})?)$/;

/** Max days ahead a message can be scheduled (server rule). */
const MAX_SCHEDULE_DAYS = 120;
const SCHEDULED_NOTICE_MS = 10_000;

type Suggestion =
  | { kind: "broadcast"; key: string; word: "here" | "channel" | "everyone"; hint: string }
  | { kind: "group"; key: string; group: UserGroup }
  | { kind: "person"; key: string; member: Member };

const BROADCAST_HINTS = {
  here: "Notify everyone online in this conversation",
  channel: "Notify everyone in this conversation",
  everyone: "Notify everyone in this conversation",
} as const;

/** Text inserted after "@" for a suggestion. */
const suggestionText = (s: Suggestion) =>
  s.kind === "broadcast" ? s.word : s.kind === "group" ? s.group.handle : s.member.full_name;

type ScheduledNotice = { id: string; sendAt: string; body: string };

export function Composer({
  channelId,
  parentId,
  placeholder,
  onSent,
  autoFocus,
}: {
  channelId: string;
  parentId?: string;
  placeholder: string;
  onSent?: (m: Message) => void;
  autoFocus?: boolean;
}) {
  const ws = useWorkspace();
  const { workspaceId, sendTyping, typing, memberById, members, online } = ws;
  const router = useRouter();
  const groups = useUserGroups(workspaceId);
  const groupsById = useGroupsById(workspaceId);
  /** ✨ writing help (composer feature) and "/ai" (ask feature), gated by status, policy and toggles. */
  const composeGate = useAIGate("composer", workspaceId);
  const askGate = useAIGate("ask", workspaceId);
  const aiEnabled = composeGate.ready;
  const [aiGateOpen, setAiGateOpen] = useState(false);
  const bot = useWorklioBot(workspaceId, members);
  /** Is @worklio installed in this channel (and can I add it)? */
  const agent = useWorklioAgent(channelId);
  const [nudgeDismissed, setNudgeDismissed] = useState<string | null>(null);
  /** Everyone @-mentionable: workspace members plus the Worklio bot (when AI is on). */
  const mentionable = useMemo(
    () => (bot && !members.some((m) => m.user_id === bot.user_id) ? [...members, bot] : members),
    [members, bot],
  );
  const channel = ws.channels.find((c) => c.id === channelId);
  const isDM = channel?.kind === "dm";
  const isOneToOne = isDM && (channel?.member_ids.length ?? 0) <= 2;
  // Unsent text survives channel switches, closing the thread and reloads.
  const [body, setBody] = useState(() => drafts.get(channelId, parentId));
  const [files, setFiles] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  /** A voice message being recorded/previewed; replaces the text area while set. */
  const [voice, setVoice] = useState<VoiceStart | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const showFormatting = useFormattingPref();
  const toggleFormatting = () => setFormattingPref(!showFormatting);
  /** "/" opens the command menu in an empty message (never overwrites what's typed). */
  const startCommand = () => {
    if (!body.trim()) setBody("/");
    requestAnimationFrame(() => {
      input.current?.focus();
      if (!body.trim()) input.current?.setSelectionRange(1, 1);
    });
  };
  /** The "/…" text the user dismissed the command menu for (Escape). */
  const [slashDismissed, setSlashDismissed] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [pollDraft, setPollDraft] = useState<{ question?: string; options?: string[] } | null>(null);
  const [customSchedule, setCustomSchedule] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledNotice | null>(null);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Below `sm` the clip recorders live in the "+" menu; their buttons stay mounted (hidden) so their
  // dialogs keep working, and the menu items click them.
  const videoSlot = useRef<HTMLSpanElement>(null);
  const recordSlot = useRef<HTMLSpanElement>(null);
  // Where focus goes when the "+" menu closes: the textarea after "Mention someone", else the trigger.
  const menuFocusInput = useRef(false);
  const lastTyping = useRef(0);
  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  });

  useEffect(() => {
    drafts.set(channelId, parentId, body);
  }, [channelId, parentId, body]);

  // Release image previews when the composer goes away (channel switch, thread closed).
  useEffect(
    () => () => {
      filesRef.current.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    },
    [],
  );

  // The "Scheduled for …" confirmation fades after a few seconds.
  useEffect(() => {
    if (!scheduled) return;
    const t = setTimeout(() => setScheduled(null), SCHEDULED_NOTICE_MS);
    return () => clearTimeout(t);
  }, [scheduled]);

  // Autofocus only with a mouse/trackpad; on touch it would pop the keyboard on every channel open.
  useEffect(() => {
    const el = input.current;
    if (!autoFocus || !el || !media.finePointer()) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [autoFocus]);

  // Hand focus back after an edit started with ↑ is saved or cancelled.
  useEffect(
    () =>
      editLast.subscribe((e) => {
        if (e.kind === "done" && sameScope(e, { channelId, parentId: parentId ?? null })) input.current?.focus();
      }),
    [channelId, parentId],
  );

  const uploading = files.some((f) => !f.attachment && !f.error);
  const ready = files.filter((f) => f.attachment).map((f) => f.attachment!.id);
  const canSend = !sending && !running && !uploading && (body.trim().length > 0 || ready.length > 0);

  const slashMatch = SLASH_QUERY.exec(body);
  const slashCommands = slashMatch && slashDismissed !== body && !files.length ? filterCommands(slashMatch[1], !!isDM) : [];
  const slashOpen = slashCommands.length > 0;
  const slashActive = Math.min(slashIndex, Math.max(0, slashCommands.length - 1));

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const out: Suggestion[] = [];
    if (!isOneToOne) {
      for (const word of ["here", "channel", "everyone"] as const) {
        if (word.startsWith(q)) out.push({ kind: "broadcast", key: `b:${word}`, word, hint: BROADCAST_HINTS[word] });
      }
    }
    for (const g of groups) {
      if (g.handle.startsWith(q) || g.name.toLowerCase().includes(q)) out.push({ kind: "group", key: `g:${g.id}`, group: g });
    }
    const people = members
      .filter((m) => !isBotMember(m) && (!bot || m.user_id !== bot.user_id))
      .filter((m) => m.full_name.toLowerCase().includes(q) || m.email?.startsWith(q))
      .slice(0, 6)
      .map((member): Suggestion => ({ kind: "person", key: `p:${member.user_id}`, member }));
    // The Worklio bot: first when the query points at it ("wo…", "ai", "bot"), else after people.
    const botHit =
      bot && (bot.full_name.toLowerCase().includes(q) || ["ai", "bot", "assistant"].some((w) => w.startsWith(q)))
        ? [{ kind: "person", key: `p:${bot.user_id}`, member: bot } satisfies Suggestion]
        : [];
    const botFirst = !!q && /^(wo|wor|work|workl|workli|worklio|ai|bot)$/.test(q);
    const named = botFirst ? [...botHit, ...people] : [...people, ...botHit];
    // People first when the query clearly targets a name; broadcasts first for an empty query.
    return (q ? [...named, ...out] : [...out, ...named]).slice(0, 9);
  }, [mention, members, groups, isOneToOne, bot]);

  const updateMention = (value: string, caret: number) => {
    const match = MENTION_QUERY.exec(value.slice(0, caret));
    if (match) {
      setMention({ query: match[2], start: caret - match[2].length - 1 });
      setMentionIndex(0);
    } else setMention(null);
  };

  const isBotSuggestion = (s: Suggestion) => s.kind === "person" && (isBotMember(s.member) || s.member.user_id === bot?.user_id);

  /** Pick a suggestion. @Worklio where it isn't installed: managers add it inline, others get a hint. */
  const pickSuggestion = (s: Suggestion) => {
    if (isBotSuggestion(s) && agent.available && !agent.installed) {
      if (!agent.canAdd) {
        toast.info(`Worklio AI isn't added to #${agent.channelName}. ${AGENT_ADD_HINT}`);
        setMention(null);
        return;
      }
      void agent.add();
    }
    insertMention(suggestionText(s));
  };

  const insertMention = (name: string) => {
    if (!mention) return;
    const caret = input.current?.selectionStart ?? body.length;
    const next = `${body.slice(0, mention.start)}@${name} ${body.slice(caret)}`;
    setBody(next);
    setMention(null);
    const pos = mention.start + name.length + 2;
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(pos, pos);
    });
  };

  /** Wrap the selection (or insert at caret) with markdown-style markers. */
  const wrap = (before: string, after = before, placeholderText = "") => {
    const el = input.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const selected = body.slice(s, e) || placeholderText;
    const next = body.slice(0, s) + before + selected + after + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + selected.length);
    });
  };

  const insertAtCaret = (text: string) => {
    const el = input.current;
    const s = el?.selectionStart ?? body.length;
    const e = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, s) + text + body.slice(e));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + text.length, s + text.length);
    });
  };

  const startMention = () => {
    const caret = input.current?.selectionStart ?? body.length;
    const prefix = caret > 0 && !/\s$/.test(body.slice(0, caret)) ? " @" : "@";
    insertAtCaret(prefix);
    setMention({ query: "", start: caret + prefix.length - 1 });
  };

  const clickSlot = (slot: React.RefObject<HTMLSpanElement | null>) => slot.current?.querySelector("button")?.click();

  const removeFile = (f: Pending) => {
    if (f.preview) URL.revokeObjectURL(f.preview);
    setFiles((all) => all.filter((p) => p.key !== f.key));
  };

  const addFiles = (list: FileList | null) => {
    for (const file of Array.from(list ?? [])) {
      const key = crypto.randomUUID();
      const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined;
      setFiles((f) => [...f, { key, name: file.name, preview }]);
      uploadFile(workspaceId, file)
        .then((attachment) => setFiles((f) => f.map((p) => (p.key === key ? { ...p, attachment } : p))))
        .catch((err: Error) => setFiles((f) => f.map((p) => (p.key === key ? { ...p, error: err.message } : p))));
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const resetComposer = () => {
    files.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
    setBody("");
    setFiles([]);
  };

  const post = async (text: string) => {
    setSending(true);
    setError("");
    try {
      const msg = await api<Message>(`/channels/${channelId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body: encodeMentions(text.trim(), mentionable, groups),
          parent_id: parentId ?? null,
          attachment_ids: ready,
        }),
      });
      resetComposer();
      onSent?.(msg);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  /** Run a slash command typed into the composer. */
  const runCommand = async (text: string) => {
    setRunning(true);
    setError("");
    try {
      const outcome = await runSlash(text, {
        workspaceId,
        channel,
        parentId,
        me: ws.me,
        members,
        setMe: ws.setMe,
        reloadChannels: ws.reloadChannels,
        leaveChannel: () => router.push(`/w/${workspaceId}`),
      });
      switch (outcome.kind) {
        case "done":
          setBody("");
          break;
        case "send":
          await post(outcome.body);
          break;
        case "poll":
          setBody("");
          setPollDraft({ question: outcome.question, options: outcome.options });
          break;
        case "schedule":
          setBody(outcome.body);
          setCustomSchedule(true);
          break;
        case "keep":
          break;
      }
    } finally {
      setRunning(false);
      input.current?.focus();
    }
  };

  const send = async () => {
    if (!canSend) return;
    const text = body.trim();
    const question = !ready.length ? parseAskCommand(text) : null;
    if (question !== null) {
      // "/ai <question>": hand off to the Ask Worklio panel (it listens for "worklio:ask").
      askWorklio(question);
      if (askGate.reason) toast.info(aiGateMessage(askGate.reason, askGate.canConfigure));
      setBody("");
      setSlashDismissed(null);
      return;
    }
    if (text.startsWith("/") && !text.startsWith("//") && !ready.length) {
      await runCommand(text);
      return;
    }
    // "//text" escapes a message that should start with a slash.
    await post(text.startsWith("//") ? text.slice(1) : text);
  };

  const scheduleAt = async (when: Date): Promise<boolean> => {
    const text = body.trim();
    if (!text && !ready.length) {
      toast.error("Write a message first, then schedule it.");
      return false;
    }
    if (uploading) {
      toast.error("Wait for your files to finish uploading.");
      return false;
    }
    if (when.getTime() <= Date.now()) {
      toast.error("Pick a time in the future.");
      return false;
    }
    setSending(true);
    try {
      const item = await messaging.schedule(channelId, {
        body: encodeMentions(text.replace(/^\/\//, "/"), mentionable, groups),
        parent_id: parentId ?? null,
        attachment_ids: ready,
        send_at: when.toISOString(),
      });
      setScheduled({ id: item.id, sendAt: item.send_at ?? when.toISOString(), body: text });
      resetComposer();
      return true;
    } catch (err) {
      toast.error(`Couldn't schedule the message: ${errorMessage(err)}`);
      return false;
    } finally {
      setSending(false);
      input.current?.focus();
    }
  };

  const undoScheduled = async (notice: ScheduledNotice) => {
    setScheduled(null);
    try {
      await messaging.cancelScheduled(notice.id);
      // Put the text back so it can be edited or sent now (unless something new was typed).
      setBody((cur) => (cur.trim() ? cur : notice.body));
      toast.success("Scheduled message cancelled");
      input.current?.focus();
    } catch (err) {
      toast.error(`Couldn't cancel: ${errorMessage(err)}`);
    }
  };

  // --- Worklio AI rewrite (✨ menu, ⌘/Ctrl+Shift+E) ---
  const compose = useComposeAssistant({
    encode: (t) => encodeMentions(t, mentionable, groups),
    decode: (t) => decodeMentions(t, bot ? { ...memberById, [bot.user_id]: bot } : memberById, groupsById),
  });

  const runAI = (action: ComposeAction, language?: string) => {
    const el = input.current;
    const s = el?.selectionStart ?? 0;
    const e = el?.selectionEnd ?? 0;
    const selected = e > s && body.slice(s, e).trim() ? body.slice(s, e) : "";
    compose.run(
      selected ? { text: selected, start: s, end: e, whole: false } : { text: body, start: 0, end: body.length, whole: true },
      action,
      language,
    );
  };

  const openAI = () => {
    if (!aiEnabled) {
      if (composeGate.loading) return;
      setAiGateOpen(true);
      return;
    }
    setAiMenuOpen(true);
  };

  /** Apply the finished rewrite: replace the source text, or insert it on a new line below. */
  const applyAI = (mode: "replace" | "below") => {
    const st = compose.state;
    if (!st || st.phase !== "done") return;
    const loc = locateSource(body, st.source);
    let next: string;
    let caret: number;
    if (mode === "replace" && loc) {
      next = body.slice(0, loc.start) + st.result + body.slice(loc.end);
      caret = loc.start + st.result.length;
    } else {
      const at = loc ? loc.end : body.length;
      const insert = (body.slice(0, at).trim() ? "\n" : "") + st.result;
      next = body.slice(0, at) + insert + body.slice(at);
      caret = at + insert.length;
    }
    setBody(next);
    compose.discard();
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  };

  const discardAI = () => {
    compose.discard();
    requestAnimationFrame(() => input.current?.focus());
  };

  const pickCommand = (c: SlashCommand) => {
    setSlashIndex(0);
    if (!c.args) {
      setBody(`/${c.name}`);
      runCommand(`/${c.name}`);
      return;
    }
    const next = `/${c.name} `;
    setBody(next);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(next.length, next.length);
    });
  };

  const agentStatus = useAgentWorking(channelId, parentId);
  // The Worklio bot's typing is shown by the agent line instead (with what it's doing).
  const typers = parentId
    ? []
    : Object.keys(typing[channelId] ?? {})
        .filter((id) => !isBotMember(memberById[id]) && id !== bot?.user_id)
        .map((id) => memberById[id]?.full_name ?? "Someone");

  return (
    <div className="px-3 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:px-5">
      {bot &&
        agent.available &&
        !agent.installed &&
        nudgeDismissed !== channelId &&
        !voice &&
        body.includes(`@${bot.full_name}`) && <WorklioAddNudge agent={agent} onDismiss={() => setNudgeDismissed(channelId)} />}
      {compose.state && !voice && (
        <AIComposePreview
          state={compose.state}
          onReplace={() => applyAI("replace")}
          onInsertBelow={() => applyAI("below")}
          onRetry={compose.retry}
          onDiscard={discardAI}
        />
      )}
      <div
        className="relative rounded-xl border border-composer-border bg-background focus-within:border-foreground/50 focus-within:shadow-sm"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        {slashOpen && (
          <SlashMenu commands={slashCommands} index={slashActive} onPick={pickCommand} onHover={setSlashIndex} />
        )}

        {mention && suggestions.length > 0 && !slashOpen && (
          <div
            role="listbox"
            aria-label="Mention suggestions"
            className="absolute bottom-full left-0 z-20 mb-1 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border bg-popover shadow-lg"
          >
            <div className="border-b px-3 py-1.5 text-xs font-bold text-muted-foreground">Mention</div>
            {suggestions.map((s, i) => (
              <button
                key={s.key}
                type="button"
                role="option"
                aria-selected={i === mentionIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pickSuggestion(s);
                }}
                onMouseEnter={() => setMentionIndex(i)}
                className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm", i === mentionIndex && "bg-link text-white")}
              >
                {s.kind === "person" && (isBotMember(s.member) || s.member.user_id === bot?.user_id) ? (
                  <>
                    <BotAvatar id={s.member.user_id} name={s.member.full_name} size="sm" />
                    <span className="font-bold">{s.member.full_name}</span>
                    <AIBadge className={cn(i === mentionIndex && "bg-white/20 text-white ring-white/40 dark:text-white")} />
                    {agent.installed ? (
                      <span className="truncate text-xs opacity-70">Ask AI right here</span>
                    ) : agent.canAdd ? (
                      <span className="ml-auto flex shrink-0 items-center gap-1 text-xs">
                        <span className="opacity-70">Not added to this channel ·</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 font-semibold",
                            i === mentionIndex ? "bg-white/20" : "bg-violet-500/10 text-violet-700 dark:text-violet-300",
                          )}
                        >
                          {agent.adding ? "Adding…" : "Add"}
                        </span>
                      </span>
                    ) : (
                      <span className="truncate text-xs opacity-70" title={AGENT_ADD_HINT}>
                        Not added to this channel · ask a channel manager
                      </span>
                    )}
                  </>
                ) : s.kind === "person" ? (
                  <>
                    <UserAvatar
                      id={s.member.user_id}
                      name={s.member.full_name}
                      size="sm"
                      online={online.has(s.member.user_id)}
                      ringClassName="border-transparent"
                    />
                    <span className="font-bold">{s.member.full_name}</span>
                    <span className="truncate text-xs opacity-70">{s.member.email}</span>
                  </>
                ) : s.kind === "group" ? (
                  <>
                    <Users className="size-[18px] shrink-0 opacity-80" />
                    <span className="font-bold">@{s.group.handle}</span>
                    <span className="truncate text-xs opacity-70">
                      {s.group.name} · {s.group.member_ids.length} {s.group.member_ids.length === 1 ? "person" : "people"}
                    </span>
                  </>
                ) : (
                  <>
                    {s.word === "here" ? (
                      <Radio className="size-[18px] shrink-0 opacity-80" />
                    ) : (
                      <Megaphone className="size-[18px] shrink-0 opacity-80" />
                    )}
                    <span className="font-bold">@{s.word}</span>
                    <span className="truncate text-xs opacity-70">{s.hint}</span>
                  </>
                )}
              </button>
            ))}
          </div>
        )}

        {voice ? (
          <VoiceRecorder
            start={voice}
            workspaceId={workspaceId}
            channelId={channelId}
            parentId={parentId}
            onSent={onSent}
            onClose={() => {
              setVoice(null);
              requestAnimationFrame(() => input.current?.focus());
            }}
          />
        ) : (
        <>
        <div
          className={cn(
            "hidden items-center gap-0.5 rounded-t-xl bg-composer-toolbar px-1.5 py-1",
            showFormatting && "sm:flex",
          )}
        >
          {TOOLS.map((t) => (
            <Hint
              key={t.label}
              label={t.label}
              keys={t.keys}
              trigger={
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => wrap(t.before, t.after, t.fill)}
                  aria-label={t.label}
                  aria-keyshortcuts={t.keys ? t.keys.replace("⌘", "Meta+") : undefined}
                  className="rounded p-1.5 text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                />
              }
            >
              <t.icon className="size-4" aria-hidden />
            </Hint>
          ))}
        </div>

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {files.map((f) => (
              <span
                key={f.key}
                title={f.error}
                className={cn(
                  "group/file relative flex items-center gap-2 overflow-hidden rounded-lg border bg-background text-xs",
                  f.preview ? "size-16" : "px-3 py-2",
                  f.error && "border-destructive text-destructive",
                )}
              >
                {f.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local blob preview
                  <img src={f.preview} alt={f.name} className="size-full object-cover" />
                ) : (
                  <span className="max-w-40 truncate font-bold">{f.name}</span>
                )}
                {!f.attachment && !f.error && (
                  <span className="absolute inset-0 flex items-center justify-center bg-background/60">
                    <Loader2 className="size-4 animate-spin" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeFile(f)}
                  aria-label={`Remove ${f.name}`}
                  title={`Remove ${f.name}`}
                  className="absolute top-0.5 right-0.5 flex size-5 items-center justify-center rounded-full bg-foreground text-background opacity-100 after:absolute after:-inset-2 focus-visible:opacity-100 sm:opacity-0 sm:group-hover/file:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={input}
          value={body}
          rows={1}
          placeholder={placeholder}
          onChange={(e) => {
            setBody(e.target.value);
            setSlashIndex(0);
            updateMention(e.target.value, e.target.selectionStart);
            // Typing events carry no thread id, so only the channel composer announces typing.
            if (!parentId && Date.now() - lastTyping.current > 2500) {
              lastTyping.current = Date.now();
              sendTyping(channelId);
            }
          }}
          aria-autocomplete="list"
          aria-controls={slashOpen ? "slash-menu" : undefined}
          aria-activedescendant={slashOpen ? `slash-${slashCommands[slashActive]?.name}` : undefined}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && (e.code === "KeyE" || e.key.toLowerCase() === "e")) {
              e.preventDefault();
              openAI();
              return;
            }
            if (slashOpen) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setSlashIndex((slashActive + d + slashCommands.length) % slashCommands.length);
                return;
              }
              if ((e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === "Tab") {
                e.preventDefault();
                pickCommand(slashCommands[slashActive]);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setSlashDismissed(body);
                return;
              }
            }
            if (mention && suggestions.length) {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const d = e.key === "ArrowDown" ? 1 : -1;
                setMentionIndex((i) => (i + d + suggestions.length) % suggestions.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                pickSuggestion(suggestions[Math.min(mentionIndex, suggestions.length - 1)]);
                return;
              }
              if (e.key === "Escape") {
                // Only dismiss the suggestions; don't let a surrounding thread panel close too.
                e.preventDefault();
                e.stopPropagation();
                setMention(null);
                return;
              }
            }
            if (compose.state) {
              if (e.key === "Escape") {
                // Discard the AI suggestion; don't let a surrounding thread panel close too.
                e.preventDefault();
                e.stopPropagation();
                discardAI();
                return;
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && compose.state.phase === "done") {
                e.preventDefault();
                applyAI("replace");
                return;
              }
            }
            if (e.key === "ArrowUp" && !body && !files.length && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              editLast.request(channelId, parentId ?? null);
              return;
            }
            if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "i")) {
              e.preventDefault();
              wrap(e.key === "b" ? "*" : "_");
              return;
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onBlur={() => setMention(null)}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              addFiles(e.clipboardData.files);
            }
          }}
          className="field-sizing-content block max-h-60 min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-[length:max(16px,var(--msg-size,15px))] leading-[var(--msg-leading,22px)] outline-none placeholder:text-muted-foreground sm:text-msg"
        />

        <div className="flex min-w-0 items-center gap-0.5 px-1.5 pb-1.5">
          <DropdownMenu>
            <Hint
              label="Add files, polls and more"
              trigger={
                <DropdownMenuTrigger
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground outline-none hover:bg-muted-foreground/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 data-popup-open:bg-muted-foreground/20 sm:size-7"
                  aria-label="Add files, polls and more"
                />
              }
            >
              <Plus className="size-4 transition-transform duration-150 in-data-popup-open:rotate-45 motion-reduce:transition-none" aria-hidden />
            </Hint>
            <DropdownMenuContent
              side="top"
              align="start"
              className="w-56"
              finalFocus={() => {
                if (!menuFocusInput.current) return true;
                menuFocusInput.current = false;
                return input.current;
              }}
            >
              <DropdownMenuItem onClick={() => fileInput.current?.click()}>
                <Paperclip className="size-4" /> Upload a file
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setPollDraft({})}>
                <BarChart3 className="size-4" /> Create a poll
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCustomSchedule(true)}>
                <CalendarClock className="size-4" /> Schedule a message
              </DropdownMenuItem>
              {/* Small screens: the secondary bar buttons collapse into this menu. */}
              <DropdownMenuSeparator className="sm:hidden" />
              <DropdownMenuItem
                className="sm:hidden"
                onClick={() => {
                  menuFocusInput.current = true;
                  startMention();
                }}
              >
                <AtSign className="size-4" /> Mention someone
                <span className="ml-auto text-xs text-muted-foreground">@</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="sm:hidden" onClick={() => clickSlot(videoSlot)}>
                <Video className="size-4" /> Record a video clip
              </DropdownMenuItem>
              <DropdownMenuItem className="sm:hidden" onClick={() => clickSlot(recordSlot)}>
                <MonitorPlay className="size-4" /> Record screen or video
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={startCommand}>
                <SquareCode className="size-4" /> Run a command
                <span className="ml-auto text-xs text-muted-foreground">/</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* Like Slack: "Aa" shows or hides the formatting toolbar (remembered on this device). */}
          <Hint
            label={showFormatting ? "Hide formatting" : "Show formatting"}
            trigger={
              <button
                type="button"
                onClick={toggleFormatting}
                aria-pressed={showFormatting}
                aria-label={showFormatting ? "Hide formatting" : "Show formatting"}
                className={cn(
                  "hidden shrink-0 rounded px-1.5 py-1 text-[15px] leading-none font-semibold text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:block",
                  showFormatting && "bg-muted text-foreground",
                )}
              />
            }
          >
            Aa
          </Hint>
          <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
            <Hint
              label="Emoji"
              trigger={
                <PopoverTrigger
                  className="shrink-0 rounded p-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:p-1.5"
                  aria-label="Emoji"
                />
              }
            >
              <Smile className="size-[18px]" aria-hidden />
            </Hint>
            <PopoverContent className="w-auto p-0" side="top" align="start">
              <EmojiPicker
                onPick={(e) => {
                  setEmojiOpen(false);
                  insertAtCaret(e);
                }}
              />
            </PopoverContent>
          </Popover>
          {aiEnabled ? (
            <DropdownMenu open={aiMenuOpen} onOpenChange={setAiMenuOpen}>
              <Hint
                label="Rewrite with Worklio AI"
                keys="⌘⇧E"
                trigger={
                  <DropdownMenuTrigger
                    aria-label="Rewrite with Worklio AI"
                    aria-keyshortcuts="Meta+Shift+E Control+Shift+E"
                    className="group/ai shrink-0 rounded p-2 text-muted-foreground outline-none hover:bg-violet-500/10 hover:text-violet-600 focus-visible:ring-2 focus-visible:ring-violet-500/50 data-popup-open:bg-violet-500/10 data-popup-open:text-violet-600 sm:p-1.5 dark:hover:text-violet-300 dark:data-popup-open:text-violet-300"
                  />
                }
              >
                {compose.state?.phase === "loading" ? (
                  <Loader2 className="size-[18px] animate-spin text-violet-500" aria-hidden />
                ) : (
                  <Sparkles className="size-[18px]" aria-hidden />
                )}
              </Hint>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-64"
                finalFocus={() => input.current ?? true}
              >
                <AIComposeMenuItems onPick={runAI} />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <AIComposeUnavailableButton open={aiGateOpen} onOpenChange={setAiGateOpen} />
          )}
          {/* Secondary actions: inline from `sm` up, inside the "+" menu below it. */}
          <span className="hidden items-center gap-0.5 sm:flex">
            <Hint
              label="Mention someone"
              keys="@"
              trigger={
                <button
                  type="button"
                  onClick={startMention}
                  className="rounded p-2 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:p-1.5"
                  aria-label="Mention someone"
                />
              }
            >
              <AtSign className="size-[18px]" aria-hidden />
            </Hint>
          </span>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <span ref={videoSlot} className="hidden items-center sm:flex">
            <VideoClipButton workspaceId={workspaceId} channelId={channelId} parentId={parentId} onSent={onSent} />
          </span>
          <VoiceRecordButton onStart={setVoice} className="shrink-0" />
          <span ref={recordSlot} className="hidden items-center sm:flex">
            <RecordClipButton workspaceId={workspaceId} channelId={channelId} parentId={parentId} onSent={onSent} />
          </span>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border sm:block" />
          <Hint
            label="Run a shortcut or command"
            keys="/"
            trigger={
              <button
                type="button"
                onClick={startCommand}
                aria-label="Run a shortcut or command"
                className="hidden shrink-0 rounded p-1.5 text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:block"
              />
            }
          >
            <SquareSlash className="size-[18px]" aria-hidden />
          </Hint>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => addFiles(e.target.files)} />
          <SendSplit
            canSend={canSend}
            busy={sending || running}
            onSend={send}
            onSchedule={scheduleAt}
            onCustom={() => setCustomSchedule(true)}
          />
        </div>
        </>
        )}
      </div>
      <div className="flex h-6 items-center justify-between text-xs text-muted-foreground">
        <span className="truncate">
          {scheduled ? (
            <span role="status" className="flex items-center gap-1.5">
              <CalendarClock className="size-3.5 shrink-0 text-link" />
              <span>
                Scheduled for <strong className="text-foreground/80">{describeWhen(new Date(scheduled.sendAt))}</strong>
              </span>
              <button
                type="button"
                onClick={() => undoScheduled(scheduled)}
                aria-label="Undo scheduled message"
                title="Cancel this scheduled message"
                className="font-bold text-link hover:underline"
              >
                Undo
              </button>
              <button
                type="button"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => setScheduled(null)}
                className="rounded p-0.5 hover:bg-muted hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            </span>
          ) : error ? (
            <span className="text-destructive">{error}</span>
          ) : agentStatus && !typers.length ? (
            <AgentWorkingLine status={agentStatus} />
          ) : (
            typers.length > 0 && (
              <>
                <strong className="text-foreground/80">{typers.join(", ")}</strong> {typers.length > 1 ? "are" : "is"} typing
                <TypingDots />
              </>
            )
          )}
        </span>
        {compose.state?.phase === "done" ? (
          <span className="hidden sm:inline">
            <strong>⌘ + Return</strong> to replace · <strong>Esc</strong> to discard
          </span>
        ) : body && (
          <span className="hidden sm:inline">
            {slashOpen ? (
              <>
                <strong>↑↓</strong> to choose · <strong>Return</strong> to select
              </>
            ) : (
              <>
                <strong>Shift + Return</strong> to add a new line
              </>
            )}
          </span>
        )}
      </div>

      {pollDraft && (
        <PollDialog
          open
          onOpenChange={(o) => !o && setPollDraft(null)}
          channelId={channelId}
          parentId={parentId}
          initial={pollDraft}
          onCreated={onSent}
        />
      )}
      {customSchedule && (
        <DateTimeDialog
          open
          onOpenChange={setCustomSchedule}
          title="Schedule message"
          description={
            body.trim() || ready.length
              ? "Pick when to send it. You can cancel any time before then."
              : "Write your message first, then pick when to send it."
          }
          confirmLabel="Schedule message"
          initial={presetTimes().tomorrow9}
          maxDays={MAX_SCHEDULE_DAYS}
          onPick={scheduleAt}
        />
      )}
    </div>
  );
}

/** Send button with a "Schedule for later" menu. */
function SendSplit({
  canSend,
  busy,
  onSend,
  onSchedule,
  onCustom,
}: {
  canSend: boolean;
  busy: boolean;
  onSend: () => void;
  onSchedule: (when: Date) => void;
  onCustom: () => void;
}) {
  const { tomorrow9, nextMonday9 } = presetTimes();
  const fmt = (d: Date) => d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <div
      className={cn(
        "ml-auto flex h-9 shrink-0 items-center overflow-hidden rounded-md transition motion-reduce:transition-none sm:h-7",
        canSend ? "bg-send text-white" : "text-muted-foreground/60",
      )}
    >
      <Hint
        label={busy ? "Sending…" : "Send"}
        keys="↵"
        trigger={
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            aria-label="Send"
            aria-keyshortcuts="Enter"
            aria-busy={busy || undefined}
            className={cn(
              "flex h-full items-center px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset sm:px-2.5",
              canSend && "hover:bg-black/10",
            )}
          />
        }
      >
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <SendHorizontal className="size-4" aria-hidden />}
      </Hint>
      <span aria-hidden className={cn("h-4 w-px", canSend ? "bg-white/40" : "bg-border")} />
      <DropdownMenu>
        <Hint
          label="Schedule for later"
          trigger={
            <DropdownMenuTrigger
              disabled={!canSend}
              aria-label="Schedule for later"
              className={cn(
                "flex h-full items-center px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset",
                canSend && "hover:bg-black/10 data-popup-open:bg-black/10",
              )}
            />
          }
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </Hint>
        <DropdownMenuContent side="top" align="end" className="w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Schedule message</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onSchedule(tomorrow9)}>
              Tomorrow at 9:00 AM
              <span className="ml-auto text-xs text-muted-foreground">{fmt(tomorrow9)}</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onSchedule(nextMonday9)}>
              Next Monday at 9:00 AM
              <span className="ml-auto text-xs text-muted-foreground">{fmt(nextMonday9)}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onCustom}>
              <CalendarClock className="size-4" /> Custom time…
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Styled tooltip for a composer control; `trigger` is the control element (it receives props + ref). */
function Hint({
  label,
  keys,
  trigger,
  children,
}: {
  label: string;
  keys?: string;
  trigger: React.ReactElement;
  children?: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={trigger}>{children}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}>
        <span>{label}</span>
        {keys && (
          <kbd className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded border border-background/25 bg-background/15 px-1 font-sans text-[10px] font-semibold">
            {keys}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function TypingDots() {
  return (
    <span className="ml-0.5 inline-flex gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block size-1 rounded-full bg-current"
          style={{ animation: "typing-dot 1.2s infinite", animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </span>
  );
}
