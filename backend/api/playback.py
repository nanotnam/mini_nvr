"""
Recording and playback API.
"""

import os
import re
import shutil
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Query

from db import get_record_policy as db_get_record_policy
from db import list_record_policies as db_list_record_policies
from db import upsert_record_policy as db_upsert_record_policy
from utils import get_video_local_time

from .zlm import RECORD_ROOT, ZLM_SERVER, client, get_zlm_secret_cached, LOCAL_TZ

router = APIRouter(prefix="/api/playback", tags=["Recording"])


@router.get("/start-record", summary="Start recording")
async def get_start_record(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
    record_days: str = Query(..., description="Retention days"),
):
    url = f"{ZLM_SERVER}/index/api/startRecord"

    query = {"secret": get_zlm_secret_cached()}
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


@router.get("/stop-record", summary="Stop recording")
async def get_stop_record(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
):
    url = f"{ZLM_SERVER}/index/api/stopRecord"

    query = {"secret": get_zlm_secret_cached()}
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


@router.get("/event-record", summary="Start event-triggered recording")
async def get_event_record(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
    path: str = Query(..., description="Output path, e.g. person/test.mp4"),
    back_ms: str = Query(..., description="Pre-event duration (ms)"),
    forward_ms: str = Query(..., description="Post-event duration (ms)"),
):
    url = f"{ZLM_SERVER}/index/api/startRecordTask"

    query = {"secret": get_zlm_secret_cached()}
    query["vhost"] = str(vhost)
    query["app"] = str(app)
    query["stream"] = str(stream)
    query["path"] = path
    query["back_ms"] = back_ms
    query["forward_ms"] = forward_ms

    response = await client.get(url, params=query)
    return response.json()


@router.get("/streamid-record-list", summary="Get recording info for all streams")
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
        query_params = {"secret": get_zlm_secret_cached(), "vhost": "__defaultVhost__"}
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


@router.get("/streamid-record", summary="Get recordings for a specific stream")
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


@router.delete("/streamid-record", summary="Delete all recordings for a stream")
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
