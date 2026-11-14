"use client";

import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Check, CircleAlert, CloudOff, Info, Loader2, Lock, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { deepEqual, normalizeDoc, timeAgo, useNow } from "@/components/canvas/doc-utils";
import { isNetworkError } from "@/components/canvas/canvas-api";
import { CanvasToolbar } from "@/components/canvas/toolbar";
import { SummarizeCallButton } from "@/components/ai/call-transcript";
import { useWorkspace, useWorkspaceEvents } from "@/components/workspace/provider";
import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { fetchCallNotes, saveCallNotes } from "./call-api";
import type { CallNotes, CallNotesUpdatedEvent } from "./types";

const SAVE_DEBOUNCE_MS = 700;
const OFFLINE_RETRY_MS = 5_000;
const ERROR_RETRY_MS = 15_000;

type Status = "saved" | "unsaved" | "saving" | "offline" | "error" | "conflict" | "readonly";

const PROSE = [
  "min-h-[40vh] px-4 pt-3 pb-16 text-[14px] leading-6 text-foreground outline-none [overflow-wrap:anywhere] caret-link",
  "[&>*:first-child]:mt-0 [&_p]:my-1.5",
  "[&_h1]:mt-5 [&_h1]:mb-1.5 [&_h1]:text-lg [&_h1]:leading-snug [&_h1]:font-extrabold [&_h1]:tracking-tight",
  "[&_h2]:mt-4 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-bold",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-[14px] [&_h3]:font-bold",
  "[&_strong]:font-bold [&_em]:italic [&_s]:text-muted-foreground",
  "[&_a]:text-link [&_a]:underline [&_a]:decoration-link/40 [&_a]:underline-offset-2",
  "[&_mark]:rounded-[3px] [&_mark]:bg-amber-200/80 [&_mark]:px-0.5 [&_mark]:text-inherit dark:[&_mark]:bg-amber-400/30",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em]",
  "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-zinc-950 [&_pre]:px-3 [&_pre]:py-2 [&_pre]:text-[12px] [&_pre]:text-zinc-100 [&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-link/50 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_hr]:my-4 [&_hr]:border-border",
  "[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_li>p]:my-0",
  "[&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0.5",
  "[&_ul[data-type=taskList]>li]:flex [&_ul[data-type=taskList]>li]:items-start [&_ul[data-type=taskList]>li]:gap-2",
  "[&_ul[data-type=taskList]>li>label]:mt-[0.2rem] [&_ul[data-type=taskList]>li>label]:shrink-0 [&_ul[data-type=taskList]>li>div]:min-w-0 [&_ul[data-type=taskList]>li>div]:flex-1",
  "[&_li[data-checked=true]>div]:text-muted-foreground [&_li[data-checked=true]>div]:line-through",
  "[&_input[type=checkbox]]:size-4 [&_input[type=checkbox]]:cursor-pointer [&_input[type=checkbox]]:accent-[var(--send)]",
  "[&_.is-editor-empty:first-child]:before:pointer-events-none [&_.is-editor-empty:first-child]:before:float-left [&_.is-editor-empty:first-child]:before:h-0 [&_.is-editor-empty:first-child]:before:text-muted-foreground/70 [&_.is-editor-empty:first-child]:before:content-[attr(data-placeholder)]",
].join(" ");

/** Shared call notes. Remounts per call. */
export function NotesPanel({
  callId,
  ended,
  onSummaryRequested,
}: {
  callId: string;
  ended: boolean;
  /** Shows the AI summary (Transcript tab) after "✨ Summarize call" is pressed here. */
  onSummaryRequested?: () => void;
}) {
  return <NotesLoader key={callId} callId={callId} ended={ended} onSummaryRequested={onSummaryRequested} />;
}

function NotesLoader({ callId, ended, onSummaryRequested }: { callId: string; ended: boolean; onSummaryRequested?: () => void }) {
  const [notes, setNotes] = useState<CallNotes | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetchCallNotes(callId)
      .then((n) => {
        if (!live) return;
        setNotes(n);
        setError("");
      })
      .catch((err) => live && setError(errorMessage(err, "Couldn't load the notes")));
    return () => {
      live = false;
    };
  }, [callId, attempt]);

  if (error && !notes)
    return (
      <div className="m-auto max-w-xs p-6 text-center">
        <CircleAlert className="mx-auto mb-2 size-7 text-muted-foreground" aria-hidden />
        <p className="text-sm font-bold">Couldn&apos;t load the notes</p>
        <p className="mb-3 text-xs text-muted-foreground">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError("");
            setAttempt((n) => n + 1);
          }}
          className="rounded-md border px-3 py-1.5 text-sm font-bold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          Try again
        </button>
      </div>
    );
  if (!notes)
    return (
      <div className="animate-pulse space-y-3 p-4" aria-busy="true" aria-label="Loading notes">
        <div className="h-8 rounded-md bg-muted" />
        {[90, 75, 82, 50].map((w) => (
          <div key={w} className="h-3 rounded bg-muted" style={{ width: `${w}%` }} />
        ))}
      </div>
    );
  return <NotesEditor callId={callId} initial={notes} ended={ended} onSummaryRequested={onSummaryRequested} />;
}

type Machine = {
  version: number;
  editSeq: number;
  savedSeq: number;
  inflight: boolean;
  pendingRemote: CallNotes | null;
  conflict: boolean;
  locked: boolean;
  timer: number | undefined;
};

function NotesEditor({
  callId,
  initial,
  ended,
  onSummaryRequested,
}: {
  callId: string;
  initial: CallNotes;
  ended: boolean;
  onSummaryRequested?: () => void;
}) {
  const { me, memberById } = useWorkspace();
  const [server, setServer] = useState<CallNotes>(initial);
  const serverRef = useRef<CallNotes>(initial);
  useEffect(() => {
    serverRef.current = server;
  }, [server]);
  const [status, setStatus] = useState<Status>("saved");
  const [errorText, setErrorText] = useState("");
  const [conflict, setConflict] = useState<CallNotes | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const now = useNow(30_000);
  const readOnly = ended || forbidden;

  const m = useRef<Machine>({
    version: initial.version,
    editSeq: 0,
    savedSeq: 0,
    inflight: false,
    pendingRemote: null,
    conflict: false,
    locked: ended,
    timer: undefined,
  });
  const handlers = useRef({ onLocalEdit: () => {}, openLink: () => {} });

  const editor = useEditor({
    immediatelyRender: false,
    editable: !ended,
    extensions: [
      StarterKit.configure({ link: false, heading: { levels: [1, 2, 3] } }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      Highlight.configure({ multicolor: false }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Agenda, decisions, action items… type [] for a checklist" }),
    ],
    content: normalizeDoc(initial.content),
    editorProps: {
      attributes: {
        class: PROSE,
        "aria-label": "Call notes",
        "aria-multiline": "true",
        role: "textbox",
        spellcheck: "true",
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
          event.preventDefault();
          handlers.current.openLink();
          return true;
        }
        return false;
      },
    },
    onUpdate: () => handlers.current.onLocalEdit(),
  });

  // ---- save machine (same shape as the channel canvas) ----

  function schedule(ms: number) {
    const st = m.current;
    window.clearTimeout(st.timer);
    st.timer = window.setTimeout(() => void save(), ms);
  }

  function hasUnsaved() {
    return m.current.editSeq !== m.current.savedSeq;
  }

  function onLocalEdit() {
    const st = m.current;
    if (st.locked) return;
    st.editSeq++;
    if (st.conflict) return;
    setStatus("unsaved");
    schedule(SAVE_DEBOUNCE_MS);
  }

  function draft() {
    return editor?.getJSON() ?? normalizeDoc(null);
  }

  async function save(force = false) {
    const st = m.current;
    window.clearTimeout(st.timer);
    if (!editor || st.locked || st.inflight) return;
    if (!force && (st.conflict || !hasUnsaved())) return;
    const seq = st.editSeq;
    const content = draft();
    if (!force && deepEqual(normalizeDoc(content), normalizeDoc(serverRef.current.content))) {
      st.savedSeq = seq;
      setStatus("saved");
      return;
    }
    st.inflight = true;
    setStatus("saving");
    let next: Status | null = null;
    try {
      const res = await saveCallNotes(callId, { content, base_version: st.version });
      if (res.kind === "saved" || deepEqual(normalizeDoc(res.notes.content), normalizeDoc(content))) {
        st.version = Math.max(st.version, res.notes.version);
        st.savedSeq = seq;
        setServer(res.notes);
        setErrorText("");
      } else {
        st.conflict = true;
        setConflict(res.notes);
        next = "conflict";
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 403 || err.status === 404 || err.status === 410)) {
        st.locked = true;
        editor.setEditable(false);
        setForbidden(true);
        next = "readonly";
      } else if (isNetworkError(err)) {
        next = "offline";
        st.timer = window.setTimeout(() => void save(), OFFLINE_RETRY_MS);
      } else {
        next = "error";
        setErrorText(errorMessage(err, "Couldn't save"));
        if (!(err instanceof ApiError && err.status === 413)) st.timer = window.setTimeout(() => void save(), ERROR_RETRY_MS);
      }
    } finally {
      st.inflight = false;
    }

    const remote = st.pendingRemote;
    st.pendingRemote = null;
    if (remote) onRemote(remote);
    if (next) {
      setStatus(next);
      return;
    }
    if (st.conflict) return;
    if (hasUnsaved()) {
      setStatus("unsaved");
      schedule(SAVE_DEBOUNCE_MS);
    } else setStatus("saved");
  }

  function adopt(remote: CallNotes) {
    const st = m.current;
    st.version = remote.version;
    st.savedSeq = st.editSeq;
    st.conflict = false;
    st.pendingRemote = null;
    window.clearTimeout(st.timer);
    setServer(remote);
    setConflict(null);
    setStatus("saved");
    if (!editor) return;
    const { from, to } = editor.state.selection;
    editor.commands.setContent(normalizeDoc(remote.content), { emitUpdate: false });
    const max = editor.state.doc.content.size;
    try {
      editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) });
    } catch {
      // ignore: selection fell outside the new doc
    }
  }

  function onRemote(remote: CallNotes) {
    const st = m.current;
    if (remote.version <= st.version) return;
    if (st.inflight) {
      if (!st.pendingRemote || remote.version > st.pendingRemote.version) st.pendingRemote = remote;
      return;
    }
    if ((!st.conflict && !hasUnsaved()) || deepEqual(normalizeDoc(remote.content), normalizeDoc(draft()))) {
      adopt(remote);
      return;
    }
    st.conflict = true;
    window.clearTimeout(st.timer);
    setConflict(remote);
    setStatus("conflict");
  }

  function keepMine() {
    const st = m.current;
    if (!conflict) return;
    st.version = Math.max(st.version, conflict.version);
    st.conflict = false;
    setConflict(null);
    void save(true);
  }

  useEffect(() => {
    handlers.current = { onLocalEdit, openLink: () => setLinkOpen(true) };
  });

  useEffect(() => {
    m.current.locked = readOnly;
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useWorkspaceEvents((raw) => {
    const e = raw as unknown as CallNotesUpdatedEvent | { type: string };
    if (e.type === "call.notes_updated") {
      const ev = e as CallNotesUpdatedEvent;
      if (ev.call_id === callId && ev.notes) onRemote(ev.notes);
    } else if (e.type === "resync") {
      fetchCallNotes(callId).then(onRemote, () => {});
      if (hasUnsaved() && !m.current.conflict) schedule(0);
    }
  });

  // Flush when going offline→online or the tab hides.
  useEffect(() => {
    const flush = () => {
      if (hasUnsaved() && !m.current.conflict) void save();
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  });

  // Unmount (tab switch, minimise, leaving the call) with pending edits: one last keepalive save.
  useEffect(() => {
    const st = m.current;
    return () => {
      window.clearTimeout(st.timer);
      if (st.locked || st.conflict || st.inflight || st.editSeq === st.savedSeq || !editor) return;
      try {
        const content = editor.getJSON();
        if (deepEqual(normalizeDoc(content), normalizeDoc(serverRef.current.content))) return;
        void saveCallNotes(callId, { content, base_version: st.version }, { keepalive: true }).catch(() => {});
      } catch {
        // editor already destroyed
      }
    };
  }, [editor, callId]);

  const shown: Status = readOnly ? "readonly" : status;
  const editorName =
    server.updated_by && server.updated_by === me?.id
      ? "you"
      : server.updated_by
        ? (memberById[server.updated_by]?.full_name ?? "Someone")
        : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {editor && !readOnly && (
        <div className="border-b px-2 py-1">
          <CanvasToolbar
            editor={editor}
            linkOpen={linkOpen}
            onLinkOpenChange={setLinkOpen}
            className="flex-nowrap overflow-x-auto [scrollbar-width:none] [&>[role=group]]:shrink-0"
          />
        </div>
      )}

      {conflict && (
        <div
          role="alert"
          className="flex flex-col gap-2 border-b border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <p className="flex items-start gap-2">
            <TriangleAlert className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span>
              <span className="font-bold">Someone else edited these notes.</span> Your latest changes aren&apos;t saved yet.
            </span>
          </p>
          <div className="flex gap-2 pl-5">
            <button
              type="button"
              onClick={() => adopt(conflict)}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/70 bg-white/70 px-2 py-1 font-bold outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-amber-500/60 dark:bg-transparent dark:hover:bg-amber-400/10"
            >
              <RefreshCw className="size-3" aria-hidden /> Use theirs
            </button>
            <button
              type="button"
              onClick={keepMine}
              className="rounded-md bg-amber-600 px-2 py-1 font-bold text-white outline-none hover:bg-amber-700 focus-visible:ring-2 focus-visible:ring-amber-500/60"
            >
              Keep mine
            </button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>

      <div className="flex flex-col gap-1 border-t bg-muted/30 px-3 py-2 text-[11.5px] text-muted-foreground">
        <div className="flex items-center gap-2">
          <NotesStatus status={shown} error={errorText} onRetry={() => void save(true)} />
          {server.version > 0 && editorName && server.updated_at && (
            <span className="ml-auto truncate">
              Edited by <span className="font-semibold text-foreground/80">{editorName}</span> · {timeAgo(server.updated_at, now)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p className="flex min-w-0 flex-1 items-center gap-1.5">
            <Info className="size-3 shrink-0" aria-hidden />
            {ended ? "The call has ended. Notes were posted to the call thread." : "Notes will be posted to the thread when the call ends."}
          </p>
          {onSummaryRequested && ended && <SummarizeCallButton callId={callId} onRequested={onSummaryRequested} className="h-7 px-2.5" />}
        </div>
      </div>
    </div>
  );
}

function NotesStatus({ status, error, onRetry }: { status: Status; error: string; onRetry: () => void }) {
  const base = "inline-flex items-center gap-1 font-medium";
  switch (status) {
    case "saving":
      return (
        <span className={base} role="status">
          <Loader2 className="size-3 animate-spin" aria-hidden /> Saving…
        </span>
      );
    case "unsaved":
      return <span className={base}>Editing…</span>;
    case "offline":
      return (
        <span className={cn(base, "text-amber-700 dark:text-amber-300")} role="status">
          <CloudOff className="size-3" aria-hidden /> Offline, will retry
        </span>
      );
    case "error":
      return (
        <button type="button" onClick={onRetry} className={cn(base, "rounded text-destructive underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60")} title={error}>
          <CircleAlert className="size-3" aria-hidden /> Not saved, retry
        </button>
      );
    case "conflict":
      return (
        <span className={cn(base, "text-amber-700 dark:text-amber-300")}>
          <TriangleAlert className="size-3" aria-hidden /> Conflict
        </span>
      );
    case "readonly":
      return (
        <span className={base}>
          <Lock className="size-3" aria-hidden /> Read only
        </span>
      );
    default:
      return (
        <span className={cn(base, "text-emerald-700 dark:text-emerald-400")}>
          <Check className="size-3" aria-hidden /> Saved
        </span>
      );
  }
}
