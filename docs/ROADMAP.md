# Roadmap

This is a short view of what comes next. The detailed feature list, with status per feature, is in
[PRODUCT_BLUEPRINT.md](PRODUCT_BLUEPRINT.md). Plans change; open an issue if you want to work on
something here or propose something new (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

## Next

**Scale for very large workspaces** (Pagination v2 shipped: stable cursors, jump to any message,
reconnect gap-fill, paged threads and search)
- Virtualize the message list.
- Paginate member and channel lists.

**Reach people outside the open tab**
- Web push notifications (service worker + VAPID) for messages, calls and huddles.
- Installable PWA with an offline shell.
- Email invitations and email digests.

**Meetings**
- Huddle recording (LiveKit egress → Files).
- Recurring meetings, a subscribable calendar feed (webcal) and two-way Google / Outlook sync.

**Quality**
- Playwright end-to-end suite covering two-account flows.
- Performance work (large channels, long threads) and a Lighthouse pass.
- Accessibility audit (keyboard, screen readers, contrast).

## Later

- Desktop app (Tauri) and mobile apps.
- Webhooks, bot tokens and an app framework.
- SSO/SAML and SCIM.
- Internationalisation.
