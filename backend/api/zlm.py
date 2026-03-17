"""
ZLMediaKit HTTP client and shared helpers.
"""

import asyncio
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx

from utils import get_zlm_secret

# ZLMediaKit base URL (host port for HTTP API)
ZLM_HTTP_PORT = int(os.getenv("ZLM_HTTP_PORT", "8080"))
ZLM_SERVER = f"http://127.0.0.1:{ZLM_HTTP_PORT}"
# ZLMediaKit config path
ZLM_CONFIG_PATH = "/opt/media/conf/config.ini"
# Local recording root path
RECORD_ROOT = Path("/opt/media/bin/www/record")
# Docker container names
ZLM_CONTAINER_NAME = os.getenv("ZLM_CONTAINER_NAME", "zlm-server")
STREAMUI_CONTAINER_NAME = os.getenv("STREAMUI_CONTAINER_NAME", "streamui-web-server")
# Local timezone
LOCAL_TZ = ZoneInfo(os.getenv("TZ_NAME", "UTC"))

_zlm_secret_cache: str | None = None


def get_zlm_secret_cached() -> str:
    """Return ZLM secret, reading from disk on first call."""
    global _zlm_secret_cache
    if _zlm_secret_cache is not None:
        return _zlm_secret_cache
    try:
        _zlm_secret_cache = get_zlm_secret(ZLM_CONFIG_PATH)
    except Exception as e:
        print(f"[Warning] Could not read ZLM secret: {e}. API calls will fail until config.ini is available.")
        return ""
    return _zlm_secret_cache


client = httpx.AsyncClient(
    timeout=5.0,
    limits=httpx.Limits(
        max_connections=10,
        max_keepalive_connections=20,
    ),
)


def audio_type_to_zlm_params(audio_type: int | None) -> dict[str, str]:
    if audio_type == 0:
        return {"enable_audio": "0", "add_mute_audio": "0"}
    if audio_type == 1:
        return {"enable_audio": "1", "add_mute_audio": "0"}
    if audio_type == 2:
        return {"enable_audio": "1", "add_mute_audio": "1"}
    return {}


def stream_proxy_key(vhost: str, app: str, stream: str) -> str:
    return f"{vhost}/{app}/{stream}"


async def add_stream_proxy_to_zlm(
    *,
    vhost: str,
    app: str,
    stream: str,
    url: str,
    audio_type: int | None,
) -> None:
    query_params = {
        "secret": get_zlm_secret_cached(),
        "vhost": vhost,
        "app": app,
        "stream": stream,
        "url": url,
    }
    query_params.update(audio_type_to_zlm_params(audio_type))
    try:
        resp = await client.get(f"{ZLM_SERVER}/index/api/addStreamProxy", params=query_params)
        raw = resp.json()
        if raw.get("code") != 0:
            print(f"[addStreamProxy] Failed for {app}/{stream}: {raw.get('msg', raw)}")
        else:
            print(f"[addStreamProxy] OK for {app}/{stream}, key={raw.get('data', {}).get('key', '?')}")
    except Exception as e:
        print(f"[addStreamProxy] Exception for {app}/{stream}: {e}")


async def del_stream_proxy_from_zlm(*, vhost: str, app: str, stream: str) -> None:
    query_params = {"secret": get_zlm_secret_cached()}
    query_params["key"] = stream_proxy_key(vhost, app, stream)
    try:
        await client.get(f"{ZLM_SERVER}/index/api/delStreamProxy", params=query_params)
    except Exception:
        pass


async def wait_for_zlm_ready(max_attempts: int = 30, interval: float = 2.0) -> bool:
    """Block until ZLMediaKit API responds successfully."""
    for attempt in range(1, max_attempts + 1):
        try:
            resp = await client.get(
                f"{ZLM_SERVER}/index/api/getServerConfig",
                params={"secret": get_zlm_secret_cached()},
            )
            if resp.status_code == 200:
                raw = resp.json()
                if raw.get("code") == 0:
                    print(f"[Sync] ZLMediaKit ready after {attempt} attempt(s)")
                    return True
        except Exception:
            pass
        if attempt < max_attempts:
            await asyncio.sleep(interval)
    print("[Sync] ZLMediaKit did not become ready in time — skipping proxy sync")
    return False
