import os
import re
import shutil
import asyncio
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
import docker
import psutil
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from db import delete_pull_proxy as db_delete_pull_proxy
from db import delete_record_policy as db_delete_record_policy
from db import get_record_policy as db_get_record_policy
from db import init_db as db_init
from db import list_pull_proxies as db_list_pull_proxies
from db import list_record_policies as db_list_record_policies
from db import upsert_record_policy as db_upsert_record_policy
from db import upsert_pull_proxy as db_upsert_pull_proxy
from scheduler import cleanup_old_videos
from utils import get_video_local_time, get_zlm_secret, summarize_existing_recordings

# =========================================================
# ZLMediaKit base URL
ZLM_SERVER = "http://127.0.0.1:8080"
# ZLMediaKit config path
ZLM_CONFIG_PATH = "/opt/media/conf/config.ini"
# Local recording root path
RECORD_ROOT = Path("/opt/media/bin/www/record")
# Docker container names
ZLM_CONTAINER_NAME = os.getenv("ZLM_CONTAINER_NAME", "zlm-server")
STREAMUI_CONTAINER_NAME = os.getenv("STREAMUI_CONTAINER_NAME", "streamui-web-server")
# Local timezone (used for timestamp parsing)
LOCAL_TZ = ZoneInfo(os.getenv("TZ_NAME", "UTC"))
# =========================================================

_zlm_secret_cache: str | None = None


def _get_zlm_secret_cached() -> str:
    """Return ZLM secret, reading from disk on first call (lazy, so ZLM has time to write config)."""
    global _zlm_secret_cache
    if _zlm_secret_cache is not None:
        return _zlm_secret_cache
    try:
        _zlm_secret_cache = get_zlm_secret(ZLM_CONFIG_PATH)
    except Exception as e:
        print(f"[Warning] Could not read ZLM secret: {e}. API calls will fail until config.ini is available.")
        return ""
    return _zlm_secret_cache

_last_record_start_attempt: dict[tuple[str, str, str], float] = {}


async def ensure_recording_from_policies() -> None:
    try:
        policies = db_list_record_policies(enabled_only=True) or []
    except Exception:
        return
    if not policies:
        return

    try:
        response = await client.get(
            f"{ZLM_SERVER}/index/api/getMediaList", params={"secret": _get_zlm_secret_cached()}
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
                    "secret": _get_zlm_secret_cached(),
                    "vhost": vhost,
                    "app": app,
                    "stream": stream,
                    "type": "1",
                    "max_second": "300",
                },
            )
        except Exception:
            continue


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = AsyncIOScheduler()

    db_init()
    asyncio.create_task(sync_pull_proxies_from_db())

    # Run cleanup on the hour, every hour
    scheduler.add_job(
        cleanup_old_videos,
        kwargs={"path": RECORD_ROOT},
        trigger=CronTrigger(minute=0),
        id="cleanup_videos",
        name="Cleanup old video segments",
        replace_existing=True,
    )
    scheduler.add_job(
        ensure_recording_from_policies,
        trigger=IntervalTrigger(seconds=30),
        id="ensure_recording",
        name="Ensure recording auto-resumes",
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )

    scheduler.start()
    print("[Scheduler] Scheduled jobs started")

    yield

    scheduler.shutdown()
    await client.aclose()
    print("[Scheduler] Scheduled jobs stopped")


PORT_TABLE = """
| Port  | Protocol | Service                                      |
| ----- | -------- | -------------------------------------------- |
| 10800 | TCP      | StreamUI frontend                            |
| 10801 | TCP      | StreamUI backend (FastAPI)                   |
| 1935  | TCP      | RTMP ingest / playback                       |
| 8080  | TCP      | FLV, HLS, TS, fMP4, WebRTC distribution      |
| 8443  | TCP      | HTTPS / WebSocket                            |
| 8554  | TCP      | RTSP                                         |
| 10000 | TCP/UDP  | RTP / RTCP                                   |
| 8000  | UDP      | WebRTC ICE/STUN                              |
| 9000  | UDP      | WebRTC auxiliary port                        |
"""

app = FastAPI(
    title="StreamUI API",
    version="latest",
    description=PORT_TABLE,
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


client = httpx.AsyncClient(
    timeout=5.0,
    limits=httpx.Limits(
        max_connections=10,
        max_keepalive_connections=20,
    ),
)


def _audio_type_to_zlm_params(audio_type: int | None) -> dict[str, str]:
    if audio_type == 0:
        return {"enable_audio": "0", "add_mute_audio": "0"}
    if audio_type == 1:
        return {"enable_audio": "1", "add_mute_audio": "0"}
    if audio_type == 2:
        return {"enable_audio": "1", "add_mute_audio": "1"}
    return {}


def _stream_proxy_key(vhost: str, app: str, stream: str) -> str:
    return f"{vhost}/{app}/{stream}"


async def _add_stream_proxy_to_zlm(
    *,
    vhost: str,
    app: str,
    stream: str,
    url: str,
    audio_type: int | None,
) -> None:
    query_params = {
        "secret": _get_zlm_secret_cached(),
        "vhost": vhost,
        "app": app,
        "stream": stream,
        "url": url,
    }
    query_params.update(_audio_type_to_zlm_params(audio_type))
    try:
        resp = await client.get(f"{ZLM_SERVER}/index/api/addStreamProxy", params=query_params)
        raw = resp.json()
        if raw.get("code") != 0:
            print(f"[addStreamProxy] Failed for {app}/{stream}: {raw.get('msg', raw)}")
        else:
            print(f"[addStreamProxy] OK for {app}/{stream}, key={raw.get('data', {}).get('key', '?')}")
    except Exception as e:
        print(f"[addStreamProxy] Exception for {app}/{stream}: {e}")
        return


async def _del_stream_proxy_from_zlm(*, vhost: str, app: str, stream: str) -> None:
    query_params = {"secret": _get_zlm_secret_cached()}
    query_params["key"] = _stream_proxy_key(vhost, app, stream)
    try:
        await client.get(f"{ZLM_SERVER}/index/api/delStreamProxy", params=query_params)
    except Exception:
        return


async def _wait_for_zlm_ready(max_attempts: int = 30, interval: float = 2.0) -> bool:
    """Block until ZLMediaKit API responds successfully."""
    for attempt in range(1, max_attempts + 1):
        try:
            resp = await client.get(
                f"{ZLM_SERVER}/index/api/getServerConfig",
                params={"secret": _get_zlm_secret_cached()},
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


async def sync_pull_proxies_from_db() -> None:
    if not await _wait_for_zlm_ready():
        return

    rows = db_list_pull_proxies()
    if not rows:
        return

    existing_keys: set[str] = set()
    try:
        query_params = {"secret": _get_zlm_secret_cached()}
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
                    existing_keys.add(_stream_proxy_key(vhost, app, stream))
    except Exception:
        existing_keys = set()

    synced = 0
    for row in rows:
        vhost = row["vhost"]
        app = row["app"]
        stream = row["stream"]
        key = _stream_proxy_key(vhost, app, stream)
        if key in existing_keys:
            continue

        query_params = {
            "secret": _get_zlm_secret_cached(),
            "vhost": vhost,
            "app": app,
            "stream": stream,
            "url": row["url"],
        }
        query_params.update(_audio_type_to_zlm_params(row.get("audio_type")))
        try:
            await client.get(
                f"{ZLM_SERVER}/index/api/addStreamProxy", params=query_params
            )
            synced += 1
        except Exception:
            continue

    print(f"[Sync] Synced {synced} pull proxies from DB to ZLMediaKit")


# =============================================================================


@app.get("/api/perf/statistic", summary="Get object counts", tags=["Performance"])
async def get_statistic():
    query_params = {"secret": _get_zlm_secret_cached()}
    response = await client.get(
        f"{ZLM_SERVER}/index/api/getStatistic", params=query_params
    )
    return response.json()


@app.get("/api/perf/work-threads-load", summary="Get worker thread load", tags=["Performance"])
async def get_work_threads_load():
    query_params = {"secret": _get_zlm_secret_cached()}
    response = await client.get(
        f"{ZLM_SERVER}/index/api/getWorkThreadsLoad", params=query_params
    )
    return response.json()


@app.get("/api/perf/threads-load", summary="Get network thread load", tags=["Performance"])
async def get_threads_load():
    query_params = {"secret": _get_zlm_secret_cached()}
    response = await client.get(
        f"{ZLM_SERVER}/index/api/getThreadsLoad", params=query_params
    )
    return response.json()


@app.get(
    "/api/perf/host-stats",
    summary="Get host system resource usage",
    tags=["Performance"],
)
async def get_host_stats():
    timestamp = datetime.now().strftime("%H:%M:%S")

    cpu_percent = psutil.cpu_percent(interval=None)

    memory = psutil.virtual_memory()
    memory_info = {
        "used": round(memory.used / (1024**3), 2),
        "total": round(memory.total / (1024**3), 2),
    }

    disks: list[dict] = []
    seen_devices: set[str] = set()
    try:
        for part in psutil.disk_partitions(all=False):
            if not part.device or not part.fstype:
                continue
            if not (
                part.device.startswith("/dev/sd")
                or part.device.startswith("/dev/nvme")
                or part.device.startswith("/dev/vd")
            ):
                continue
            if part.device in seen_devices:
                continue
            try:
                usage = psutil.disk_usage(part.mountpoint)
            except PermissionError:
                continue
            seen_devices.add(part.device)
            disks.append(
                {
                    "device": part.device,
                    "mountpoint": part.mountpoint,
                    "fstype": part.fstype,
                    "used": round(usage.used / (1024**3), 2),
                    "total": round(usage.total / (1024**3), 2),
                }
            )
    except Exception:
        disks = []

    if disks:
        total_used = sum(d["used"] for d in disks)
        total_total = sum(d["total"] for d in disks)
        disk_info = {
            "used": round(total_used, 2),
            "total": round(total_total, 2),
        }
    else:
        disk = psutil.disk_usage("/")
        disk_info = {
            "used": round(disk.used / (1024**3), 2),
            "total": round(disk.total / (1024**3), 2),
        }

    net = psutil.net_io_counters()
    net_io = {
        "sent": int(net.bytes_sent),
        "recv": int(net.bytes_recv),
    }

    return {
        "code": 0,
        "data": {
            "time": timestamp,
            "ts_ms": int(datetime.now().timestamp() * 1000),
            "cpu": round(cpu_percent, 2),
            "memory": memory_info,
            "disk": disk_info,
            "disks": disks,
            "net_io": net_io,
        },
    }


# =============================================================================
@app.post("/api/stream/pull-proxy", summary="Add pull-stream proxy", tags=["Streams"])
async def post_pull_proxy(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
    url: str = Query(..., description="Source stream URL"),
    audio_type: int | None = Query(None, description="Audio mode"),
):
    if not re.match(r"^[a-zA-Z0-9._-]+$", app):
        return {
            "code": -1,
            "msg": "app may only contain letters, digits, underscores (_), hyphens (-), or dots (.)",
        }
    if not re.match(r"^[a-zA-Z0-9._-]+$", stream):
        return {
            "code": -1,
            "msg": "stream may only contain letters, digits, underscores (_), hyphens (-), or dots (.)",
        }

    if not any(
        url.startswith(prefix)
        for prefix in ["rtsp://", "rtmp://", "http://", "https://"]
    ):
        return {
            "code": -1,
            "msg": "Source URL must start with rtsp://, rtmp://, http://, or https://",
        }

    db_row = db_upsert_pull_proxy(
        vhost=vhost,
        app=app,
        stream=stream,
        url=url,
        audio_type=audio_type,
    )

    asyncio.create_task(
        _add_stream_proxy_to_zlm(
            vhost=vhost,
            app=app,
            stream=stream,
            url=url,
            audio_type=audio_type,
        )
    )

    warning = summarize_existing_recordings(
        record_root=RECORD_ROOT, app=app, stream=stream
    )
    return {"code": 0, "msg": "Saved, connecting in background", "db": db_row, "warning": warning}


@app.delete("/api/stream/pull-proxy", summary="Delete pull-stream proxy", tags=["Streams"])
async def delete_pull_proxy(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
):
    deleted = db_delete_pull_proxy(vhost=vhost, app=app, stream=stream)
    db_delete_record_policy(vhost=vhost, app=app, stream=stream)
    asyncio.create_task(_del_stream_proxy_from_zlm(vhost=vhost, app=app, stream=stream))
    return {"code": 0, "msg": "Deleted, syncing in background", "db_deleted": deleted}


@app.get(
    "/api/stream/pull-proxy-table",
    summary="Get pull-stream list with online status",
    tags=["Streams"],
)
async def get_pull_proxy_table(
    vhost: str = Query("__defaultVhost__", description="Filter by virtual host"),
    app: str | None = Query(None, description="Filter by app name"),
    stream: str | None = Query(None, description="Filter by stream ID"),
):
    rows = db_list_pull_proxies()
    if vhost:
        rows = [r for r in rows if r.get("vhost") == vhost]
    if app:
        rows = [r for r in rows if app in str(r.get("app", ""))]
    if stream:
        rows = [r for r in rows if stream in str(r.get("stream", ""))]

    repull_count_map: dict[str, int] = {}
    active_stream_map: dict[str, dict] = {}

    try:
        list_params = {"secret": _get_zlm_secret_cached()}
        media_params = {"secret": _get_zlm_secret_cached(), "vhost": vhost}
        list_resp, media_resp = await asyncio.gather(
            client.get(f"{ZLM_SERVER}/index/api/listStreamProxy", params=list_params),
            client.get(f"{ZLM_SERVER}/index/api/getMediaList", params=media_params),
        )

        list_raw = list_resp.json()
        if list_raw.get("code") == 0:
            for item in list_raw.get("data", []) or []:
                src = (item or {}).get("src") or {}
                src_vhost = src.get("vhost")
                src_app = src.get("app")
                src_stream = src.get("stream")
                if not (src_vhost and src_app and src_stream):
                    continue
                key = _stream_proxy_key(src_vhost, src_app, src_stream)
                try:
                    repull_count_map[key] = int(item.get("rePullCount", 0) or 0)
                except Exception:
                    repull_count_map[key] = 0

        media_raw = media_resp.json()
        if media_raw.get("code") == 0:
            for media in media_raw.get("data", []) or []:
                if not isinstance(media, dict):
                    continue
                if media.get("originTypeStr") not in ("pull", "ffmpeg_pull"):
                    continue

                media_vhost = str(media.get("vhost", ""))
                media_app = str(media.get("app", ""))
                media_stream = str(media.get("stream", ""))
                if not (media_vhost and media_app and media_stream):
                    continue

                key = _stream_proxy_key(media_vhost, media_app, media_stream)
                if key not in active_stream_map:
                    active_stream_map[key] = {
                        "vhost": media_vhost,
                        "app": media_app,
                        "stream": media_stream,
                        "originTypeStr": media.get("originTypeStr"),
                        "originUrl": media.get("originUrl"),
                        "originSock": media.get("originSock"),
                        "aliveSecond": media.get("aliveSecond"),
                        "isRecordingMP4": media.get("isRecordingMP4"),
                        "isRecordingHLS": media.get("isRecordingHLS"),
                        "totalReaderCount": media.get("totalReaderCount"),
                        "schemas": [],
                    }

                active_stream_map[key]["schemas"].append(
                    {
                        "schema": media.get("schema"),
                        "bytesSpeed": media.get("bytesSpeed"),
                        "readerCount": media.get("readerCount"),
                        "totalBytes": media.get("totalBytes"),
                        "tracks": media.get("tracks", []),
                    }
                )
    except Exception:
        repull_count_map = {}
        active_stream_map = {}

    data: list[dict] = []
    for row in rows:
        row_vhost = str(row.get("vhost", "__defaultVhost__"))
        row_app = str(row.get("app", ""))
        row_stream = str(row.get("stream", ""))
        key = _stream_proxy_key(row_vhost, row_app, row_stream)
        active = active_stream_map.get(key)
        data.append(
            {
                "vhost": row_vhost,
                "app": row_app,
                "stream": row_stream,
                "url": row.get("url"),
                "audio_type": row.get("audio_type"),
                "rePullCount": repull_count_map.get(key, 0),
                "isOnline": bool(active),
                "totalReaderCount": active.get("totalReaderCount") if active else "-",
                "aliveSecond": active.get("aliveSecond") if active else "-",
                "isRecordingMP4": active.get("isRecordingMP4") if active else "-",
                "schemas": active.get("schemas") if active else "-",
            }
        )

    return {"code": 0, "data": data}


@app.get(
    "/api/stream/streamid-list",
    summary="Get online stream ID list (pull and push)",
    tags=["Streams"],
)
async def get_streamid_list(
    vhost: str = Query("__defaultVhost__", description="Filter by virtual host"),
    schema: str | None = Query(None, description="Filter by schema, e.g. rtsp or rtmp"),
    app: str | None = Query(None, description="Filter by app name"),
    stream: str | None = Query(None, description="Filter by stream ID"),
):
    query_params = {"secret": _get_zlm_secret_cached()}

    if schema:
        query_params["schema"] = schema
    if vhost:
        query_params["vhost"] = vhost
    if app:
        query_params["app"] = app
    if stream:
        query_params["stream"] = stream

    response = await client.get(
        f"{ZLM_SERVER}/index/api/getMediaList", params=query_params
    )
    raw_data = response.json()

    if raw_data["code"] != 0:
        return raw_data

    media_list = raw_data.get("data", [])
    stream_map = {}

    for media in media_list:
        key = (media["vhost"], media["app"], media["stream"])
        if key not in stream_map:
            stream_map[key] = {
                "vhost": media["vhost"],
                "app": media["app"],
                "stream": media["stream"],
                "originTypeStr": media["originTypeStr"],
                "originUrl": media["originUrl"],
                "originSock": media["originSock"],
                "aliveSecond": media["aliveSecond"],
                "isRecordingMP4": media["isRecordingMP4"],
                "isRecordingHLS": media["isRecordingHLS"],
                "totalReaderCount": media["totalReaderCount"],
                "schemas": [],
            }

        stream_map[key]["schemas"].append(
            {
                "schema": media["schema"],
                "bytesSpeed": media["bytesSpeed"],
                "readerCount": media["readerCount"],
                "totalBytes": media["totalBytes"],
                "tracks": media.get("tracks", []),
            }
        )

    result = list(stream_map.values())
    return {"code": 0, "data": result}


@app.delete(
    "/api/stream/streamid", summary="Close an online stream (pull or push)", tags=["Streams"]
)
async def delete_streamid(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
):
    query_params = {"secret": _get_zlm_secret_cached()}
    query_params["vhost"] = str(vhost)
    query_params["app"] = str(app)
    query_params["stream"] = str(stream)
    query_params["force"] = "1"

    response = await client.get(
        f"{ZLM_SERVER}/index/api/close_streams", params=query_params
    )
    return response.json()


# =============================================================================
@app.get("/api/playback/start-record", summary="Start recording", tags=["Recording"])
async def get_start_record(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
    record_days: str = Query(..., description="Retention days"),
):
    url = f"{ZLM_SERVER}/index/api/startRecord"

    query = {"secret": _get_zlm_secret_cached()}
    query["vhost"] = str(vhost)
    query["app"] = str(app)
    query["stream"] = str(stream)
    query["type"] = "1"
    try:
        retention_days = int(record_days)
    except Exception:
        return {"code": -1, "msg": "record_days must be an integer"}
    if retention_days <= 0 or retention_days > 30:
        return {"code": -1, "msg": "Retention days must be between 1 and 30"}

    db_row = db_upsert_record_policy(
        vhost=str(vhost),
        app=str(app),
        stream=str(stream),
        retention_days=retention_days,
        enabled=True,
    )
    query["max_second"] = "300"

    response = await client.get(url, params=query)
    raw = response.json()
    raw["record_policy"] = db_row
    return raw


@app.get("/api/playback/stop-record", summary="Stop recording", tags=["Recording"])
async def get_stop_record(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
):
    url = f"{ZLM_SERVER}/index/api/stopRecord"

    query = {"secret": _get_zlm_secret_cached()}
    query["vhost"] = str(vhost)
    query["app"] = str(app)
    query["stream"] = str(stream)
    query["type"] = "1"

    response = await client.get(url, params=query)
    raw = response.json()
    existing = db_get_record_policy(vhost=str(vhost), app=str(app), stream=str(stream))
    if existing:
        try:
            retention_days = int(existing.get("retention_days", 0) or 0)
        except Exception:
            retention_days = 0
        db_upsert_record_policy(
            vhost=str(vhost),
            app=str(app),
            stream=str(stream),
            retention_days=retention_days,
            enabled=False,
        )
    return raw


@app.get("/api/playback/event-record", summary="Start event-triggered recording", tags=["Recording"])
async def get_event_record(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
    path: str = Query(..., description="Output path, e.g. person/test.mp4"),
    back_ms: str = Query(..., description="Pre-event duration (ms)"),
    forward_ms: str = Query(..., description="Post-event duration (ms)"),
):
    url = f"{ZLM_SERVER}/index/api/startRecordTask"

    query = {"secret": _get_zlm_secret_cached()}
    query["vhost"] = str(vhost)
    query["app"] = str(app)
    query["stream"] = str(stream)
    query["path"] = path
    query["back_ms"] = back_ms
    query["forward_ms"] = forward_ms

    response = await client.get(url, params=query)
    return response.json()


@app.get(
    "/api/playback/streamid-record-list",
    summary="Get recording info for all streams",
    tags=["Recording"],
)
async def get_streamid_record_list():
    result = []

    if not RECORD_ROOT.exists() or not RECORD_ROOT.is_dir():
        return {"code": -1, "msg": f"{RECORD_ROOT} does not exist or is not a directory"}

    date_pattern = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")

    policy_map: dict[tuple[str, str, str], dict] = {}
    try:
        for row in db_list_record_policies(enabled_only=False) or []:
            vhost = str(row.get("vhost") or "__defaultVhost__")
            app_name = str(row.get("app") or "")
            stream_name = str(row.get("stream") or "")
            if not (app_name and stream_name):
                continue
            policy_map[(vhost, app_name, stream_name)] = dict(row)
    except Exception:
        policy_map = {}

    active_keys: set[tuple[str, str, str]] = set()
    recording_map: dict[tuple[str, str, str], bool] = {}
    try:
        query_params = {"secret": _get_zlm_secret_cached(), "vhost": "__defaultVhost__"}
        response = await client.get(
            f"{ZLM_SERVER}/index/api/getMediaList", params=query_params
        )
        raw = response.json()
        if raw.get("code") == 0:
            for media in raw.get("data", []) or []:
                if not isinstance(media, dict):
                    continue
                vhost = str(media.get("vhost") or "__defaultVhost__")
                app_name = str(media.get("app") or "")
                stream_name = str(media.get("stream") or "")
                if not (app_name and stream_name):
                    continue
                key = (vhost, app_name, stream_name)
                active_keys.add(key)
                try:
                    is_recording = bool(media.get("isRecordingMP4"))
                except Exception:
                    is_recording = False
                if is_recording:
                    recording_map[key] = True
                else:
                    recording_map.setdefault(key, False)
    except Exception:
        active_keys = set()
        recording_map = {}

    try:
        for app_name in os.listdir(RECORD_ROOT):
            app_path = RECORD_ROOT / app_name
            if not app_path.is_dir():
                continue

            for stream_name in os.listdir(app_path):
                stream_path = app_path / stream_name
                if not stream_path.is_dir():
                    continue

                total_slices = 0
                total_size_bytes = 0
                dates = set()

                for item in os.listdir(stream_path):
                    item_path = stream_path / item

                    if not item_path.is_dir():
                        continue

                    match = date_pattern.match(item)
                    if not match:
                        continue

                    try:
                        mp4_files = [
                            f
                            for f in os.listdir(item_path)
                            if f.lower().endswith(".mp4")
                        ]
                    except Exception:
                        continue

                    if not mp4_files:
                        try:
                            shutil.rmtree(item_path)
                            print(f"Removed empty recording directory: {item_path}")
                        except Exception as e:
                            print(f"Failed to remove empty directory {item_path}: {e}")
                        continue

                    for fname in mp4_files:
                        file_path = item_path / fname
                        if not file_path.is_file():
                            continue
                        try:
                            size = file_path.stat().st_size
                            total_size_bytes += size
                            total_slices += 1
                        except OSError as e:
                            print(f"Failed to read file size {file_path}: {e}")

                    dates.add(item)

                if total_slices == 0:
                    continue

                policy = (
                    policy_map.get(("__defaultVhost__", app_name, stream_name)) or {}
                )
                try:
                    enabled = int(policy.get("enabled", 0) or 0)
                except Exception:
                    enabled = 0
                record_days = policy.get("retention_days", "-") if enabled == 1 else "-"

                result.append(
                    {
                        "app": app_name,
                        "stream": stream_name,
                        "slice_num": total_slices,
                        "total_storage_gb": round(total_size_bytes / (1024**3), 2),
                        "dates": sorted(dates),
                        "record_days": record_days,
                        "isOnline": ("__defaultVhost__", app_name, stream_name)
                        in active_keys,
                        "isRecordingMP4": recording_map.get(
                            ("__defaultVhost__", app_name, stream_name), False
                        ),
                    }
                )

        return {"code": 0, "data": result}

    except Exception as e:
        return {"code": -1, "msg": f"Directory scan error: {e}"}


@app.get(
    "/api/playback/streamid-record", summary="Get recordings for a specific stream", tags=["Recording"]
)
async def get_streamid_record(
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
    date: str = Query(..., description="Date in YYYY-MM-DD format"),
):
    target_dir = RECORD_ROOT / app / stream / date

    if not target_dir.exists():
        return {"code": 1, "msg": f"Directory not found: {target_dir}"}

    if not target_dir.is_dir():
        return {"code": 1, "msg": f"Path is not a directory: {target_dir}"}

    parsed: list[tuple[Path, datetime]] = []
    fallback_files: list[Path] = []

    for file_path in target_dir.iterdir():
        if not file_path.is_file():
            continue
        if file_path.suffix.lower() != ".mp4":
            continue
        if file_path.name.startswith("."):
            continue

        m = re.match(
            r"(\d{4})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})",
            file_path.name,
        )
        if not m:
            fallback_files.append(file_path)
            continue
        year, month, day, hour, minute, second = map(int, m.groups())
        try:
            start_dt = datetime(
                year, month, day, hour, minute, second, tzinfo=LOCAL_TZ
            )
        except ValueError:
            fallback_files.append(file_path)
            continue
        parsed.append((file_path, start_dt))

    parsed.sort(key=lambda x: x[1])

    results: list[dict] = []
    default_duration = 300.0
    for i, (file_path, start_dt) in enumerate(parsed):
        duration = default_duration
        if i + 1 < len(parsed):
            next_start = parsed[i + 1][1]
            delta = (next_start - start_dt).total_seconds()
            if 1 <= delta <= 600:
                duration = float(delta)
        end_dt = start_dt + timedelta(seconds=duration)

        try:
            rel_path = file_path.relative_to(RECORD_ROOT)
        except ValueError:
            continue

        results.append(
            {
                "filename": str(rel_path),
                "duration": round(duration, 3),
                "start": start_dt.isoformat(),
                "end": end_dt.isoformat(),
            }
        )

    for file_path in fallback_files:
        data = get_video_local_time(file_path)
        if not data:
            continue
        try:
            rel_path = file_path.relative_to(RECORD_ROOT)
            data["filename"] = str(rel_path)
        except ValueError:
            continue
        results.append(data)

    results.sort(key=lambda x: x["start"])

    return {"code": 0, "data": results}


@app.delete(
    "/api/playback/streamid-record", summary="Delete all recordings for a stream", tags=["Recording"]
)
async def delete_streamid_record(
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
):
    base_dir = RECORD_ROOT / app / stream

    if not base_dir.exists():
        return {"code": -1, "msg": f"Directory not found: {base_dir}"}

    if not base_dir.is_dir():
        return {"code": -1, "msg": f"Path is not a directory: {base_dir}"}

    date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")

    deleted_count = 0

    for item in base_dir.iterdir():
        if item.is_dir() and date_pattern.match(item.name):
            shutil.rmtree(item)
            deleted_count += 1

    return {"code": 0, "msg": f"Deleted {deleted_count} recording directories"}


# =============================================================================


@app.get("/api/server/config", summary="Get server configuration", tags=["Config"])
async def get_server_config():
    query_params = {"secret": _get_zlm_secret_cached()}
    response = await client.get(
        f"{ZLM_SERVER}/index/api/getServerConfig", params=query_params
    )
    return response.json()


@app.put("/api/server/config", summary="Update server configuration", tags=["Config"])
async def put_server_config(request: Request):
    query_params = dict(request.query_params)
    query_params["secret"] = _get_zlm_secret_cached()

    response = await client.get(
        f"{ZLM_SERVER}/index/api/setServerConfig", params=query_params
    )
    return response.json()


@app.get(
    "/api/server/restart",
    summary="Restart ZLMediaKit (and StreamUI)",
    tags=["Config"],
)
async def get_restart_zlm(delay_ms: int = Query(0, description="Delay before restart (ms)")):
    await asyncio.sleep(max(delay_ms, 0) / 1000)

    try:
        client = docker.DockerClient(base_url="unix://var/run/docker.sock")
        zlm_container = client.containers.get(ZLM_CONTAINER_NAME)
        zlm_container.restart()

        if STREAMUI_CONTAINER_NAME:

            async def _restart_self():
                try:
                    c = docker.DockerClient(base_url="unix://var/run/docker.sock")
                    self_container = c.containers.get(STREAMUI_CONTAINER_NAME)
                    self_container.restart()
                except Exception:
                    return

            asyncio.create_task(_restart_self())

        return {
            "code": 0,
            "msg": "Restart successful",
            "via": "docker",
            "restart_self": True,
        }
    except Exception as e:
        return {"code": -1, "msg": "Restart failed", "error": str(e), "via": "docker"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=10801, reload=True)
