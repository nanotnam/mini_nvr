import asyncio
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db as db_init
from scheduler import cleanup_old_videos

from api import perf_router, streams_router, webrtc_router, playback_router, server_router
from api.jobs import ensure_recording_from_policies, sync_pull_proxies_from_db
from api.zlm import RECORD_ROOT, client


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = AsyncIOScheduler()

    db_init()
    asyncio.create_task(sync_pull_proxies_from_db())

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
    print("[Scheduler] Stopped")


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

# Routers
app.include_router(perf_router)
app.include_router(streams_router)
app.include_router(webrtc_router)
app.include_router(playback_router)
app.include_router(server_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=10801, reload=True)
