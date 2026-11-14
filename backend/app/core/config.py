from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

INSECURE_SECRET_KEYS = {"change-me", "changeme", "secret", ""}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    secret_key: str = "change-me"
    access_token_expire_minutes: int = 60
    # Refresh tokens keep people signed in; each use rotates it and extends the session.
    refresh_token_expire_days: int = 30
    cors_origins: str = "http://localhost:3000"

    database_url: str = "postgresql+asyncpg://worklio:worklio@localhost:5432/worklio"
    redis_url: str = "redis://localhost:6379/0"
    celery_broker_url: str = "redis://localhost:6379/1"

    s3_endpoint_url: str | None = None
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_public_endpoint_url: str | None = None
    s3_bucket: str = "worklio-uploads"
    max_upload_bytes: int = 25 * 1024 * 1024
    # Recorded media (kind "screen_recording" or "video_clip") may be larger than other uploads.
    max_recording_bytes: int = 300 * 1024 * 1024
    # Uploads never attached to a message are deleted after this long (Celery beat task).
    orphan_upload_ttl_hours: int = 24

    # Profile photos (POST /auth/me/avatar).
    max_avatar_bytes: int = 5 * 1024 * 1024
    # Public base URL of this API, used to build absolute links such as avatar URLs.
    api_public_url: str = "http://localhost:8000"
    # Public URL of the web app, for links in calendar invites. Empty: the first CORS origin.
    app_public_url: str = ""

    # Canvas documents (TipTap JSON) are capped at this many bytes of serialized content.
    max_canvas_bytes: int = 1024 * 1024

    # Whiteboards (Excalidraw scenes): request body cap for a save, and live relay limits.
    max_whiteboard_bytes: int = 5 * 1024 * 1024
    whiteboard_ops_per_second: int = 30
    whiteboard_pointer_per_second: int = 20

    # Huddles (LiveKit). The public URL is what browsers connect to.
    livekit_public_url: str = "ws://localhost:7880"
    livekit_api_key: str = "devkey"
    livekit_api_secret: str = "secret"
    huddle_token_ttl_hours: int = 6

    # Fixed-window rate limits (attempts per minute) for unauthenticated auth endpoints.
    login_rate_limit_per_ip: int = 20
    login_rate_limit_per_email: int = 10
    register_rate_limit_per_ip: int = 10
    refresh_rate_limit_per_ip: int = 120

    # Worklio AI (Claude). Every AI endpoint answers 503 "ai_not_configured" while the key is
    # empty. The model id is used exactly as written (no date suffix).
    anthropic_api_key: str = ""
    ai_model: str = "claude-opus-5-5"
    # Per-user budget across every AI feature (Redis fixed window).
    ai_rate_limit_requests: int = 40
    ai_rate_limit_window_seconds: int = 600
    # Seconds before a single Claude request is abandoned.
    ai_request_timeout: float = 300.0

    @model_validator(mode="after")
    def _require_real_secret_outside_dev(self):
        # Tokens signed with a guessable key can be forged for any user id.
        weak = self.secret_key in INSECURE_SECRET_KEYS or len(self.secret_key.encode()) < 32
        if self.environment not in ("development", "test") and weak:
            raise ValueError(
                "SECRET_KEY must be set to a random value of at least 32 bytes outside development"
            )
        # LiveKit's --dev keys are public; anyone could mint call tokens with them.
        dev_livekit = self.livekit_api_key == "devkey" or self.livekit_api_secret in ("secret", "")
        if self.environment not in ("development", "test") and dev_livekit:
            raise ValueError(
                "Set LIVEKIT_API_KEY / LIVEKIT_API_SECRET to non-default values outside development"
            )
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
