# Changelog

All notable changes to Worklio are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Until 1.0, minor
versions may include breaking changes.

## [Unreleased]

### Added
- MIT license, contributing guide, code of conduct, security policy, issue and pull request
  templates, and a CI workflow for backend and frontend checks.
- Documentation: architecture, configuration reference, roadmap, lessons learned, and package
  guides for `backend/` and `frontend/`.
- `.env.example` now lists the API public URL, LiveKit and AI settings.
- Rotating refresh tokens (`POST /auth/refresh`, `POST /auth/logout`): sessions last 30 days and
  renew in the background; replaying a rotated token revokes that sign-in.
- Redesigned sign-in, new `/signup` page and workspace setup, with a shared auth form (show
  password, strength meter, friendly errors, safe `?next=` redirects).
- New logo mark and favicon.
- Sidebar: "+" on the Channels and Direct messages headers, and a settings gear at the top.
- Production deployment: `docker-compose.prod.yml`, `.env.production.example`, a frontend
  Dockerfile (Next.js standalone), non-root containers and `docs/DEPLOYMENT.md`.
- Security headers on every page; app icons and a web manifest.
- Workspace icons show in the rail and workspace menus.
- Hidden workspace switcher works like Slack: the current workspace's icon opens a menu of all
  workspaces, with a dot when another workspace has unread messages.
- Pagination v2: history uses a stable (created_at, id) cursor, jumping to a message loads the
  history around it at any age (with "Jump to latest"), reconnects fill the whole gap, thread
  replies are paged and search has "Show more results".
- New message dialog offers "Invite people" when you're alone in a workspace.
- README logo and screenshots, and `scripts/seed_demo.py` to recreate the demo workspace.
- `GOVERNANCE.md`: contributor roles, decision making and the rules protecting `main`.
- Workspace URLs are generated from the name on creation (unique, lowercase letters, numbers and
  dashes).

### Fixed
- Channel names collapsed to one letter in the header when a thread was open.
- The "Get notified" prompt came back on every page load after being dismissed.
- AI search failed after search pagination was added (a direct call missed the new parameter).
- People were signed out every hour when the access token expired.
- Members table squeezed the Name column; audit log showed "a member" instead of names for
  deactivated or newly joined people.

### Changed
- The API refuses to start outside development with LiveKit's public dev keys, and hides `/docs`.
- Dev-only allowed hosts moved from `next.config.ts` to `NEXT_DEV_ALLOWED_ORIGINS`.
- Removed unused components, helpers and starter assets.
- Third-party AI-assistant skill files (`.agents/`, `.claude/`, `skills-lock.json`) are no longer
  tracked.

## [0.1.0] - 2026-11-14

First public version.

### Added

**Platform**
- FastAPI backend with async SQLAlchemy 2 and Alembic on PostgreSQL 17 (pgvector image).
- Realtime over one WebSocket per tab, fanned out through Redis pub/sub so the API scales
  horizontally; presence, typing and resync after reconnects.
- Celery worker and beat for link unfurls, AI jobs, reminders, scheduled sends and orphan-upload
  cleanup.
- S3-compatible file storage with presigned downloads (SeaweedFS for development).
- Docker Compose stack and Makefile for local development.

**Messaging**
- Public and private channels, DMs and group DMs, threads, reactions, edit with history, delete.
- Rich text, @mentions, `@here` / `@channel` / `@everyone`, user groups, emoji picker.
- File uploads, voice messages, video clips and screen recordings.
- Pins, channel bookmarks, forwarding, polls, scheduled send, slash commands, read receipts.
- SSRF-safe link previews.
- Search with `from:`, `in:`, `has:`, `before:`, `after:`, `on:` and `is:` filters.

**Navigation and productivity**
- Workspace rail, ⌘K switcher, multiple workspaces.
- Activity, Threads, Unreads, Drafts & sent, Later (saved items and to-dos), reminders.
- Files browser, directories, huddle history, custom sidebar sections.
- Per-channel notification settings and mute, Do Not Disturb, custom status.

**Calls and collaboration**
- Ringing audio/video calls and channel huddles on LiveKit, with call cards, notes, in-call chat,
  screen share with annotation, background blur and virtual backgrounds.
- Live captions and transcripts.
- Excalidraw whiteboard with live cursors.
- Canvas docs with real-time Yjs co-editing, comments and templates.
- Boards and lists with Kanban and table views, custom fields, subtasks and comments.

**Worklio AI**
- Claude, Gemini or DeepSeek, configured per workspace (keys encrypted at rest) or with a server
  `ANTHROPIC_API_KEY`.
- Ask Worklio with citations, catch-up, channel and thread summaries, composer rewrite and
  translate, message translation, thread → tasks, the `@worklio` channel agent, call summaries.
- Permission-aware retrieval through Worklio's own search.

**Admin and appearance**
- Roles (owner, admin, member, guest), workspace policies, member management, invite links,
  audit log, workspace settings and icon.
- Themes, dark mode, accent colour, fonts, text size, density, reduced motion, focus mode.

### Known limitations
- Thread replies and search are not paginated; jump to message reaches about 500 messages back;
  the message list is not virtualized; no gap fill after reconnect beyond the latest page.
- No web push, email invitations, PWA, huddle recording, calendar or end-to-end test suite yet.

[Unreleased]: https://github.com/tanveersultan53/worklio/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/tanveersultan53/worklio/releases/tag/v0.1.0
