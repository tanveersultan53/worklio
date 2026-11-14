/**
 * Worklio AI client: workspace AI status (provider, model, features, policy, agent installs),
 * the SSE stream reader and typed calls for every AI endpoint.
 *
 * Streaming endpoints answer `text/event-stream` where each event is `data: <json>\n\n` (see
 * `AIStreamEvent`). They are POSTs that need the bearer token, so they are read with
 * fetch + ReadableStream rather than EventSource.
 *
 * Status comes from GET /workspaces/{id}/ai/status, cached per workspace and refreshed when the
 * window regains focus and when the AI settings page dispatches `AI_SETTINGS_CHANGED_EVENT`.
 */
import { useParams } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { useOptionalWorkspace } from "@/components/workspace/provider";
import { API_URL, ApiError, api, freshToken } from "@/lib/api";
import { toast } from "@/lib/toast";

// --- Types ---------------------------------------------------------------------------------

export type AIProvider = "anthropic" | "gemini" | "deepseek";

/** Per-feature toggles an admin can switch off in Settings → AI. */
export const AI_FEATURES = ["ask", "summaries", "composer", "translate", "tasks", "agent", "captions_summary"] as const;
export type AIFeature = (typeof AI_FEATURES)[number];
export type AIFeatures = Record<AIFeature, boolean>;

export type AIStatus = {
  /** A provider and key are configured (workspace key, or the server's env Anthropic key). */
  enabled: boolean;
  provider: AIProvider | null;
  model: string;
  features: AIFeatures;
  /** I'm an owner/admin and can change AI settings. */
  can_configure: boolean;
  /** The use_ai policy lets me use AI ("admins" blocks members). */
  can_use: boolean;
  agent_installed_channel_ids: string[];
  agent_installed_everywhere: boolean;
  /** The server reported agent installs (false on the legacy env-only endpoint: assume installed). */
  installs_known: boolean;
  /** null when this came from the legacy GET /ai/status. */
  workspace_id: string | null;
};

export type AICitation = {
  n: number;
  message_id: string;
  channel_id: string;
  parent_id: string | null;
  author_id: string;
  snippet: string;
  created_at: string;
};

export type AIErrorCode = "ai_not_configured" | "rate_limited" | "refusal" | "failed" | "policy" | "feature_disabled";

export type AIUsage = Record<string, unknown>;

export type AIStreamEvent =
  | { type: "status"; text: string }
  | { type: "text"; delta: string }
  | { type: "citations"; items: AICitation[] }
  | { type: "done"; conversation_id?: string; usage?: AIUsage }
  | { type: "error"; code: AIErrorCode; message: string };

export type SummaryRange = "unread" | "24h" | "7d" | "all";

export type ComposeAction = "improve" | "shorter" | "longer" | "friendlier" | "formal" | "fix" | "translate" | "bullets";

export type AIConversation = { id: string; title: string; created_at: string; updated_at: string };

export type AITurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  citations: AICitation[];
  created_at: string | null;
};

export type AIConversationDetail = AIConversation & { turns: AITurn[] };

export type ExtractedTask = {
  title: string;
  assignee_id: string | null;
  /** "YYYY-MM-DD" */
  due_date: string | null;
  source_message_id: string | null;
};

// --- Settings links & events -----------------------------------------------------------------

/** Dispatched on window by the AI settings page after saving: `{detail: {workspaceId}}` (optional). */
export const AI_SETTINGS_CHANGED_EVENT = "worklio:ai-settings-changed";

/** Where admins configure Worklio AI. */
export const aiSettingsHref = (workspaceId: string) => `/w/${workspaceId}/settings?tab=ai`;

/** Kept for older imports: how AI gets turned on now. */
export const AI_SETUP_HINT = "A workspace admin can turn it on in Settings → Worklio AI.";

// --- Provider labels -------------------------------------------------------------------------

const PROVIDER_NAME: Record<AIProvider, string> = { anthropic: "Anthropic", gemini: "Google", deepseek: "DeepSeek" };

/** "claude-opus-5-5" → "Claude Opus 5.5", "models/gemini-2.5-pro" → "Gemini 2.5 Pro", "deepseek-chat" → "DeepSeek Chat". */
export function prettyModel(model: string | null | undefined): string {
  if (!model) return "";
  const id = model.replace(/^models\//, "").trim();
  const parts = id.split(/[-_\s]+/).filter((p) => p && !/^\d{8}$/.test(p) && p !== "latest");
  const out: string[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    // Join version digits: "5", "5" → "5.5" (but not after a word that already carries a dot).
    if (/^\d+$/.test(p) && prev && /^\d+(\.\d+)?$/.test(prev) && !prev.includes(".")) out[out.length - 1] = `${prev}.${p}`;
    else if (/^deepseek$/i.test(p)) out.push("DeepSeek");
    else if (/^[a-z]/.test(p)) out.push(p[0].toUpperCase() + p.slice(1));
    else out.push(p);
  }
  return out.join(" ");
}

/** Provider name for the chip ("Anthropic", "Google", "DeepSeek"). */
export const providerName = (p: AIProvider | null | undefined) => (p ? PROVIDER_NAME[p] : "");

/** "Claude Opus 5.5 · Anthropic" / "Gemini 2.5 Pro · Google" / "DeepSeek Chat". */
export function aiModelLabel(status: Pick<AIStatus, "provider" | "model"> | null | undefined): string {
  if (!status) return "";
  const model = prettyModel(status.model);
  switch (status.provider) {
    case "anthropic":
      return `${model || "Claude"} · Anthropic`;
    case "gemini":
      return `${model || "Gemini"} · Google`;
    case "deepseek":
      return model && model.toLowerCase().startsWith("deepseek") ? model : model ? `${model} · DeepSeek` : "DeepSeek";
    default:
      return model;
  }
}

// --- Gates -----------------------------------------------------------------------------------

/** Why AI is unavailable for me right now; null when it's ready (or still loading). */
export type AIGateReason = "not_configured" | "policy" | "feature_off";

export function aiGateReason(status: AIStatus | null, feature?: AIFeature): AIGateReason | null {
  if (!status) return null;
  if (!status.enabled) return "not_configured";
  if (!status.can_use) return "policy";
  if (feature && !status.features[feature]) return "feature_off";
  return null;
}

/** Copy for a gate: a title, a one-line explanation and whether to offer the settings link. */
export function aiGateCopy(reason: AIGateReason, canConfigure: boolean): { title: string; body: string; cta: boolean } {
  switch (reason) {
    case "policy":
      return {
        title: "Worklio AI is limited to admins",
        body: "Only admins can use Worklio AI in this workspace.",
        cta: false,
      };
    case "feature_off":
      return canConfigure
        ? { title: "This feature is turned off", body: "This feature is turned off for the workspace. You can turn it back on in AI settings.", cta: true }
        : { title: "This feature is turned off", body: "This feature is turned off by your admin.", cta: false };
    default:
      return canConfigure
        ? {
            title: "Set up Worklio AI",
            body: "Connect Anthropic, Google Gemini or DeepSeek with an API key to turn on Ask, summaries, catch-up, writing help and the @worklio agent.",
            cta: true,
          }
        : {
            title: "Worklio AI isn't turned on",
            body: "Ask a workspace admin to turn on Worklio AI.",
            cta: false,
          };
  }
}

/** One-line message for toasts and tooltips. */
export function aiGateMessage(reason: AIGateReason, canConfigure: boolean): string {
  if (reason === "not_configured") return canConfigure ? "Worklio AI isn't set up yet. Set it up in Settings → Worklio AI." : "Ask a workspace admin to turn on Worklio AI.";
  return aiGateCopy(reason, canConfigure).body;
}

// --- Errors --------------------------------------------------------------------------------

const POLICY_MESSAGES: Record<string, string> = {
  use_ai: "Only admins can use Worklio AI in this workspace.",
  install_apps: "Only admins can add apps like Worklio AI in this workspace.",
};

const DEFAULT_MESSAGES: Record<AIErrorCode, string> = {
  ai_not_configured: "Worklio AI isn't set up for this workspace yet.",
  rate_limited: "You're using Worklio AI a lot right now. Give it a few minutes and try again.",
  refusal: "Worklio AI can't help with that request.",
  failed: "Worklio AI ran into a problem. Please try again.",
  policy: POLICY_MESSAGES.use_ai,
  feature_disabled: "This feature is turned off by your admin.",
};

export class AIError extends Error {
  constructor(public code: AIErrorCode, message?: string, public status = 0) {
    super(message || DEFAULT_MESSAGES[code]);
  }
}

/** Is this 403 detail a policy or feature gate? Returns the code and readable message. */
function gateFromDetail(detail: string): { code: "policy" | "feature_disabled"; message: string } | null {
  if (detail.startsWith("policy:")) {
    const name = detail.slice(7);
    return { code: "policy", message: POLICY_MESSAGES[name] ?? "Only admins can do that in this workspace." };
  }
  if (detail === "ai_feature_disabled" || detail.startsWith("ai_feature_disabled")) {
    return { code: "feature_disabled", message: DEFAULT_MESSAGES.feature_disabled };
  }
  return null;
}

/** A policy/feature 403: toast it once and re-check every cached status (the admin changed something). */
function onGateError(message: string) {
  toast.error(message);
  refreshAllAIStatus();
}

function errorFromResponse(status: number, body: Record<string, unknown>, quiet = false): AIError {
  const detail = typeof body.detail === "string" ? body.detail : "";
  if (status === 503 && (detail === "ai_not_configured" || !detail)) {
    markDisabled();
    return new AIError("ai_not_configured", undefined, status);
  }
  if (detail === "ai_not_configured") {
    markDisabled();
    return new AIError("ai_not_configured", undefined, status);
  }
  if (status === 429) return new AIError("rate_limited", undefined, status);
  if (detail === "refusal") return new AIError("refusal", undefined, status);
  if (status === 401) return new AIError("failed", "Your session expired. Sign in again.", status);
  if (status === 403) {
    const gate = gateFromDetail(detail);
    if (gate) {
      if (gate.code === "policy" && detail === "policy:use_ai") markPolicyBlocked();
      if (!quiet) onGateError(gate.message);
      return new AIError(gate.code, gate.message, status);
    }
    return new AIError("failed", detail || "You don't have access to that conversation.", status);
  }
  if (status === 404) return new AIError("failed", detail && detail !== "Not Found" ? detail : "That message or conversation no longer exists.", status);
  return new AIError("failed", detail && !/^[a-z_:]+$/.test(detail) ? detail : undefined, status);
}

/**
 * Readable message for anything an AI call throws. Also handles ApiErrors from plain `api()`
 * calls to AI endpoints (a policy/feature 403 toasts here unless `quiet`).
 */
export function aiErrorMessage(err: unknown, quiet = true): string {
  if (err instanceof AIError) return err.message;
  if (err instanceof ApiError) return errorFromResponse(err.status, err.body, quiet).message;
  if (err instanceof Error && err.message) return err.message;
  return DEFAULT_MESSAGES.failed;
}

/** The AIErrorCode for anything an AI call throws (ApiErrors from plain `api()` included). */
export function aiErrorCode(err: unknown): AIErrorCode {
  if (err instanceof AIError) return err.code;
  if (err instanceof ApiError) return errorFromResponse(err.status, err.body, true).code;
  return "failed";
}

/**
 * For AI calls made with plain `api()`: convert an ApiError to an AIError, toasting
 * policy/feature 403s and updating the cached status. Use in `.catch()`.
 */
export function toAIError(err: unknown): AIError {
  if (err instanceof AIError) return err;
  if (err instanceof ApiError) return errorFromResponse(err.status, err.body);
  return new AIError("failed", err instanceof Error && err.message ? err.message : undefined);
}

/** Default user-facing text for an error event (the server's own message wins when present). */
export function aiEventMessage(e: { code: AIErrorCode; message?: string }): string {
  if (e.code === "ai_not_configured") return DEFAULT_MESSAGES.ai_not_configured;
  if (e.code === "policy" || e.code === "feature_disabled") return e.message && !/^[a-z_:]+$/.test(e.message) ? e.message : DEFAULT_MESSAGES[e.code];
  return e.message || DEFAULT_MESSAGES[e.code] || DEFAULT_MESSAGES.failed;
}

/** Is this an error the gate UI (AIDisabledState) should render instead of a retryable note? */
export const isGateError = (code: AIErrorCode | null | undefined) =>
  code === "ai_not_configured" || code === "policy" || code === "feature_disabled";

/** api() wrapper that turns HTTP failures into AIError. */
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await api<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError) throw errorFromResponse(err.status, err.body);
    throw new AIError("failed", "Couldn't reach Worklio AI. Check your connection.");
  }
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body ?? {}) });

// --- Status (cached per workspace, shared) ----------------------------------------------------

type Loose = Record<string, unknown>;
type StatusEntry = { status: AIStatus | null; loaded: boolean };

const EMPTY_ENTRY: StatusEntry = { status: null, loaded: false };
const ALL_ON: AIFeatures = { ask: true, summaries: true, composer: true, translate: true, tasks: true, agent: true, captions_summary: true };
const ALL_OFF: AIFeatures = { ask: false, summaries: false, composer: false, translate: false, tasks: false, agent: false, captions_summary: false };
const disabledStatus = (workspaceId: string | null): AIStatus => ({
  enabled: false,
  provider: null,
  model: "",
  features: ALL_OFF,
  can_configure: false,
  can_use: true,
  agent_installed_channel_ids: [],
  agent_installed_everywhere: false,
  installs_known: false,
  workspace_id: workspaceId,
});

/** Keyed by workspace id ("" = legacy, no workspace). Entries are replaced, never mutated. */
let entries: Record<string, StatusEntry> = {};
const inflight = new Map<string, Promise<AIStatus>>();
const fetchedAt = new Map<string, number>();
/** Workspaces where an AI call answered 403 policy:use_ai (until the next settings change). */
const policyBlocked = new Set<string>();
const statusListeners = new Set<() => void>();
/** The workspace the UI is showing; used by calls that don't know theirs (translate, tasks…). */
let currentWorkspace = "";

const FOCUS_REFRESH_MS = 15_000;

function setEntry(key: string, status: AIStatus) {
  entries = { ...entries, [key]: { status, loaded: true } };
  statusListeners.forEach((fn) => fn());
}

/** Patch the cached status of a workspace (no-op when it isn't loaded). */
function patchStatus(key: string, patch: (s: AIStatus) => AIStatus) {
  const cur = entries[key]?.status;
  if (cur) setEntry(key, patch(cur));
}

function markDisabled(key = currentWorkspace) {
  const cur = entries[key]?.status;
  if (cur && !cur.enabled) return;
  setEntry(key, { ...(cur ?? disabledStatus(key || null)), enabled: false });
}

function markPolicyBlocked(key = currentWorkspace) {
  if (!key) return;
  policyBlocked.add(key);
  patchStatus(key, (s) => (s.can_use ? { ...s, can_use: false } : s));
}

function toFeatures(v: unknown, enabled: boolean): AIFeatures {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Loose;
    const out = { ...ALL_ON };
    for (const f of AI_FEATURES) if (typeof o[f] === "boolean") out[f] = o[f] as boolean;
    return out;
  }
  if (Array.isArray(v)) {
    // Legacy list of capability names.
    const has = (...names: string[]) => names.some((n) => v.includes(n));
    if (!v.length) return enabled ? ALL_ON : ALL_OFF;
    return {
      ask: has("ask"),
      summaries: has("summaries", "channel_summary", "thread_summary", "catch_up"),
      composer: has("composer", "compose"),
      translate: has("translate"),
      tasks: has("tasks"),
      agent: has("agent"),
      captions_summary: has("captions_summary", "call_summary"),
    };
  }
  return enabled ? ALL_ON : ALL_OFF;
}

function toProvider(v: unknown, model: string): AIProvider | null {
  if (v === "anthropic" || v === "gemini" || v === "deepseek") return v;
  if (/^claude/i.test(model)) return "anthropic";
  if (/gemini/i.test(model)) return "gemini";
  if (/deepseek/i.test(model)) return "deepseek";
  return null;
}

/** use_ai policy from the status payload, if the server includes it there. */
function policyFromStatus(raw: Loose, canConfigure: boolean): boolean | null {
  if (typeof raw.can_use === "boolean") return raw.can_use;
  if (typeof raw.allowed === "boolean") return raw.allowed;
  const policies = raw.policies && typeof raw.policies === "object" ? (raw.policies as Loose) : null;
  const useAI = policies?.use_ai ?? raw.use_ai_policy ?? raw.use_ai;
  if (useAI === "admins") return canConfigure;
  if (useAI === "everyone") return true;
  return null;
}

function normalize(raw: Loose, workspaceId: string | null, canUse: boolean): AIStatus {
  const enabled = !!raw.enabled;
  const model = typeof raw.model === "string" ? raw.model : "";
  const ids = Array.isArray(raw.agent_installed_channel_ids) ? raw.agent_installed_channel_ids.filter((x): x is string => typeof x === "string") : [];
  return {
    enabled,
    provider: toProvider(raw.provider, model),
    model,
    features: toFeatures(raw.features, enabled),
    can_configure: !!raw.can_configure,
    can_use: canUse,
    agent_installed_channel_ids: ids,
    agent_installed_everywhere: !!raw.agent_installed_everywhere,
    installs_known: Array.isArray(raw.agent_installed_channel_ids) || typeof raw.agent_installed_everywhere === "boolean",
    workspace_id: workspaceId,
  };
}

async function fetchLegacy(): Promise<AIStatus> {
  const raw = await api<Loose>("/ai/status");
  return normalize(raw ?? {}, null, true);
}

async function fetchWorkspace(workspaceId: string): Promise<AIStatus> {
  let raw: Loose;
  try {
    raw = (await api<Loose>(`/workspaces/${workspaceId}/ai/status`)) ?? {};
  } catch (err) {
    // An API without per-workspace AI yet: fall back to the env-only status.
    if (err instanceof ApiError && (err.status === 404 || err.status === 405)) return { ...(await fetchLegacy()), workspace_id: workspaceId };
    // Not a member any more (or deactivated): AI is simply unavailable here.
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) return disabledStatus(workspaceId);
    throw err;
  }
  const canConfigure = !!raw.can_configure;
  let canUse = policyFromStatus(raw, canConfigure);
  if (canUse === null && !canConfigure && raw.enabled) {
    // The status payload doesn't carry the use_ai policy: read it from the workspace settings.
    const settings = await api<Loose>(`/workspaces/${workspaceId}/settings`).catch(() => null);
    const policies = settings?.policies && typeof settings.policies === "object" ? (settings.policies as Loose) : null;
    if (policies?.use_ai === "admins") canUse = false;
    else if (policies?.use_ai === "everyone") canUse = true;
  }
  if (canUse === null) canUse = canConfigure || !policyBlocked.has(workspaceId);
  else if (canUse) policyBlocked.delete(workspaceId);
  return normalize(raw, workspaceId, canUse);
}

/**
 * AI status for a workspace (legacy env-only status without one), fetched once and cached; pass
 * `force` to refetch. Never throws: a network failure reads as "off" and retries later.
 */
export function getAIStatus(workspaceId?: string | null, force = false): Promise<AIStatus> {
  const key = workspaceId || "";
  const pending = inflight.get(key);
  if (pending) return pending;
  const cached = entries[key];
  if (cached?.loaded && cached.status && !force) return Promise.resolve(cached.status);
  const p = (key ? fetchWorkspace(key) : fetchLegacy())
    .catch(() => {
      // Keep what we had through a blip; first load reads as off (focus or the next mount retries).
      fetchedAt.delete(key);
      return entries[key]?.status ?? disabledStatus(key || null);
    })
    .then((s) => {
      if (inflight.get(key) === p) inflight.delete(key);
      fetchedAt.set(key, Date.now());
      setEntry(key, s);
      return s;
    });
  inflight.set(key, p);
  return p;
}

/** Refetch every workspace status we've loaded (after settings changes or a gate error). */
export function refreshAllAIStatus(workspaceId?: string | null) {
  const keys = workspaceId ? [workspaceId] : Object.keys(entries);
  for (const k of keys) void getAIStatus(k, true);
}

/** Synchronous read of the cached status (null when not loaded). */
export function peekAIStatus(workspaceId?: string | null): AIStatus | null {
  return entries[workspaceId ?? currentWorkspace]?.status ?? null;
}

let windowHooked = false;
function hookWindow() {
  if (windowHooked || typeof window === "undefined") return;
  windowHooked = true;
  const refreshStale = () => {
    const now = Date.now();
    for (const k of Object.keys(entries)) if (now - (fetchedAt.get(k) ?? 0) > FOCUS_REFRESH_MS) void getAIStatus(k, true);
  };
  window.addEventListener("focus", refreshStale);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshStale();
  });
  window.addEventListener(AI_SETTINGS_CHANGED_EVENT, (e) => {
    const ws = (e as CustomEvent<{ workspaceId?: string } | undefined>).detail?.workspaceId;
    if (ws) policyBlocked.delete(ws);
    else policyBlocked.clear();
    refreshAllAIStatus(ws);
  });
}

function subscribeStatus(fn: () => void) {
  hookWindow();
  statusListeners.add(fn);
  return () => {
    statusListeners.delete(fn);
  };
}

/** The workspace in context: explicit id, else the WorkspaceProvider's, else the /w/[workspaceId] route. */
function useAIWorkspaceId(explicit?: string | null): string {
  const ctx = useOptionalWorkspace();
  const params = useParams<{ workspaceId?: string | string[] }>();
  const fromRoute = typeof params?.workspaceId === "string" ? params.workspaceId : "";
  return explicit || ctx?.workspaceId || fromRoute || "";
}

export type AIStatusHook = {
  /** null while loading. */
  status: AIStatus | null;
  /** Configured AND the use_ai policy lets me use it (false while loading). */
  enabled: boolean;
  loading: boolean;
  /** I can change AI settings (owner/admin). */
  canConfigure: boolean;
  workspaceId: string;
};

/** Workspace AI status, shared and cached. */
export function useAIStatus(workspaceId?: string | null): AIStatusHook {
  const ws = useAIWorkspaceId(workspaceId);
  const entry = useSyncExternalStore(
    subscribeStatus,
    () => entries[ws] ?? EMPTY_ENTRY,
    () => EMPTY_ENTRY,
  );
  useEffect(() => {
    if (ws) currentWorkspace = ws;
    if (!entry.loaded) void getAIStatus(ws);
  }, [ws, entry.loaded]);
  const s = entry.status;
  return {
    status: s,
    enabled: !!s?.enabled && s.can_use,
    loading: !entry.loaded,
    canConfigure: !!s?.can_configure,
    workspaceId: ws,
  };
}

export type AIGate = AIStatusHook & {
  /** Why it's unavailable (null when ready or loading). */
  reason: AIGateReason | null;
  /** Loaded, configured, allowed and the feature is on. */
  ready: boolean;
  settingsHref: string;
};

/** AI status plus the gate for one feature (or AI as a whole). */
export function useAIGate(feature?: AIFeature, workspaceId?: string | null): AIGate {
  const s = useAIStatus(workspaceId);
  const reason = s.loading ? null : aiGateReason(s.status, feature);
  return { ...s, reason, ready: !s.loading && !reason, settingsHref: aiSettingsHref(s.workspaceId) };
}

// --- @worklio agent installs ------------------------------------------------------------------

/** Is the @worklio agent available in this channel? DMs always are; unknown installs count as yes. */
export function agentInstalledIn(
  status: AIStatus | null,
  channel: { id: string; kind: "public" | "private" | "dm" } | null | undefined,
): boolean {
  if (!status || !channel) return false;
  if (channel.kind === "dm") return true;
  if (!status.installs_known) return true;
  if (status.agent_installed_channel_ids.includes(channel.id)) return true;
  return status.agent_installed_everywhere && channel.kind === "public";
}

/**
 * Add Worklio AI to a channel (POST /channels/{id}/apps/worklio). Optimistic: the channel is
 * marked installed right away and rolled back (with a toast) if the server refuses.
 */
export async function installWorklioAgent(workspaceId: string, channelId: string): Promise<boolean> {
  const before = entries[workspaceId]?.status ?? null;
  patchStatus(workspaceId, (s) =>
    s.agent_installed_channel_ids.includes(channelId) ? s : { ...s, agent_installed_channel_ids: [...s.agent_installed_channel_ids, channelId] },
  );
  try {
    await api(`/channels/${channelId}/apps/worklio`, { method: "POST" });
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) return true; // already installed
    if (before) setEntry(workspaceId, before);
    if (err instanceof ApiError) {
      const detail = typeof err.body.detail === "string" ? err.body.detail : err.message;
      const gate = err.status === 403 ? gateFromDetail(detail) : null;
      if (gate) toast.error(gate.message);
      else if (err.status === 403) toast.error("Only channel managers and admins can add Worklio AI to this channel.");
      else toast.error(`Couldn't add Worklio AI: ${detail || "try again"}`);
    } else toast.error("Couldn't add Worklio AI. Check your connection.");
    return false;
  } finally {
    void getAIStatus(workspaceId, true);
  }
}

// --- SSE reader ------------------------------------------------------------------------------

const EVENT_TYPES = new Set(["status", "text", "citations", "done", "error"]);

function parseEvent(chunk: string): AIStreamEvent | null {
  const data = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""))
    .join("\n");
  if (!data) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object") return null;
    const e = parsed as { type?: unknown };
    if (typeof e.type !== "string" || !EVENT_TYPES.has(e.type)) return null;
    if (e.type === "text" && typeof (parsed as { delta?: unknown }).delta !== "string") return null;
    if (e.type === "citations" && !Array.isArray((parsed as { items?: unknown }).items)) return null;
    if (e.type === "error") {
      const err = parsed as { code?: unknown; message?: unknown };
      const raw = typeof err.code === "string" ? err.code : "";
      const gate = gateFromDetail(raw);
      const code: AIErrorCode =
        gate?.code ??
        (["ai_not_configured", "rate_limited", "refusal", "failed", "policy", "feature_disabled"] as const).find((c) => c === raw) ??
        "failed";
      const message = aiEventMessage({ code, message: gate?.message ?? (typeof err.message === "string" ? err.message : "") });
      if (code === "ai_not_configured") markDisabled();
      if (raw === "policy:use_ai") markPolicyBlocked();
      if (code === "policy" || code === "feature_disabled") onGateError(message);
      return { type: "error", code, message };
    }
    return parsed as AIStreamEvent;
  } catch {
    return null;
  }
}

/**
 * POST `path` and feed each server-sent event to `onEvent`. Resolves when the stream ends,
 * fails or is aborted; never throws. HTTP and network failures arrive as `error` events.
 * Aborting (via `signal`) resolves quietly without an event.
 */
export async function streamAI(
  path: string,
  body: unknown,
  onEvent: (e: AIStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = await freshToken();
  const fail = (err: AIError) => onEvent({ type: "error", code: err.code, message: err.message });
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal,
      cache: "no-store",
    });
  } catch {
    if (!signal?.aborted) fail(new AIError("failed", "Couldn't reach Worklio AI. Check your connection."));
    return;
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    fail(errorFromResponse(res.status, json && typeof json === "object" ? json : {}));
    return;
  }
  if (!res.body) {
    fail(new AIError("failed", "Your browser can't read streamed responses."));
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  const dispatch = (chunk: string) => {
    const e = parseEvent(chunk);
    if (!e || finished) return;
    if (e.type === "done" || e.type === "error") finished = true;
    onEvent(e);
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (let m = /\r?\n\r?\n/.exec(buffer); m; m = /\r?\n\r?\n/.exec(buffer)) {
        dispatch(buffer.slice(0, m.index));
        buffer = buffer.slice(m.index + m[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) dispatch(buffer);
    if (!finished) fail(new AIError("failed", "The response ended unexpectedly. Try again."));
  } catch {
    if (signal?.aborted) return;
    if (!finished) fail(new AIError("failed", "The connection was interrupted. Try again."));
  } finally {
    reader.releaseLock?.();
  }
}

// --- Normalisers (be lenient with the conversation payload shape) -------------------------------

const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);

function toCitations(v: unknown): AICitation[] {
  return Array.isArray(v) ? (v.filter((c) => c && typeof c === "object" && typeof (c as Loose).message_id === "string") as AICitation[]) : [];
}

function toTurn(t: Loose, i: number): AITurn {
  const role = t.role === "user" || t.role === "assistant" ? t.role : i % 2 === 0 ? "user" : "assistant";
  return {
    id: str(t.id, `turn-${i}`),
    role,
    text: str(t.text) || str(t.content) || str(t.answer) || str(t.question),
    citations: toCitations(t.citations),
    created_at: str(t.created_at) || null,
  };
}

function toConversation(c: Loose): AIConversation {
  return {
    id: str(c.id),
    title: str(c.title) || "Untitled chat",
    created_at: str(c.created_at),
    updated_at: str(c.updated_at) || str(c.created_at),
  };
}

function toConversationDetail(c: Loose): AIConversationDetail {
  const raw = Array.isArray(c.turns) ? c.turns : Array.isArray(c.messages) ? c.messages : [];
  // A turn may also arrive as {question, answer, citations}: split it into two bubbles.
  const turns: AITurn[] = [];
  (raw as Loose[]).forEach((t, i) => {
    if (typeof t.question === "string" && typeof t.answer === "string") {
      turns.push({ ...toTurn({ ...t, text: t.question, role: "user", citations: [] }, i), id: `${str(t.id, String(i))}-q` });
      turns.push({ ...toTurn({ ...t, text: t.answer, role: "assistant" }, i), id: `${str(t.id, String(i))}-a` });
    } else turns.push(toTurn(t, i));
  });
  return { ...toConversation(c), turns };
}

// --- Endpoints -------------------------------------------------------------------------------

type OnEvent = (e: AIStreamEvent) => void;

/** Paths of the streaming endpoints, for `streamAI` / `useAIStream`. */
export const aiPaths = {
  ask: (workspaceId: string) => `/workspaces/${workspaceId}/ai/ask`,
  channelSummary: (channelId: string) => `/channels/${channelId}/ai/summary`,
  threadSummary: (messageId: string) => `/messages/${messageId}/ai/thread-summary`,
  catchUp: (workspaceId: string) => `/workspaces/${workspaceId}/ai/catch-up`,
};

export const ai = {
  status: (workspaceId?: string | null, force = false) => getAIStatus(workspaceId, force),

  // Ask Worklio
  ask: (workspaceId: string, body: { question: string; conversation_id?: string | null }, onEvent: OnEvent, signal?: AbortSignal) =>
    streamAI(aiPaths.ask(workspaceId), { question: body.question, ...(body.conversation_id ? { conversation_id: body.conversation_id } : {}) }, onEvent, signal),
  conversations: (workspaceId: string) =>
    call<Loose[] | { items?: Loose[] }>(`/workspaces/${workspaceId}/ai/conversations`).then((r) =>
      (Array.isArray(r) ? r : (r.items ?? [])).map(toConversation),
    ),
  conversation: (id: string) => call<Loose>(`/ai/conversations/${id}`).then(toConversationDetail),
  deleteConversation: (id: string) => call<void>(`/ai/conversations/${id}`, { method: "DELETE" }),

  // Summaries
  channelSummary: (channelId: string, range: SummaryRange, onEvent: OnEvent, signal?: AbortSignal) =>
    streamAI(aiPaths.channelSummary(channelId), { range }, onEvent, signal),
  threadSummary: (messageId: string, onEvent: OnEvent, signal?: AbortSignal) =>
    streamAI(aiPaths.threadSummary(messageId), {}, onEvent, signal),
  catchUp: (workspaceId: string, onEvent: OnEvent, signal?: AbortSignal) => streamAI(aiPaths.catchUp(workspaceId), {}, onEvent, signal),

  // Writing tools
  /** `workspace_id` picks the workspace's AI provider (older APIs ignore it). */
  compose: (body: { text: string; action: ComposeAction; target_language?: string; workspace_id?: string }) =>
    call<{ text: string }>("/ai/compose", post(body)),
  translate: (messageId: string, targetLanguage: string) =>
    call<{ text: string; detected_language: string | null }>(`/messages/${messageId}/ai/translate`, post({ target_language: targetLanguage })),
  tasks: (messageId: string) =>
    call<{ tasks?: Partial<ExtractedTask>[] }>(`/messages/${messageId}/ai/tasks`, post({})).then((r) =>
      (r.tasks ?? [])
        .filter((t) => typeof t.title === "string" && t.title.trim())
        .map((t) => ({
          title: t.title!.trim(),
          assignee_id: t.assignee_id ?? null,
          due_date: t.due_date ?? null,
          source_message_id: t.source_message_id ?? null,
        })),
    ),

  // @worklio agent
  bot: (workspaceId: string) => call<{ user_id: string }>(`/workspaces/${workspaceId}/ai/bot`),
};

// --- Text helpers ----------------------------------------------------------------------------

/** Citation markers like [1], [1, 3] or ranges [1–4] / [2, 5-7] in model text. */
export const CITATION_RE = /\[(\d{1,3}(?:\s*[,–-]\s*\d{1,3})*)\](?!\()/g;

/** "[5]–[9]" (a range written between two markers) → "[5–9]", so it reads as one group. */
export function joinCitationRanges(text: string): string {
  return text.replace(/\[(\d{1,3})\]\s*[–-]\s*\[(\d{1,3})\]/g, "[$1–$2]");
}

/** The numbers inside one marker: "1–4" → [1,2,3,4], "2, 5-6" → [2,5,6]. At most 8. */
export function citationNumbers(inside: string): number[] {
  const out: number[] = [];
  for (const part of inside.split(",")) {
    const [a, b] = part.split(/[–-]/).map((x) => Number(x.trim()));
    if (!Number.isFinite(a)) continue;
    const end = Number.isFinite(b) && b >= a && b - a < 20 ? b : a;
    for (let n = a; n <= end && out.length < 8; n++) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** Model markdown → Worklio message markup (for "Post to channel"); drops citation markers. */
export function markdownToMessage(md: string): string {
  return joinCitationRanges(md)
    .replace(CITATION_RE, "")
    .split("\n")
    .map((line) => {
      const h = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
      if (h) return `*${h[1].replace(/\*\*/g, "").trim()}*`;
      const li = /^(\s*)[-*•]\s+(.*)$/.exec(line);
      if (li) return `${li[1]}• ${li[2]}`;
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) return "";
      return line;
    })
    .join("\n")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/__(.+?)__/g, "_$1_")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Display name for a language code or name ("es" → "Spanish"). */
export function languageName(lang: string | null | undefined): string {
  if (!lang) return "";
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "language" });
    const name = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) ? dn.of(lang) : undefined;
    return name ?? lang;
  } catch {
    return lang;
  }
}
