"""
Stream management API: pull proxies, stream list, WebRTC, close stream.
"""

import asyncio
import re

from fastapi import APIRouter, Query, Request

from db import delete_pull_proxy as db_delete_pull_proxy
from db import delete_record_policy as db_delete_record_policy
from db import list_pull_proxies as db_list_pull_proxies
from db import upsert_pull_proxy as db_upsert_pull_proxy
from utils import summarize_existing_recordings

from .zlm import (
    RECORD_ROOT,
    ZLM_SERVER,
    add_stream_proxy_to_zlm,
    client,
    del_stream_proxy_from_zlm,
    get_zlm_secret_cached,
    stream_proxy_key,
)

router = APIRouter(prefix="/api/stream", tags=["Streams"])


@router.post("/pull-proxy", summary="Add pull-stream proxy")
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
        add_stream_proxy_to_zlm(
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


@router.delete("/pull-proxy", summary="Delete pull-stream proxy")
async def delete_pull_proxy(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
):
    deleted = db_delete_pull_proxy(vhost=vhost, app=app, stream=stream)
    db_delete_record_policy(vhost=vhost, app=app, stream=stream)
    asyncio.create_task(del_stream_proxy_from_zlm(vhost=vhost, app=app, stream=stream))
    return {"code": 0, "msg": "Deleted, syncing in background", "db_deleted": deleted}


@router.get("/pull-proxy-table", summary="Get pull-stream list with online status")
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
        list_params = {"secret": get_zlm_secret_cached()}
        media_params = {"secret": get_zlm_secret_cached(), "vhost": vhost}
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
                key = stream_proxy_key(src_vhost, src_app, src_stream)
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

                key = stream_proxy_key(media_vhost, media_app, media_stream)
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
        key = stream_proxy_key(row_vhost, row_app, row_stream)
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


@router.get("/streamid-list", summary="Get online stream ID list (pull and push)")
async def get_streamid_list(
    vhost: str = Query("__defaultVhost__", description="Filter by virtual host"),
    schema: str | None = Query(None, description="Filter by schema, e.g. rtsp or rtmp"),
    app: str | None = Query(None, description="Filter by app name"),
    stream: str | None = Query(None, description="Filter by stream ID"),
):
    query_params = {"secret": get_zlm_secret_cached()}

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


@router.delete("/streamid", summary="Close an online stream (pull or push)")
async def delete_streamid(
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
):
    query_params = {"secret": get_zlm_secret_cached()}
    query_params["vhost"] = str(vhost)
    query_params["app"] = str(app)
    query_params["stream"] = str(stream)
    query_params["force"] = "1"

    response = await client.get(
        f"{ZLM_SERVER}/index/api/close_streams", params=query_params
    )
    return response.json()
