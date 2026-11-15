# Deploying Worklio

This guide runs the whole stack on one Linux host with Docker Compose. Each service is a plain
container, so the same images also work on Kubernetes, ECS or Fly with your own manifests.

## What you need

- A host with Docker and the Compose plugin (2 vCPU / 4 GB RAM is enough for a small team).
- Three DNS names pointing at it, for example `app.example.com` (web), `api.example.com` (API and
  WebSocket) and `rtc.example.com` (LiveKit calls).
- A TLS-terminating reverse proxy (Caddy, Nginx, Traefik or a cloud load balancer).
- S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO) with a private bucket.
- Firewall: 443/tcp for the proxy, plus 7881/tcp and 7882/udp for call media.

## 1. Configure

```bash
cp .env.production.example .env.production
```

Fill in every value. In particular:

- `SECRET_KEY`: 32+ random bytes. The API refuses to start with a weak key outside development.
  Changing it later signs everyone out and makes stored AI provider keys unreadable.
- `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`: your own values. The API refuses LiveKit's public
  dev keys outside development. `LIVEKIT_NODE_IP` is the host's public IP.
- `CORS_ORIGINS`: exactly the web origin, e.g. `https://app.example.com`.
- `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL`: baked into the web image at build time, so
  rebuild `web` after changing them.
- `DATABASE_URL` must use the same password as `POSTGRES_PASSWORD`.

## 2. Start

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The API applies database migrations on start. `beat` must be running: reminders, scheduled
messages and upload cleanup depend on it. Ports are bound to `127.0.0.1` so only the proxy can
reach them (except LiveKit media ports).

## 3. Reverse proxy

Example `Caddyfile` (Caddy fetches TLS certificates automatically):

```
app.example.com {
	reverse_proxy 127.0.0.1:3000
}

api.example.com {
	# Plain reverse_proxy also handles the /ws WebSocket upgrade.
	reverse_proxy 127.0.0.1:8000
}

rtc.example.com {
	reverse_proxy 127.0.0.1:7880
}
```

The API runs uvicorn with `--proxy-headers`, so rate limits see real client IPs through the proxy.

## 4. Check it

- `https://api.example.com/health` returns `{"status": "ok"}`.
- Sign up at `https://app.example.com/signup`, create a workspace, upload a file, and start a
  huddle with a second account.
- Interactive API docs (`/docs`) are disabled outside development.

## Operations

- **Backups:** see [Backups and restore](#backups-and-restore) below. Redis holds only transient
  state (presence, queues, collaboration buffers), so it needs no backup.
- **Upgrades:** `git pull`, then rerun the `up -d --build` command. Migrations run on API start.
- **Scaling:** `WEB_CONCURRENCY` sets API worker processes. The API is stateless (realtime fans
  out through Redis), so you can run more `api` containers behind the proxy.
- **Logs:** `docker compose -f docker-compose.prod.yml logs -f api worker beat`. Every service keeps
  at most 5 × 10 MB of logs, so they can't fill the disk.
- **Health:** `docker compose -f docker-compose.prod.yml ps` shows each service as `healthy` or
  `unhealthy`. The api, web, worker, Postgres and Redis all have health checks.

## Backups and restore

`scripts/backup.sh` saves a compressed Postgres dump and, if your stack runs its own `s3`
(SeaweedFS) service, an archive of the uploaded files. It checks that each dump can be read
before keeping it, deletes backups older than `KEEP_DAYS` (default 14), and can copy each new
backup off the server with [rclone](https://rclone.org).

```bash
scripts/backup.sh /var/backups/worklio
```

Run it every night from cron (`crontab -e` as root):

```cron
15 3 * * * cd /opt/worklio && scripts/backup.sh /var/backups/worklio >> /var/log/worklio-backup.log 2>&1
```

Options, set as environment variables:

| Variable | Default | Use |
| --- | --- | --- |
| `KEEP_DAYS` | `14` | Days of backups to keep on the server. |
| `COMPOSE` | `docker compose -f docker-compose.prod.yml --env-file .env.production` | Your compose command, if you add override files. |
| `RCLONE_REMOTE` | (none) | Off-site copy, e.g. `b2:my-bucket/worklio`. Strongly recommended: a backup on the same disk won't survive losing the server. |

If your files live in an external S3 bucket, turn on versioning or replication there instead.

**Test your backups.** A restore drill loads a dump into a scratch database, counts the rows and
drops it again, without touching live data:

```bash
scripts/restore.sh --check /var/backups/worklio/db-20260101T031500Z.dump
```

**Restore** (this replaces the current data; the app is stopped while it runs):

```bash
scripts/restore.sh --yes /var/backups/worklio/db-<stamp>.dump /var/backups/worklio/uploads-<stamp>.tar.gz
```

See [SECURITY.md](../SECURITY.md) for the full hardening checklist.
