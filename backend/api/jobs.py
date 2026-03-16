"""
Background jobs: sync pull proxies, ensure recording from policies.
"""

import asyncio
import time

from db import list_pull_proxies
from db import list_record_policies
from db import upsert_record_policy
from db import upsert_pull_proxy

from .zlm import (
    ZLM_SERVER,
    add_stream_proxy_to_zlm,
    audio_type_to_zlm_params,
    client,
    get_zlm_secret_cached,
    stream_proxy_key,
    wait_for_zlm_ready,
)

_last_record_start_attempt: dict[tuple[str, str, str], float] = {}


async def ensure_recording_from_policies() -> None:
    """Start recording for streams that have a policy but are not recording."""
    global _last_record_start_attempt
    try:
        policies = list_record_policies(enabled_only=True) or []
    except Exception:
        return
    if not policies:
        return

    try:
        response = await client.get(
            f"{ZLM_SERVER}/index/api/getMediaList", params={"secret": get_zlm_secret_cached()}
        )
        raw = response.json()
        if raw.get("code") != 0:
            return
    except Exception:
        return

    media_map: dict[tuple[str, str, str], dict] = {}
    for media in raw.get("data", []) or []:
        if not isinstance(media, dict):
            continue
        vhost = str(media.get("vhost") or "__defaultVhost__")
        app = str(media.get("app") or "")
        stream = str(media.get("stream") or "")
        if not (app and stream):
            continue
        key = (vhost, app, stream)
        agg = media_map.get(key) or {"isRecordingMP4": False}
        if media.get("isRecordingMP4"):
            agg["isRecordingMP4"] = True
        media_map[key] = agg

    now = time.time()
    for policy in policies:
        vhost = str(policy.get("vhost") or "__defaultVhost__")
        app = str(policy.get("app") or "")
        stream = str(policy.get("stream") or "")
        if not (app and stream):
            continue
        key = (vhost, app, stream)
        state = media_map.get(key)
        if not state:
            continue
        if state.get("isRecordingMP4"):
            continue

        last = _last_record_start_attempt.get(key, 0.0)
        if now - last < 60:
            continue
        _last_record_start_attempt[key] = now

        try:
            await client.get(
                f"{ZLM_SERVER}/index/api/startRecord",
                params={
                    "secret": get_zlm_secret_cached(),
                    "vhost": vhost,
                    "app": app,
                    "stream": stream,
                    "type": "1",
                    "max_second": "300",
                },
            )
        except Exception:
            continue


async def sync_pull_proxies_from_db() -> None:
    """Sync pull proxies from DB to ZLMediaKit on startup."""
    if not await wait_for_zlm_ready():
        return

    rows = list_pull_proxies()
    if not rows:
        return

    existing_keys: set[str] = set()
    try:
        query_params = {"secret": get_zlm_secret_cached()}
        response = await client.get(
            f"{ZLM_SERVER}/index/api/listStreamProxy", params=query_params
        )
        raw_data = response.json()
        if raw_data.get("code") == 0:
            for item in raw_data.get("data", []) or []:
                if isinstance(item, dict) and item.get("key"):
                    existing_keys.add(str(item["key"]))
                    continue
                src = (item or {}).get("src") or {}
                vhost = src.get("vhost")
                app = src.get("app")
                stream = src.get("stream")
                if vhost and app and stream:
                    existing_keys.add(stream_proxy_key(vhost, app, stream))
    except Exception:
        existing_keys = set()

    synced = 0
    for row in rows:
        vhost = row["vhost"]
        app = row["app"]
        stream = row["stream"]
        key = stream_proxy_key(vhost, app, stream)
        if key in existing_keys:
            continue

        query_params = {
            "secret": get_zlm_secret_cached(),
            "vhost": vhost,
            "app": app,
            "stream": stream,
            "url": row["url"],
        }
        query_params.update(audio_type_to_zlm_params(row.get("audio_type")))
        try:
            await client.get(
                f"{ZLM_SERVER}/index/api/addStreamProxy", params=query_params
            )
            synced += 1
        except Exception:
            continue

    print(f"[Sync] Synced {synced} pull proxies from DB to ZLMediaKit")
