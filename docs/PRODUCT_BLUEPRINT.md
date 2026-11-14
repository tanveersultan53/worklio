# Worklio — Product Blueprint

> What's next: [ROADMAP.md](ROADMAP.md) · How to help: [CONTRIBUTING.md](../CONTRIBUTING.md) · Open work: [Roadmap issue #24](https://github.com/tanveersultan53/worklio/issues/24)

Worklio is a team communication platform: messaging, calls and collaboration, with AI built in from the start rather than bolted on. This document lists every feature and its real status. Statuses were last audited against the code and tests on 2026-11-14.

**Status legend**
- ✅ **Live-tested**: shipped, covered by automated tests, and verified in a browser with two accounts.
- ☑️ **Shipped**: built and covered by automated tests; not yet re-verified in a live browser session.
- ⏳ **Planned**: not built yet. The linked issue describes the work.
- ➖ **Later / dropped**: out of scope for now.

---

## 1. Messaging core
| Feature | Status |
|---|---|
| Channels (public/private), DMs, group DMs, threads, reactions, edit/delete, typing, presence | ✅ |
| Rich text (bold/italic/strike/code/blocks/quotes/links), @mentions, emoji picker, jumbo emoji | ✅ |
| File uploads, voice messages, video clips, screen recordings | ☑️ |
| Drafts per channel, Up-arrow edit, unread divider, search | ✅ |
| Pagination v2: stable history cursor, jump to any message, "Jump to latest", reconnect gap-fill, paged threads and search | ✅ |
| Pinned messages & channel bookmarks bar | ☑️ |
| Forward / share message, copy link, permalinks | ☑️ |
| Scheduled send ("Send tomorrow 9:00"), with edit, cancel and send now | ☑️ |
| Polls (single/multi choice, anonymous option, live results) | ✅ |
| Slash commands: /remind /poll /dnd /mute /status /away /shrug /topic /invite /leave /ai, plus /dm /schedule /react /keep /done | ☑️ |
| /giphy (GIF search; needs a third-party API key) | ➖ |
| Link unfurls (OpenGraph preview, SSRF-safe server fetch) | ☑️ |
| @here / @channel / @everyone, user groups (@design) | ☑️ |
| Edit history, "seen by" read receipts in DMs | ☑️ |
| Code snippets with syntax highlighting | ☑️ |
| Advanced search filters (from: in: has: before: after: on: is:thread, quoted phrases) | ☑️ |
| Saved searches | ⏳ [#26](https://github.com/tanveersultan53/worklio/issues/26) |
| Custom emoji upload | ⏳ [#27](https://github.com/tanveersultan53/worklio/issues/27) |

## 2. Navigation & personal productivity
| Feature | Status |
|---|---|
| Workspace rail, ⌘K switcher, multi-workspace, workspace icons | ✅ |
| Hidden workspace switcher (Slack-style menu on the current workspace) | ☑️ |
| Threads inbox (threads you follow, unread first, reply inline) | ☑️ |
| Activity (mentions, reactions to you, thread replies, invites; tabs; unread) | ✅ |
| Later / To-do (saved messages, to-dos with due dates, reminders, In progress/Completed/Archived) | ✅ |
| Reminders ("remind me in 20 min / tomorrow"), delivered as notification + Worklio bot DM | ✅ |
| Drafts & sent (including scheduled messages) | ☑️ |
| Huddles history (past calls, duration, people, notes) | ☑️ |
| Files browser (all workspace files, type/person filters, search) | ✅ |
| Directories (people with status/title/local time; channels with join) | ☑️ |
| Unreads view with mark-all-read | ☑️ |
| Sidebar customisation: show/hide workspace switcher, custom sections, drag channels, starred, hide nav items, compact mode | ☑️ |
| Per-channel notification prefs & mute, DND and notification schedule | ☑️ |

## 3. Calls & meetings
| Feature | Status |
|---|---|
| Ringing audio/video calls (incoming modal, ringtone, missed/declined/cancelled) | ✅ |
| Call cards in chat, live state, duration | ✅ |
| Meeting window: grid, stage switcher (Video/Whiteboard/Board/Screen), "Bring everyone" | ✅ |
| Sidebar huddle dock | ☑️ |
| Screen share + annotation (pen, arrow, shapes, laser) | ☑️ |
| Call notes → thread, in-call chat, raise hand, reactions | ☑️ |
| Live captions & transcript (browser speech recognition; summaries need AI) | ☑️ |
| AI meeting summary + action items | ☑️ (needs an AI key) |
| Huddle notifications: banner, chime, desktop notification (respects mute/DND/notify level), join/leave sounds, sidebar live badge | ✅ |
| Camera effects: background blur, virtual backgrounds, pre-join camera check | ✅ (blur live-tested) |
| Web push for calls/huddles when the browser is closed | ⏳ [#18](https://github.com/tanveersultan53/worklio/issues/18) |
| Huddle recording (LiveKit egress → Files) | ⏳ [#20](https://github.com/tanveersultan53/worklio/issues/20) |
| Scheduled meetings & calendar (ICS invite) | ✅ [#31](https://github.com/tanveersultan53/worklio/issues/31) |

## 4. Collaboration surfaces
| Feature | Status |
|---|---|
| Whiteboard (Excalidraw, live multi-cursor, persisted, in calls) | ✅ |
| Canvas: live co-editing (Yjs CRDT over our WebSocket), autosave, slash menu, tables, images, @mentions, comments, templates, Canvases list | ✅ (co-editing live-tested) |
| Board (Kanban, drag and drop, assignees, due dates, labels, priorities, covers) | ✅ |
| Lists: table view, custom fields (status, priority, people, date, number, select), subtasks, card comments, column drag, sort/group/filter | ✅ (table view live-tested) |
| Clips: screen + camera bubble recording with drawing, trim | ☑️ |

## 5. Worklio AI (built in, permission-aware)
All AI respects channel access: the model retrieves context only through tools that call Worklio's permission-checked search, so it can never surface a message the asking user can't read. Providers: Anthropic (default model `claude-opus-5-5`, configurable via `AI_MODEL`), Gemini and DeepSeek, configured per workspace in **Settings → AI** (keys encrypted at rest) or with `ANTHROPIC_API_KEY`. AI is off until a key is set; the UI explains how to enable it.

| Feature | Status |
|---|---|
| Ask Worklio: Q&A over your workspace with cited sources (tool-based, permission-checked retrieval) | ☑️ |
| Catch me up: channel / thread / unread digest summaries | ☑️ |
| Composer assistant: rewrite (shorter, clearer, friendlier, formal), fix grammar, translate | ☑️ |
| Huddle AI: captions, transcript, summary, action items | ☑️ |
| Task extraction: "turn this thread into tasks" | ☑️ |
| @worklio agent in channels (answers, summarises, creates reminders/cards via tools), installed per channel | ☑️ |
| Message translation on demand | ☑️ |
| Admin AI settings: provider, key, test connection, per-feature toggles, usage | ✅ (without a live key) |
| Semantic search: embeddings + keyword hybrid | ⏳ [#33](https://github.com/tanveersultan53/worklio/issues/33) |

AI features are covered by tests with a mocked provider. They need a real provider key for a live end-to-end check.

## 6. Workspace admin & trust
| Feature | Status |
|---|---|
| Workspace settings (name, icon, description, URL generated from the name, default channels) | ✅ |
| Invite links (role, expiry, max uses, revoke) and the invite landing page | ✅ |
| Roles & permissions (owner/admin/member/guest, workspace policies enforced on the server) | ✅ |
| Member management (role changes, deactivate/reactivate, remove, transfer ownership), channel management | ✅ |
| Audit log | ✅ |
| Allowed email domains for automatic joining | ⏳ [#28](https://github.com/tanveersultan53/worklio/issues/28) |
| Email invitations (Celery + SMTP; Mailpit locally) | ⏳ [#19](https://github.com/tanveersultan53/worklio/issues/19) |
| Data export | ⏳ [#29](https://github.com/tanveersultan53/worklio/issues/29) |
| Retention policies | ⏳ [#30](https://github.com/tanveersultan53/worklio/issues/30) |
| SSO/SAML, SCIM | ➖ later |
| Billing (Stripe), plans & usage limits | ➖ later |

## 7. Platform
| Feature | Status |
|---|---|
| Sessions: short-lived access tokens + rotating refresh tokens (30 days), reuse detection | ✅ |
| Production deployment: Docker images (non-root), `docker-compose.prod.yml`, security headers, startup guards | ✅ |
| Web app manifest and app icons | ✅ |
| Web push notifications (service worker + VAPID) and email digests | ⏳ [#18](https://github.com/tanveersultan53/worklio/issues/18) |
| Installable PWA with offline shell | ⏳ [#32](https://github.com/tanveersultan53/worklio/issues/32) |
| Large-workspace scale: virtualised message list, paginated member/channel lists | ⏳ [#16](https://github.com/tanveersultan53/worklio/issues/16), [#17](https://github.com/tanveersultan53/worklio/issues/17) |
| i18n | ⏳ [#23](https://github.com/tanveersultan53/worklio/issues/23) |
| Desktop app (Tauri): native screen annotation overlay, global shortcuts | ➖ later |
| Mobile apps (React Native) | ➖ later |
| Incoming/outgoing webhooks, bot tokens, app framework | ➖ later |

## 8. Quality bar (applies to every change)
- Live two-account browser test of every user-facing flow before a feature is marked ✅.
- Backend: pytest for every endpoint incl. tenant isolation; ruff; a single Alembic head.
- Frontend: strict TypeScript, React Compiler lint rules clean, no hydration warnings, dark mode, 360 px mobile, keyboard & screen-reader accessible.
- Still to do: Playwright end-to-end suite ([#21](https://github.com/tanveersultan53/worklio/issues/21)) and an accessibility audit ([#22](https://github.com/tanveersultan53/worklio/issues/22)).
