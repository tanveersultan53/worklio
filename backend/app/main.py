import asyncio
import json
import logging
import re
from collections.abc import Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app import calls as call_service
from app import canvas_collab
from app.api.routes import admin as admin_routes
from app.api.routes import (
    ai,
    ai_agents,
    auth,
    board,
    calls,
    canvas,
    channels,
    health,
    huddle,
    meetings,
    messages,
    messaging_extras,
    productivity_browse,
    productivity_inbox,
    productivity_later,
    productivity_sidebar,
    uploads,
    users,
    whiteboard,
    workspaces,
)
from app.api.routes import invites as invite_routes
from app.core import storage
from app.core.config import settings
from app.realtime import huddles
from app.realtime import routes as realtime_routes
from app.realtime.hub import hub

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await asyncio.to_thread(storage.ensure_bucket)
    await hub.start()
    sweeper = asyncio.create_task(huddles.run_sweeper())
    call_sweeper = asyncio.create_task(call_service.run_sweeper())
    yield
    sweeper.cancel()
    call_sweeper.cancel()
    # Persist canvas edits still waiting for their debounced flush.
    await canvas_collab.flush_all()
    await hub.stop()


# (method, path pattern, max body bytes, 413 message) for request bodies capped before parsing.
BODY_LIMITS: list[tuple[str, re.Pattern[str], Callable[[], int], Callable[[], str]]] = [
    (
        "POST",
        re.compile(r"^/workspaces/[^/]+/uploads/?$"),
        # Transport-level cap is the largest per-kind limit; the route enforces the per-kind one.
        uploads.max_upload_request_bytes,
        uploads.request_too_large_message,
    ),
    (
        "POST",
        re.compile(r"^/auth/me/avatar/?$"),
        lambda: settings.max_avatar_bytes + uploads.MULTIPART_OVERHEAD_BYTES,
        auth.avatar_too_large_message,
    ),
    (
        "PUT",
        re.compile(r"^/channels/[^/]+/canvas/?$"),
        # Content limit plus room for the title, version and JSON framing.
        lambda: settings.max_canvas_bytes + 16 * 1024,
        canvas.too_large_message,
    ),
    (
        "PUT",
        re.compile(r"^/channels/[^/]+/whiteboard/?$"),
        lambda: settings.max_whiteboard_bytes,
        whiteboard.too_large_message,
    ),
    (
        "POST",
        re.compile(r"^/workspaces/[^/]+/icon/?$"),
        lambda: admin_routes.MAX_ICON_BYTES + uploads.MULTIPART_OVERHEAD_BYTES,
        admin_routes.icon_too_large_message,
    ),
    (
        "PUT",
        re.compile(r"^/calls/[^/]+/notes/?$"),
        lambda: settings.max_canvas_bytes + 16 * 1024,
        calls.too_large_message,
    ),
]


class UploadSizeLimitMiddleware:
    """Refuse oversized bodies (uploads, avatars, canvases) *before* they are read.

    Checks Content-Length up front, and for bodies without one (chunked) counts bytes as
    they stream in and aborts with 413 once the limit is passed.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        rule = None
        if scope["type"] == "http":
            rule = next(
                (
                    r
                    for r in BODY_LIMITS
                    if r[0] == scope["method"] and r[1].match(scope["path"])
                ),
                None,
            )
        if rule is None:
            await self.app(scope, receive, send)
            return
        _, _, limit_fn, message_fn = rule
        limit = limit_fn()
        headers = dict(scope["headers"])
        declared = headers.get(b"content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            await self._reject(send, message_fn())
            return

        seen = 0

        async def limited_receive() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, message_fn())
            return message

        await self.app(scope, limited_receive, send)

    @staticmethod
    async def _reject(send: Send, detail: str) -> None:
        # CORSMiddleware wraps this one, so the browser can still read the error.
        body = json.dumps({"detail": detail}).encode()
        headers = [(b"content-type", b"application/json"), (b"connection", b"close")]
        await send({"type": "http.response.start", "status": 413, "headers": headers})
        await send({"type": "http.response.body", "body": body})


_public_docs = settings.environment in ("development", "test")
app = FastAPI(
    title="Worklio API",
    version="0.1.0",
    lifespan=lifespan,
    # Interactive docs only in development; production doesn't advertise its API surface.
    docs_url="/docs" if _public_docs else None,
    redoc_url="/redoc" if _public_docs else None,
    openapi_url="/openapi.json" if _public_docs else None,
)
app.add_middleware(UploadSizeLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(_: Request, exc: IntegrityError) -> JSONResponse:
    # Safety net for check-then-insert races the routes don't handle themselves.
    log.warning("Integrity error: %s", exc.orig)
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"detail": "That conflicts with a change made at the same time, please retry"},
    )


app.include_router(health.router)
app.include_router(auth.router)
app.include_router(workspaces.router)
app.include_router(channels.router)
app.include_router(messages.router)
app.include_router(messaging_extras.router)
app.include_router(uploads.router)
app.include_router(users.router)
app.include_router(board.router)
app.include_router(canvas.router)
app.include_router(whiteboard.router)
app.include_router(huddle.router)
app.include_router(calls.router)
app.include_router(meetings.router)
app.include_router(productivity_inbox.router)
app.include_router(productivity_later.router)
app.include_router(productivity_browse.router)
app.include_router(productivity_sidebar.router)
app.include_router(realtime_routes.router)
app.include_router(ai.router)
app.include_router(ai_agents.router)
# Wave D1 workspace administration (settings/policies, members, audit log) and invite links.
app.include_router(admin_routes.router)
app.include_router(invite_routes.router)
