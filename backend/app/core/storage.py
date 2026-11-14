"""S3-compatible object storage (SeaweedFS locally, AWS S3 in production).

boto3 is synchronous, so callers run these via `asyncio.to_thread`.

Content types come from the client, so they are never trusted for rendering: only a
small allowlist of passive formats is served `inline`; everything else (HTML, SVG,
XHTML, scripts...) is forced to download as `application/octet-stream`.
"""

import re
from functools import cache
from typing import BinaryIO

import boto3
from botocore.client import BaseClient
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings

PRESIGNED_TTL_SECONDS = 3600
DEFAULT_CONTENT_TYPE = "application/octet-stream"

# Formats a browser renders without executing anything.
INLINE_SAFE_TYPES = frozenset(
    {
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/avif",
        "application/pdf",
        "video/mp4",
        "video/webm",
        "audio/webm",
        "audio/ogg",
        "audio/mp4",
        "audio/mpeg",
        "text/plain",
    }
)
_CONTENT_TYPE_RE = re.compile(r"^[a-z0-9][a-z0-9.+-]*/[a-z0-9][a-z0-9.+-]*$")


def normalize_content_type(raw: str | None) -> str:
    """Lowercase, drop parameters (`; charset=...`) and reject anything malformed or oversized."""
    value = (raw or "").split(";", 1)[0].strip().lower()
    if len(value) > 100 or not _CONTENT_TYPE_RE.match(value):
        return DEFAULT_CONTENT_TYPE
    return value


def is_inline_safe(content_type: str) -> bool:
    return content_type in INLINE_SAFE_TYPES or (
        content_type.startswith("audio/") and _CONTENT_TYPE_RE.match(content_type) is not None
    )


def _client(endpoint: str | None) -> BaseClient:
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.s3_access_key or None,
        aws_secret_access_key=settings.s3_secret_key or None,
        region_name="us-east-1",
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


@cache
def internal_client() -> BaseClient:
    return _client(settings.s3_endpoint_url)


@cache
def public_client() -> BaseClient:
    # Presigned URLs embed the host, so sign them for the URL browsers can reach.
    return _client(settings.s3_public_endpoint_url or settings.s3_endpoint_url)


def ensure_bucket() -> None:
    try:
        internal_client().head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        try:
            internal_client().create_bucket(Bucket=settings.s3_bucket)
        except ClientError as err:
            # Several API workers start at once; another one may have just created it.
            code = err.response.get("Error", {}).get("Code", "")
            if code not in ("BucketAlreadyOwnedByYou", "BucketAlreadyExists"):
                raise
            internal_client().head_bucket(Bucket=settings.s3_bucket)


def upload(key: str, fileobj: BinaryIO, content_type: str) -> None:
    content_type = normalize_content_type(content_type)
    stored_type = content_type if is_inline_safe(content_type) else DEFAULT_CONTENT_TYPE
    internal_client().upload_fileobj(
        fileobj, settings.s3_bucket, key, ExtraArgs={"ContentType": stored_type}
    )


def delete(key: str) -> None:
    internal_client().delete_object(Bucket=settings.s3_bucket, Key=key)


def presigned_get(key: str, filename: str, content_type: str = DEFAULT_CONTENT_TYPE) -> str:
    content_type = normalize_content_type(content_type)
    inline = is_inline_safe(content_type)
    safe_name = filename.replace('"', "").replace("\\", "")
    return public_client().generate_presigned_url(
        "get_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            # Overrides whatever ContentType the object was stored with (older uploads included).
            "ResponseContentType": content_type if inline else DEFAULT_CONTENT_TYPE,
            "ResponseContentDisposition": (
                f'{"inline" if inline else "attachment"}; filename="{safe_name}"'
            ),
        },
        ExpiresIn=PRESIGNED_TTL_SECONDS,
    )
