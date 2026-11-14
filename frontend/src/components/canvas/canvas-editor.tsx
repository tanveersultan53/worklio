"use client";

import { EditorContent, useEditor, type Editor, type JSONContent, type UseEditorOptions } from "@tiptap/react";
import {
  ChevronLeft,
  CircleAlert,
  Copy,
  Ellipsis,
  FileDown,
  FileText,
  Globe,
  Hash,
  ListTree,
  Loader2,
  Lock,
  MessageSquare,
  NotebookPen,
  RotateCcw,
  Share2,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { ApiError, uploadFile } from "@/lib/api";
import {
  asCanvasEvent,
  canDeleteCanvas,
  canvasApi,
  caretColorFor,
  resignExpiredImages,
  type Canvas,
  type CanvasDetail,
} from "@/lib/canvas";
import { copyText } from "@/lib/clipboard";
import { encodeMentions } from "@/lib/format";
import { errorMessage, toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { TableBubbleMenu, TextBubbleMenu } from "./bubble-menus";
import { EmojiButton, ShareDialog } from "./canvas-dialogs";
import { CommentsPanel, type CommentDraft } from "./comments-panel";
import { timeAgo, useNow } from "./doc-utils";
import { buildExtensions, findCommentAnchor, removeCommentAnchor, type MentionCandidate } from "./extensions";
import { downloadText, safeFilename, toMarkdown } from "./markdown";
import { LivePresence, Outline, useDocStats } from "./outline";
import { buildSeedUpdate } from "./seed";
import type { SlashContext, SlashItem } from "./slash-items";
import { MentionMenu, SlashMenu } from "./suggestion-popup";
import { SuggestionStore } from "./suggestion-store";
import { TEMPLATES } from "./templates";
import { CanvasToolbar } from "./toolbar";
import type { CanvasTemplate } from "./types";
import { useCanvasComments, type CommentsState } from "./use-comments";
import { REMOTE_ORIGIN, CanvasSyncProvider } from "./yjs-provider";

const TITLE_MAX = 200;
const TITLE_SAVE_MS = 700;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_TITLES = new Set(["", "canvas", "untitled", "untitled canvas"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** Prose-like typography for the document (no @tailwindcss/typography installed). */
const PROSE = [
  "min-h-[45vh] pb-28 text-[15px] leading-7 text-foreground outline-none sm:text-base [overflow-wrap:anywhere] caret-link",
  "[&>*:first-child]:mt-0",
  "[&_p]:my-2.5",
  "[&_h1]:mt-9 [&_h1]:mb-3 [&_h1]:text-[1.75rem] [&_h1]:leading-tight [&_h1]:font-black [&_h1]:tracking-tight sm:[&_h1]:text-[2rem]",
  "[&_h2]:mt-8 [&_h2]:mb-2 [&_h2]:text-[1.4rem] [&_h2]:leading-snug [&_h2]:font-extrabold [&_h2]:tracking-tight",
  "[&_h3]:mt-6 [&_h3]:mb-1.5 [&_h3]:text-[1.125rem] [&_h3]:leading-snug [&_h3]:font-bold",
  "[&_strong]:font-bold [&_em]:italic [&_s]:text-muted-foreground",
  "[&_a]:cursor-pointer [&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-2 hover:[&_a]:decoration-link",
  "[&_mark]:rounded-[3px] [&_mark]:bg-amber-200/80 [&_mark]:px-0.5 [&_mark]:text-inherit dark:[&_mark]:bg-amber-400/30",
  "[&_code]:rounded [&_code]:border [&_code]:border-border [&_code]:bg-muted [&_code]:px-1 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-rose-700 dark:[&_code]:text-rose-300",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:bg-zinc-950 [&_pre]:px-4 [&_pre]:py-3 [&_pre]:text-[13px] [&_pre]:leading-6 [&_pre]:text-zinc-100 dark:[&_pre]:bg-black/50",
  "[&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-inherit",
  "[&_blockquote]:my-4 [&_blockquote]:border-l-[3px] [&_blockquote]:border-link/50 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground",
  "[&_blockquote[data-variant=callout]]:relative [&_blockquote[data-variant=callout]]:rounded-lg [&_blockquote[data-variant=callout]]:border [&_blockquote[data-variant=callout]]:border-amber-300/60 [&_blockquote[data-variant=callout]]:bg-amber-50 [&_blockquote[data-variant=callout]]:py-2 [&_blockquote[data-variant=callout]]:pr-4 [&_blockquote[data-variant=callout]]:pl-11 [&_blockquote[data-variant=callout]]:text-foreground dark:[&_blockquote[data-variant=callout]]:border-amber-400/25 dark:[&_blockquote[data-variant=callout]]:bg-amber-400/10",
  "[&_blockquote[data-variant=callout]]:before:absolute [&_blockquote[data-variant=callout]]:before:top-[0.7rem] [&_blockquote[data-variant=callout]]:before:left-3.5 [&_blockquote[data-variant=callout]]:before:content-['💡']",
  "[&_hr]:my-8 [&_hr]:border-t [&_hr]:border-border [&_hr.ProseMirror-selectednode]:border-link",
  "[&_ul]:my-2.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_li]:pl-1 [&_li>p]:my-0 [&_li::marker]:text-muted-foreground",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0.5",
  "[&_ul[data-type=taskList]>li]:flex [&_ul[data-type=taskList]>li]:items-start [&_ul[data-type=taskList]>li]:gap-2.5 [&_ul[data-type=taskList]>li]:pl-0",
  "[&_ul[data-type=taskList]>li>label]:mt-[0.3rem] [&_ul[data-type=taskList]>li>label]:flex [&_ul[data-type=taskList]>li>label]:shrink-0 [&_ul[data-type=taskList]>li>label]:select-none",
  "[&_ul[data-type=taskList]>li>div]:min-w-0 [&_ul[data-type=taskList]>li>div]:flex-1",
  "[&_li[data-checked=true]>div]:text-muted-foreground [&_li[data-checked=true]>div]:line-through",
  "[&_input[type=checkbox]]:size-4 [&_input[type=checkbox]]:cursor-pointer [&_input[type=checkbox]]:accent-[var(--send)]",
  // tables
  "[&_.tableWrapper]:my-5 [&_.tableWrapper]:overflow-x-auto [&_.tableWrapper]:pb-1",
  "[&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse",
  "[&_td]:relative [&_td]:border [&_td]:border-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_th]:relative [&_th]:border [&_th]:border-border [&_th]:bg-muted/60 [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:text-left [&_th]:align-top [&_th]:font-bold",
  "[&_td>p]:my-0 [&_th>p]:my-0 [&_td]:min-w-20 [&_th]:min-w-20",
  "[&_.selectedCell]:after:pointer-events-none [&_.selectedCell]:after:absolute [&_.selectedCell]:after:inset-0 [&_.selectedCell]:after:bg-link/12 [&_.selectedCell]:after:content-['']",
  "[&_.column-resize-handle]:pointer-events-none [&_.column-resize-handle]:absolute [&_.column-resize-handle]:top-0 [&_.column-resize-handle]:-right-0.5 [&_.column-resize-handle]:-bottom-px [&_.column-resize-handle]:w-1 [&_.column-resize-handle]:bg-link/60",
  "[&.resize-cursor]:cursor-col-resize",
  // images
  "[&_img]:my-4 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-lg [&_img]:border [&_img]:border-border [&_img.ProseMirror-selectednode]:ring-2 [&_img.ProseMirror-selectednode]:ring-link/50",
  // mentions
  "[&_.canvas-mention]:rounded [&_.canvas-mention]:bg-mention [&_.canvas-mention]:px-0.5 [&_.canvas-mention]:font-semibold [&_.canvas-mention]:text-mention-foreground [&_.canvas-mention]:[box-decoration-break:clone]",
  // placeholders (current empty block)
  "[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground/60 [&_.is-empty]:before:content-[attr(data-placeholder)]",
  "[&_.ProseMirror-selectednode]:rounded-sm [&_.ProseMirror-selectednode]:ring-2 [&_.ProseMirror-selectednode]:ring-link/40",
  "[&_.ProseMirror-gapcursor]:after:border-foreground",
].join(" ");

function randomId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export type CanvasVariant = "channel" | "page";

type ViewProps = {
  canvasId: string;
  variant: CanvasVariant;
  /** Read-only regardless of access (e.g. archived channel). */
  readOnly?: boolean;
  /** Template to apply once if the canvas opens empty (from "New canvas"). */
  templateId?: string | null;
  onTemplateApplied?: () => void;
  onDeleted?: () => void;
};

// ---- loading / errors ---------------------------------------------------------------------------

export function CanvasSkeleton({ withHeader = true }: { withHeader?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true" aria-label="Loading canvas">
      {withHeader && <div className="h-11 shrink-0 border-b" />}
      <div className="mx-auto w-full max-w-3xl animate-pulse px-4 py-8 sm:px-10 sm:py-10">
        <div className="mb-4 size-12 rounded-xl bg-muted" />
        <div className="mb-3 h-9 w-1/2 rounded-md bg-muted" />
        <div className="mb-8 h-3 w-40 rounded bg-muted" />
        {[92, 80, 86, 60].map((w) => (
          <div key={w} className="mb-3 h-3.5 rounded bg-muted" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

export function CanvasError({ title, message, onRetry, back }: { title: string; message: string; onRetry?: () => void; back?: React.ReactNode }) {
  return (
    <div role="alert" className="m-auto max-w-xs p-8 text-center">
      <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <CircleAlert className="size-7" aria-hidden />
      </div>
      <p className="font-bold">{title}</p>
      <p className="mt-0.5 mb-4 text-sm text-muted-foreground">{message}</p>
      <div className="flex justify-center gap-2">
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCcw /> Try again
          </Button>
        )}
        {back}
      </div>
    </div>
  );
}

/** Loads a canvas (metadata + legacy content) and opens a live session on it. */
export function CanvasView(props: ViewProps) {
  return <CanvasLoader key={props.canvasId} {...props} />;
}

function CanvasLoader(props: ViewProps) {
  const { workspaceId } = useWorkspace();
  const [detail, setDetail] = useState<CanvasDetail | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    canvasApi.get(props.canvasId).then(
      (d) => {
        if (!live) return;
        setDetail(d);
        setError(null);
      },
      (err) => {
        if (!live) return;
        setError({ status: err instanceof ApiError ? err.status : 0, message: errorMessage(err, "Couldn't load the canvas") });
      },
    );
    return () => {
      live = false;
    };
  }, [props.canvasId, attempt]);

  if (error && !detail) {
    const back =
      props.variant === "page" ? (
        <Link href={`/w/${workspaceId}/canvas`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          All canvases
        </Link>
      ) : null;
    if (error.status === 404)
      return <CanvasError title="Canvas not found" message="It may have been deleted, or the link is wrong." back={back} />;
    if (error.status === 403)
      return <CanvasError title="No access" message="This canvas is private. Ask its owner to share it with you." back={back} />;
    return (
      <CanvasError
        title="Couldn't load the canvas"
        message={error.message}
        back={back}
        onRetry={() => {
          setError(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  }
  if (!detail) return <CanvasSkeleton />;
  return <CanvasSession {...props} detail={detail} />;
}

// ---- live session -------------------------------------------------------------------------------

function CanvasSession(props: ViewProps & { detail: CanvasDetail }) {
  const { detail } = props;
  const ws = useWorkspace();
  const meId = ws.me?.id;
  const meName = ws.me?.full_name ?? "Someone";
  const [provider, setProvider] = useState<CanvasSyncProvider | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const providerRef = useRef<CanvasSyncProvider | null>(null);
  const sendRef = useRef(ws.sendRealtime);
  const connRef = useRef(ws.connection);

  useEffect(() => {
    sendRef.current = ws.sendRealtime;
    connRef.current = ws.connection;
  });

  useEffect(() => {
    if (!meId) return;
    let cancelled = false;
    const p = new CanvasSyncProvider({
      canvasId: detail.id,
      user: { id: meId, name: meName, color: caretColorFor(meId) },
      send: (frame) => sendRef.current(frame),
      onProblem: (message) => toast.error(message),
      onDenied: (message) => toast.error(message),
    });
    providerRef.current = p;
    if (connRef.current !== "open") p.setConnected(false);
    p.start().then(
      () => {
        if (cancelled) return;
        // First open since the Yjs migration: seed from the legacy JSON (idempotent across tabs).
        const seed = p.isEmpty() ? buildSeedUpdate(detail.legacy_content) : null;
        if (seed) p.applyLocal(seed);
        setProvider(p);
      },
      (err) => {
        if (cancelled) return;
        setError(errorMessage(err, "Couldn't open the live session"));
      },
    );
    return () => {
      cancelled = true;
      if (providerRef.current === p) providerRef.current = null;
      p.destroy();
    };
  }, [detail.id, detail.legacy_content, meId, meName, attempt]);

  useEffect(() => {
    providerRef.current?.setConnected(ws.connection === "open");
  }, [ws.connection, provider]);

  useWorkspaceEvents((e) => providerRef.current?.handleEvent(e));

  if (error && !provider)
    return (
      <CanvasError
        title="Couldn't open the canvas"
        message={error}
        onRetry={() => {
          setError("");
          setProvider(null);
          setAttempt((n) => n + 1);
        }}
      />
    );
  if (!provider) return <CanvasSkeleton />;
  return <CanvasEditor {...props} provider={provider} />;
}

// ---- editor -------------------------------------------------------------------------------------

type Rail = "comments" | "outline" | null;

type Handlers = {
  mentionCandidates: (q: string) => MentionCandidate[];
  slashContext: SlashContext;
  onFiles: (files: File[], pos: number | null) => void;
  onAnchorClick: (anchorId: string) => boolean;
  openLink: () => void;
  comment: () => void;
};

const NOOP_HANDLERS: Handlers = {
  mentionCandidates: () => [],
  slashContext: { pickImage: () => {} },
  onFiles: () => {},
  onAnchorClick: () => false,
  openLink: () => {},
  comment: () => {},
};

/** Mutable holder for the latest editor callbacks (updated after every render). */
class HandlerBox {
  private current: Handlers = NOOP_HANDLERS;
  get() {
    return this.current;
  }
  set(next: Handlers) {
    this.current = next;
  }
}

function CanvasEditor({
  detail,
  provider,
  variant,
  readOnly: forcedReadOnly,
  templateId,
  onTemplateApplied,
  onDeleted,
}: ViewProps & { detail: CanvasDetail; provider: CanvasSyncProvider }) {
  const ws = useWorkspace();
  const { workspaceId, me, members, memberById, channels, isAdmin } = ws;
  const sync = useSyncExternalStore(provider.subscribe, provider.getSnapshot, provider.getSnapshot);
  const [meta, setMeta] = useState<Canvas>(detail);
  const [title, setTitle] = useState(detail.title);
  const [rail, setRail] = useState<Rail>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [slashStore] = useState(() => new SuggestionStore<SlashItem>());
  const [mentionStore] = useState(() => new SuggestionStore<MentionCandidate>());
  const fileInput = useRef<HTMLInputElement>(null);
  const imagePos = useRef<number | null>(null);
  const titleTimer = useRef<number | undefined>(undefined);
  const savedMeta = useRef<Canvas>(detail);
  const titleFocused = useRef(false);
  const comments = useCanvasComments(detail.id);
  const now = useNow(30_000);

  const channel = meta.channel_id ? channels.find((c) => c.id === meta.channel_id) : undefined;
  const readOnly = !!forcedReadOnly || !!channel?.is_archived || sync.status === "denied";

  // Editor callbacks are bound once at creation; they read the latest handlers from this box.
  const [handlers] = useState(() => new HandlerBox());

  // Built once: every callback goes through `handlers`, so the editor never needs reconfiguring.
  const [editorOptions] = useState<UseEditorOptions & { immediatelyRender: false }>(() => (
    {
      immediatelyRender: false,
      editable: !readOnly,
      extensions: buildExtensions({
        slashStore,
        mentionStore,
        getMentionCandidates: (q) => handlers.get().mentionCandidates(q),
        getSlashContext: () => handlers.get().slashContext,
        onFiles: (files, pos) => handlers.get().onFiles(files, pos),
        collab: { provider, user: { id: me?.id ?? "", name: me?.full_name ?? "Someone", color: caretColorFor(me?.id ?? "") } },
      }),
      editorProps: {
        attributes: {
          class: PROSE,
          "aria-label": "Canvas content",
          "aria-multiline": "true",
          role: "textbox",
          spellcheck: "true",
        },
        handleKeyDown: (_view, event) => {
          const mod = event.metaKey || event.ctrlKey;
          if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
            event.preventDefault();
            handlers.get().openLink();
            return true;
          }
          if (mod && event.altKey && event.code === "KeyM") {
            event.preventDefault();
            handlers.get().comment();
            return true;
          }
          return false;
        },
        handleClick: (_view, _pos, event) => {
          const el = (event.target as HTMLElement | null)?.closest?.("[data-comment-id]");
          const id = el?.getAttribute("data-comment-id");
          if (id) handlers.get().onAnchorClick(id);
          return false;
        },
      },
    }
  ));
  const editor = useEditor(editorOptions, []);

  const stats = useDocStats(editor);

  // ---- metadata (title / emoji) -----------------------------------------------------------------

  const metaMap = provider.doc.getMap<string | null>("meta");

  // Live title/emoji from collaborators (mirrored into the Yjs doc so they update as they type).
  useEffect(() => {
    const onChange = (_e: unknown, tr: { origin: unknown }) => {
      if (tr.origin !== REMOTE_ORIGIN) return;
      const t = metaMap.get("title");
      if (typeof t === "string" && !titleFocused.current) setTitle(t);
      if (metaMap.has("emoji")) {
        const em = metaMap.get("emoji") ?? null;
        setMeta((m) => (m.emoji === em ? m : { ...m, emoji: em }));
      }
    };
    metaMap.observe(onChange);
    return () => metaMap.unobserve(onChange);
  }, [metaMap]);

  useEffect(() => () => window.clearTimeout(titleTimer.current), []);

  async function patchMeta(body: { title?: string; emoji?: string | null }) {
    try {
      const saved = await canvasApi.update(detail.id, body);
      savedMeta.current = saved;
      setMeta((m) => ({ ...m, ...saved }));
    } catch (err) {
      toast.error(errorMessage(err, body.title !== undefined ? "Couldn't rename the canvas" : "Couldn't change the icon"));
      const prev = savedMeta.current;
      if (body.title !== undefined) {
        setTitle(prev.title);
        metaMap.set("title", prev.title);
      }
      if (body.emoji !== undefined) {
        setMeta((m) => ({ ...m, emoji: prev.emoji }));
        metaMap.set("emoji", prev.emoji);
      }
    }
  }

  function changeTitle(value: string) {
    const v = value.slice(0, TITLE_MAX);
    setTitle(v);
    metaMap.set("title", v);
    window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => {
      const t = v.trim() || "Untitled";
      if (t !== savedMeta.current.title) void patchMeta({ title: t });
    }, TITLE_SAVE_MS);
  }

  function changeEmoji(emoji: string | null) {
    setMeta((m) => ({ ...m, emoji }));
    metaMap.set("emoji", emoji);
    void patchMeta({ emoji });
  }

  useWorkspaceEvents((raw) => {
    const e = asCanvasEvent(raw);
    if (e?.type !== "canvas.updated") return;
    const c = e.canvas;
    if (!c || (c.id ?? e.canvas_id) !== detail.id) return;
    savedMeta.current = { ...savedMeta.current, ...c } as Canvas;
    setMeta((m) => ({ ...m, ...c }) as Canvas);
    if (typeof c.title === "string" && !titleFocused.current) setTitle(c.title);
  });

  // ---- images -----------------------------------------------------------------------------------

  async function uploadImages(files: File[], pos: number | null) {
    if (!editor || readOnly) return;
    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        toast.error(`${file.name} isn't an image`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error(`${file.name} is larger than 25 MB`);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const att = await uploadFile(workspaceId, file);
        if (editor.isDestroyed) return;
        const node: JSONContent = { type: "image", attrs: { src: att.url, alt: file.name, attachmentId: att.id } };
        if (pos !== null) {
          const at = Math.min(pos, editor.state.doc.content.size);
          editor.chain().insertContentAt(at, node).run();
        } else {
          editor.chain().focus().insertContent(node).run();
        }
      } catch (err) {
        toast.error(errorMessage(err, `Couldn't upload ${file.name}`));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function pickImage(pos: number | null) {
    imagePos.current = pos;
    fileInput.current?.click();
  }

  // ---- comments ---------------------------------------------------------------------------------

  function startComment() {
    if (!editor || readOnly) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      toast.info("Select some text to comment on");
      return;
    }
    const quote = editor.state.doc.textBetween(from, to, " ", " ").replace(/\s+/g, " ").trim().slice(0, 500);
    if (draft) removeCommentAnchor(editor, draft.anchorId);
    const anchorId = randomId();
    editor.chain().setComment(anchorId).setTextSelection(to).run();
    setDraft({ anchorId, quote });
    setActiveThreadId(null);
    setRail("comments");
  }

  function cancelDraft() {
    if (draft && editor) removeCommentAnchor(editor, draft.anchorId);
    setDraft(null);
    editor?.commands.focus();
  }

  async function submitDraft(text: string) {
    if (!draft) return;
    const saved = await comments.add({ body: encodeMentions(text, members), anchor_id: draft.anchorId, quote: draft.quote });
    setDraft(null);
    setActiveThreadId(saved.id);
  }

  function jumpTo(anchorId: string | null) {
    if (!editor || !anchorId) return;
    const range = findCommentAnchor(editor, anchorId);
    if (!range) {
      toast.info("The text this comment was on has been removed");
      return;
    }
    const el = SAFE_ID.test(anchorId) ? editor.view.dom.querySelector(`[data-comment-id="${anchorId}"]`) : null;
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    try {
      editor.chain().focus(undefined, { scrollIntoView: !el }).setTextSelection(range.from).run();
    } catch {
      // Ignore positions invalidated by a concurrent edit.
    }
  }

  const commentsState: CommentsState = {
    ...comments,
    remove: async (c) => {
      await comments.remove(c);
      const isRoot = !c.thread_id || c.thread_id === c.id;
      if (isRoot && c.anchor_id && editor && !readOnly) removeCommentAnchor(editor, c.anchor_id);
      if (activeThreadId === c.id) setActiveThreadId(null);
    },
  };

  // ---- templates / export -----------------------------------------------------------------------

  function applyTemplate(t: CanvasTemplate) {
    if (!editor || readOnly) return;
    editor.chain().setContent(t.content).focus("start").run();
    if (DEFAULT_TITLES.has(title.trim().toLowerCase())) changeTitle(t.title);
    if (!meta.emoji) changeEmoji(t.emoji);
  }

  const templateDone = useRef(false);
  useEffect(() => {
    if (!editor || !templateId || templateDone.current) return;
    templateDone.current = true;
    const t = TEMPLATES.find((x) => x.id === templateId);
    if (t && editor.isEmpty && editor.isEditable) editor.chain().setContent(t.content).focus("start").run();
    onTemplateApplied?.();
  }, [editor, templateId, onTemplateApplied]);

  function markdown() {
    return editor ? toMarkdown(editor.getJSON(), title.trim() || "Untitled") : "";
  }

  async function deleteCanvas() {
    setDeleting(true);
    try {
      await canvasApi.remove(detail.id);
      toast.success("Canvas deleted");
      setConfirmDelete(false);
      onDeleted?.();
    } catch (err) {
      toast.error(errorMessage(err, "Couldn't delete the canvas"));
    } finally {
      setDeleting(false);
    }
  }

  // ---- wiring -----------------------------------------------------------------------------------

  useEffect(() => {
    handlers.set({
      mentionCandidates: (q) => {
        const term = q.trim().toLowerCase();
        return members
          .filter((m) => !m.is_bot && (!term || m.full_name.toLowerCase().includes(term) || m.email?.toLowerCase().startsWith(term)))
          .sort((a, b) => {
            const as = a.full_name.toLowerCase().startsWith(term) ? 0 : 1;
            const bs = b.full_name.toLowerCase().startsWith(term) ? 0 : 1;
            return as - bs || a.full_name.localeCompare(b.full_name);
          })
          .slice(0, 8)
          .map((m) => ({ id: m.user_id, label: m.full_name, detail: m.title || m.email || "" }));
      },
      slashContext: { pickImage: (pos) => pickImage(pos) },
      onFiles: (files, pos) => void uploadImages(files, pos),
      onAnchorClick: (anchorId) => {
        const t = comments.byAnchor[anchorId];
        if (!t) return false;
        setActiveThreadId(t.id);
        setRail("comments");
        return true;
      },
      openLink: () => setLinkOpen(true),
      comment: startComment,
    });
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Keep the caret label in sync with profile renames.
  useEffect(() => {
    if (!editor || !me) return;
    editor.commands.updateUser({ id: me.id, name: me.full_name, color: caretColorFor(me.id) });
  }, [editor, me]);

  // ---- render -----------------------------------------------------------------------------------

  const openThreads = comments.threads.filter((t) => !t.resolved);
  const activeAnchor = comments.threads.find((t) => t.id === activeThreadId)?.anchorId ?? null;
  const highlightCss = [
    ...openThreads
      .filter((t) => t.anchorId && SAFE_ID.test(t.anchorId))
      .map(
        (t) =>
          `[data-canvas-doc="${detail.id}"] [data-comment-id="${t.anchorId}"]{background-color:rgb(250 204 21 / .22);border-bottom:2px solid rgb(234 179 8 / .75);cursor:pointer;border-radius:2px}`,
      ),
    draft && SAFE_ID.test(draft.anchorId)
      ? `[data-canvas-doc="${detail.id}"] [data-comment-id="${draft.anchorId}"]{background-color:rgb(250 204 21 / .45);border-bottom:2px solid rgb(234 179 8)}`
      : "",
    activeAnchor && SAFE_ID.test(activeAnchor)
      ? `[data-canvas-doc="${detail.id}"] [data-comment-id="${activeAnchor}"]{background-color:rgb(250 204 21 / .45);border-bottom-color:rgb(234 179 8)}`
      : "",
  ].join("\n");

  const updatedBy = meta.updated_by
    ? meta.updated_by === me?.id
      ? "you"
      : (memberById[meta.updated_by]?.full_name ?? "someone")
    : null;
  const canDelete = variant === "page" && canDeleteCanvas(meta, me?.id, isAdmin);
  const AccessIcon = meta.is_channel_canvas ? Hash : meta.access === "private" ? Lock : Globe;
  const accessLabel = meta.is_channel_canvas
    ? channel
      ? `#${channel.name}`
      : "Channel canvas"
    : meta.access === "private"
      ? "Private"
      : "Workspace";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-background" data-canvas-doc={detail.id}>
      {/* Highlights for open comment threads (ids are validated against SAFE_ID). */}
      <style dangerouslySetInnerHTML={{ __html: highlightCss }} />

      {/* top bar */}
      <div className="z-10 flex min-h-11 shrink-0 items-center gap-2 border-b bg-background/95 px-2 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-3">
        {variant === "page" && (
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[13px]">
            <Link
              href={`/w/${workspaceId}/canvas`}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-1 font-semibold text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronLeft className="size-4" aria-hidden /> <span className="hidden sm:inline">Canvases</span>
            </Link>
            <span aria-hidden className="hidden text-muted-foreground/60 sm:inline">
              /
            </span>
            <span className="min-w-0 truncate font-semibold" aria-current="page">
              {meta.emoji ? `${meta.emoji} ` : ""}
              {title.trim() || "Untitled"}
            </span>
          </nav>
        )}
        <div className={cn("flex min-w-0 items-center gap-3", variant === "page" ? "ml-auto" : "")}>
          <LivePresence status={sync.status} peers={sync.peers} meName={me?.full_name ?? "You"} />
          {uploading > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Uploading…
            </span>
          )}
        </div>
        <div className={cn("flex shrink-0 items-center gap-0.5", variant === "channel" && "ml-auto")}>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={rail === "outline"}
            onClick={() => setRail((r) => (r === "outline" ? null : "outline"))}
            className="aria-pressed:bg-muted"
            title="Outline"
          >
            <ListTree /> <span className="sr-only sm:not-sr-only">Outline</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={rail === "comments"}
            onClick={() => setRail((r) => (r === "comments" ? null : "comments"))}
            className="aria-pressed:bg-muted"
            title="Comments"
          >
            <MessageSquare />
            <span className="sr-only sm:not-sr-only">Comments</span>
            {openThreads.length > 0 && (
              <span className="rounded-full bg-badge px-1.5 text-[10.5px] leading-4 font-bold text-badge-foreground">
                {openThreads.length}
              </span>
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShareOpen(true)} title="Share">
            <Share2 /> <span className="sr-only sm:not-sr-only">Share</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More canvas actions" />}>
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"} · {stats.chars.toLocaleString()} characters
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => downloadText(safeFilename(title || "Untitled"), markdown())}>
                <FileDown /> Export as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  void copyText(markdown()).then(
                    () => toast.success("Markdown copied"),
                    () => toast.error("Couldn't copy"),
                  )
                }
              >
                <Copy /> Copy as Markdown
              </DropdownMenuItem>
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmDelete(true)}>
                    <Trash2 /> Delete canvas
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {editor && !readOnly && (
        <div className="shrink-0 overflow-x-auto border-b px-2 py-1 [scrollbar-width:none] sm:px-3">
          <CanvasToolbar
            editor={editor}
            linkOpen={linkOpen}
            onLinkOpenChange={setLinkOpen}
            onImage={() => pickImage(null)}
            className="flex-nowrap"
          />
        </div>
      )}

      {sync.status === "denied" ? (
        <div role="alert" className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive sm:px-4">
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">{sync.problem || "Live sync stopped."} Changes are no longer saved.</span>
        </div>
      ) : readOnly ? (
        <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-[13px] text-muted-foreground sm:px-4">
          <Lock className="size-3.5 shrink-0" aria-hidden /> Read-only{channel?.is_archived ? " — this channel is archived" : ""}
        </div>
      ) : sync.status === "offline" ? (
        <div role="status" className="border-b border-amber-300/50 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900 sm:px-4 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          You&apos;re offline. Keep writing — your changes sync as soon as you reconnect.
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <article className="mx-auto w-full max-w-3xl px-4 pt-6 pb-10 sm:px-10 sm:pt-10">
            <div className="mb-3">
              <EmojiButton value={meta.emoji} onChange={changeEmoji} disabled={readOnly} />
            </div>
            <label htmlFor={`canvas-title-${detail.id}`} className="sr-only">
              Canvas title
            </label>
            <input
              id={`canvas-title-${detail.id}`}
              value={title}
              onChange={(e) => changeTitle(e.target.value)}
              onFocus={() => {
                titleFocused.current = true;
              }}
              onBlur={() => {
                titleFocused.current = false;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || (e.key === "ArrowDown" && !e.shiftKey)) {
                  e.preventDefault();
                  editor?.commands.focus("start");
                }
              }}
              readOnly={readOnly}
              maxLength={TITLE_MAX}
              placeholder="Untitled"
              className="w-full bg-transparent text-[1.75rem] leading-tight font-black tracking-tight outline-none placeholder:text-muted-foreground/50 sm:text-[2.25rem]"
            />
            <p className="mt-2 mb-6 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground sm:mb-8">
              <span className="inline-flex items-center gap-1">
                <AccessIcon className="size-3.5" aria-hidden /> {accessLabel}
              </span>
              {updatedBy && (
                <>
                  <span aria-hidden>·</span>
                  <span>
                    Edited by <span className="font-semibold text-foreground/80">{updatedBy}</span>{" "}
                    <time dateTime={meta.updated_at} title={new Date(meta.updated_at).toLocaleString()}>
                      {timeAgo(meta.updated_at, now)}
                    </time>
                  </span>
                </>
              )}
              <span aria-hidden>·</span>
              <span>
                {stats.words.toLocaleString()} {stats.words === 1 ? "word" : "words"}
              </span>
            </p>

            {editor ? (
              <div
                ref={resignExpiredImages}
                className={cn(stats.empty && !readOnly && "[&_.ProseMirror]:min-h-0 [&_.ProseMirror]:pb-6")}
              >
                <EditorContent editor={editor} />
              </div>
            ) : (
              <div className="min-h-[45vh]" />
            )}

            {editor && stats.empty && !readOnly && <TemplatePicker onPick={applyTemplate} />}
          </article>
        </div>

        {rail === "outline" && editor && (
          <aside className="absolute inset-0 z-20 flex flex-col bg-background sm:static sm:w-64 sm:shrink-0 sm:border-l lg:w-72">
            <div className="flex h-11 shrink-0 items-center justify-between border-b px-3 sm:hidden">
              <span className="text-sm font-bold">Outline</span>
              <Button variant="ghost" size="sm" onClick={() => setRail(null)}>
                Done
              </Button>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto p-3"
              onClick={(e) => {
                // On phones the outline covers the doc: close it after jumping.
                if ((e.target as HTMLElement).closest("button") && window.matchMedia("(max-width: 639px)").matches) setRail(null);
              }}
            >
              <Outline editor={editor} headings={stats.headings} />
            </div>
          </aside>
        )}
        {rail === "comments" && (
          <CommentsPanel
            className="absolute inset-0 z-20 bg-background sm:static sm:w-[340px] sm:shrink-0 sm:border-l sm:bg-muted/20"
            state={commentsState}
            draft={draft}
            activeThreadId={activeThreadId}
            onActivate={(id) => {
              setActiveThreadId(id);
              const anchor = comments.threads.find((t) => t.id === id)?.anchorId ?? null;
              if (anchor) jumpTo(anchor);
            }}
            onJump={(t) => {
              setActiveThreadId(t.id);
              jumpTo(t.anchorId);
            }}
            onSubmitDraft={submitDraft}
            onCancelDraft={cancelDraft}
            onClose={() => {
              if (draft) cancelDraft();
              setRail(null);
              setActiveThreadId(null);
            }}
            readOnly={readOnly}
          />
        )}
      </div>

      {editor && <TextBubbleMenu editor={editor} onComment={startComment} canComment={!readOnly} />}
      {editor && !readOnly && <TableBubbleMenu editor={editor} />}
      <SlashMenu store={slashStore} />
      <MentionMenu store={mentionStore} />

      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void uploadImages(files, imagePos.current);
          imagePos.current = null;
        }}
      />

      <ShareDialog
        canvas={meta}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onSaved={(c) => {
          savedMeta.current = c;
          setMeta(c);
        }}
      />

      <Dialog open={confirmDelete} onOpenChange={(o) => !deleting && setConfirmDelete(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-lg font-black">Delete this canvas?</DialogTitle>
            <DialogDescription>
              “{title.trim() || "Untitled"}” and its comments will be permanently deleted for everyone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteCanvas()} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin" />} Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TemplatePicker({ onPick }: { onPick: (t: CanvasTemplate) => void }) {
  return (
    <section aria-labelledby="canvas-empty-heading" className="mb-10 rounded-xl border border-dashed bg-muted/30 p-4 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-mention text-mention-foreground">
          <NotebookPen className="size-4.5" aria-hidden />
        </span>
        <div>
          <h2 id="canvas-empty-heading" className="font-bold">
            Start with a template
          </h2>
          <p className="text-sm text-muted-foreground">
            Or just start typing above — press <kbd className="rounded border bg-background px-1 font-mono text-[11px]">/</kbd> for blocks and{" "}
            <kbd className="rounded border bg-background px-1 font-mono text-[11px]">@</kbd> to mention someone.
          </p>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t)}
            className="group flex items-start gap-2.5 rounded-lg border bg-background p-3 text-left transition-shadow hover:border-link/40 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <span className="text-xl leading-none" aria-hidden>
              {t.emoji}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold group-hover:text-link">{t.name}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{t.description}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** Small helper for list pages: the canvas icon (emoji or a doc glyph). */
export function CanvasGlyph({ emoji, className }: { emoji: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg bg-muted text-lg leading-none", className)} aria-hidden>
      {emoji ?? <FileText className="size-[45%] text-muted-foreground" />}
    </span>
  );
}

export type { Editor };
