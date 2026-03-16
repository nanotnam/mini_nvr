# Mini NVR

A minimal, self-hosted Network Video Recorder (NVR) built on top of
[ZLMediaKit](https://github.com/ZLMediaKit/ZLMediaKit).
Designed for local deployment on edge devices such as NVIDIA Jetson, Raspberry Pi,
or any Linux machine with Docker.

![Dashboard](assets/home.png)

---

## Features

| Feature | Description |
|---|---|
| Pull streams | Ingest RTSP / RTMP / HLS / FLV / TS streams from IP cameras or other sources |
| Push streams | Accept RTSP / RTMP / RTP push streams from FFmpeg, OBS, or cameras |
| Video wall | 1x1 / 2x2 / 3x3 multi-screen live view with fullscreen support |
| Recording | Continuous MP4 recording with configurable retention (1-30 days) and auto-resume |
| Playback | Timeline-based playback with seek-by-click and per-segment download |
| Dashboard | Real-time CPU / memory / disk / bandwidth charts and ZLM thread load |
| Settings | Manage ZLMediaKit protocol toggles, codec options, and recording parameters via UI |
| API Docs | Built-in Swagger / OpenAPI documentation at `:10801/docs` |

---

## Screenshots

| Login | Pull Streams | Video Wall |
|---|---|---|
| ![Login](assets/login.png) | ![Pull Streams](assets/pull-stream.png) | ![Video Wall](assets/video-wall.png) |

---

## Architecture

```
Browser (:10800)
   │
   └── Nginx (port 10800)
        ├── Static frontend files  (Vue 3 SPA, no build step)
        ├── /record/  →  MP4 recording files (served directly)
        └── /api/     →  FastAPI backend (port 10801)
                            │
                            ├── ZLMediaKit HTTP API (:8080)
                            ├── SQLite DB  (pull_proxy + record_policy tables)
                            ├── APScheduler
                            │     ├── hourly  : delete expired MP4 segments
                            │     └── 30 s    : auto-resume recording for enabled policies
                            └── Docker API (restart ZLM + StreamUI containers)

ZLMediaKit container (zlm-server):
  RTMP :1935 | HTTP :8080 | HTTPS :8443 | RTSP :8554
  RTP  :10000 (TCP+UDP)   | WebRTC :8000/:9000 (UDP)
  Writes MP4 recordings → ./record/
  Reads/writes config   → ./conf/config.ini
```

![Architecture](assets/arch.png)

---

## Port reference

| Port | Protocol | Service |
|------|----------|---------|
| 10800 | TCP | StreamUI frontend (Nginx) |
| 10801 | TCP | StreamUI backend (FastAPI) |
| 1935 | TCP | RTMP ingest / playback |
| 8080 | TCP | ZLMediaKit HTTP — FLV, HLS, TS, fMP4, WebRTC |
| 8443 | TCP | ZLMediaKit HTTPS / WSS |
| 8554 | TCP | RTSP ingest / playback |
| 10000 | TCP+UDP | RTP / RTCP |
| 8000 | UDP | WebRTC ICE / STUN |
| 9000 | UDP | WebRTC auxiliary |

---

## Prerequisites

- **Docker** >= 20.10 and **Docker Compose** (v2 plugin or standalone)
- Ports listed above must be available on the host
- (Optional) A `.env` file for timezone configuration

---

## Quick start

```bash
# 1. Clone the repository
git clone https://github.com/<your-org>/mini_nvr.git
cd mini_nvr

# 2. (Optional) Set your timezone
echo "TZ_NAME=Asia/Ho_Chi_Minh" > .env

# 3. Build and launch
docker compose up -d --build

# 4. Open the web UI
#    http://<host-ip>:10800
#    Default password: streamui
```

### First-time startup

On the very first launch ZLMediaKit generates a default `config.ini` inside `./conf/`.
StreamUI waits for ZLMediaKit to become ready before syncing pull proxies from the
database, so streams saved from a previous session are automatically re-registered.

---

## Configuration

### Timezone

Recording timestamps and scheduler jobs use the `TZ_NAME` environment variable.
Set it to a valid [IANA timezone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones):

```bash
# Inline
TZ_NAME=America/New_York docker compose up -d

# Or via .env file (next to docker-compose.yaml)
echo "TZ_NAME=Europe/London" > .env
docker compose up -d
```

### Bind-mounted directories

Both `./conf/` and `./record/` are bind-mounted into the containers and persist
across container restarts and image rebuilds.

| Host path | Container path | Contents |
|-----------|---------------|---------|
| `./conf/` | `/opt/media/conf/` | ZLMediaKit `config.ini` and related files |
| `./record/` | `/opt/media/bin/www/record/` | MP4 recording segments organised as `app/stream/YYYY-MM-DD/*.mp4` |

### ZLMediaKit settings

Navigate to **Settings** in the web UI to configure:

- Protocol toggles (RTSP, RTMP, HLS, HTTP-TS, HTTP-fMP4)
- On-demand vs always-on protocol registration
- Audio processing mode
- Direct proxy mode for non-standard codecs
- H.264/H.265 RTP packing mode
- Recording buffer size, fastStart, fMP4 format
- GOP cache count
- And more

Clicking **Apply Settings** writes the config, restarts ZLMediaKit, then reloads the page.

---

## Usage

### Pulling a stream (RTSP camera, etc.)

1. Go to **Pull Streams** and click **Add**
2. Enter the source URL, e.g. `rtsp://admin:password@192.168.1.100:554/stream1`
3. Set an **App Name** (default `live`) and a unique **Stream ID**
4. Choose an audio mode and submit
5. The stream will appear in the table; once ZLMediaKit connects to the source the
   status icon turns green

> **Tip:** If the icon stays red, check that the source URL is reachable from the
> Docker host. The ZLM container uses Docker bridge networking by default, so local
> network addresses should be accessible. Check the backend logs for
> `[addStreamProxy]` messages.

### Pushing a stream (FFmpeg, OBS, etc.)

Push a local file or camera feed to StreamUI via RTSP, RTMP, or RTP.
Go to **Push Streams** and click **Help** for example FFmpeg commands:

```bash
# RTSP push (TCP)
ffmpeg -re -i ./test.mp4 -vcodec h264 -acodec aac \
  -f rtsp -rtsp_transport tcp rtsp://<host-ip>:8554/live/mystream

# RTMP push
ffmpeg -re -i ./test.mp4 -vcodec h264 -acodec aac \
  -f flv rtmp://<host-ip>:1935/live/mystream

# RTP push (MPEG-TS over RTP)
ffmpeg -re -i ./test.mp4 -vcodec h264 -acodec aac \
  -f rtp_mpegts rtp://<host-ip>:10000
```

### Video wall

Go to **Video Wall**, choose a layout (1x1, 2x2, 3x3), click **Select** on any
cell, then pick an online stream from the tree. Supports fullscreen mode.

### Recording and playback

- **Start recording:** Toggle the recording switch on a stream row (Pull Streams
  or Push Streams page) and set the retention period (1-30 days).
- **Auto-resume:** The scheduler checks every 30 seconds and restarts recording for
  any stream that has an active recording policy but is not currently recording.
- **Playback:** Go to **Playback**, click **View** on a stream, select a date, and
  use the timeline to seek. Click **Download segment** to save the current segment.
- **Cleanup:** An hourly job deletes segments older than the configured retention
  period.

### Previewing a stream

Click **Preview** on any stream row to open an in-browser player.
The player prefers **WebRTC** for low-latency playback and falls back to **HTTP-fMP4**
if WebRTC fails (e.g. stream unavailable, NAT/firewall blocking UDP).

- If the stream is **online** and WebRTC or fMP4 is enabled, playback starts (WebRTC first).
- If the stream is **offline**, the player retries with exponential backoff until the
  stream comes online.
- If the stream is online but neither **WebRTC nor HTTP-fMP4** is enabled, a message
  prompts you to enable one in Settings.
- For **cross-network WebRTC** (browser on a different machine), configure `rtc.externIP`
  in ZLMediaKit config to the host's reachable IP.

### Distribution URLs

Once a stream is online you can consume it via any enabled protocol:

| Protocol | URL pattern |
|----------|-------------|
| RTSP | `rtsp://<host>:8554/<app>/<stream>` |
| RTMP | `rtmp://<host>:1935/<app>/<stream>` |
| HLS (mpegts) | `http://<host>:8080/<app>/<stream>/hls.m3u8` |
| HLS (fMP4) | `http://<host>:8080/<app>/<stream>/hls.fmp4.m3u8` |
| HTTP-TS | `http://<host>:8080/<app>/<stream>.live.ts` |
| HTTP-fMP4 | `http://<host>:8080/<app>/<stream>.live.mp4` |
| WebRTC | Via `/index/api/webrtc?app=<app>&stream=<stream>&type=play` (SDP exchange) |

---

## Project structure

```
mini_nvr/
├── backend/                # FastAPI application
│   ├── api/                # API routers
│   │   ├── perf.py         # Performance / host stats
│   │   ├── streams.py      # Pull proxies, stream list, close stream
│   │   ├── webrtc.py       # WebRTC signaling proxy
│   │   ├── playback.py     # Recording, playback, delete recordings
│   │   ├── server.py       # Config, restart
│   │   ├── zlm.py          # ZLMediaKit client + helpers
│   │   └── jobs.py         # Sync pull proxies, ensure recording
│   ├── db/                 # SQLite helpers (schema, CRUD)
│   │   ├── __init__.py
│   │   └── sqlite.py
│   ├── main.py             # App entry, lifespan, router registration
│   ├── scheduler.py        # APScheduler jobs (cleanup old segments)
│   └── utils.py            # Timezone helpers, ffprobe wrapper, config reader
├── frontend/               # Static web UI served by Nginx
│   ├── assets/             # Vue 3, ECharts, SVG icons
│   │   ├── vue.global.prod.js  # Vue 3.5 production build
│   │   ├── echarts.min.js
│   │   ├── logo.svg
│   │   ├── signal.svg
│   │   └── nosignal.svg
│   ├── css/
│   │   └── app.css         # All styling (sidebar, cards, tables, modals, etc.)
│   ├── js/
│   │   ├── app.js          # Vue app shell, hash routing, shared components
│   │   └── pages/
│   │       ├── dashboard.js    # 7 ECharts charts with polling
│   │       ├── pull-streams.js # Pull proxy table, add/preview/delete/record
│   │       ├── push-streams.js # Push stream table, preview/close/record
│   │       ├── video-wall.js   # Multi-screen grid, stream selector
│   │       ├── playback.js     # Recording table, timeline player
│   │       └── settings.js     # ZLMediaKit config form
│   ├── index.html          # SPA shell (loads Vue + all page components)
│   ├── login.html          # Login gate (password: 123456a@)
│   ├── nginx.conf
│   └── mime.types
├── assets/                 # Screenshots and architecture diagram
├── conf/                   # ZLMediaKit config (bind-mounted)
├── record/                 # MP4 recordings (bind-mounted)
├── Dockerfile              # streamui-web-server image
├── docker-compose.yaml
├── start.sh                # Container entrypoint (Nginx + Uvicorn)
└── README.md
```

---

## API reference

StreamUI exposes a REST API on port **10801**. Full interactive documentation is
available at `http://<host>:10801/docs` (Swagger UI).

### Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/stream/pull-proxy` | Add or update a pull-stream proxy |
| `DELETE` | `/api/stream/pull-proxy` | Remove a pull-stream proxy |
| `GET` | `/api/stream/pull-proxy-table` | List pull proxies with online status |
| `GET` | `/api/stream/streamid-list` | List all online streams |
| `DELETE` | `/api/stream/streamid` | Force-close an online stream |
| `GET` | `/api/playback/start-record` | Start recording a stream |
| `GET` | `/api/playback/stop-record` | Stop recording a stream |
| `GET` | `/api/playback/streamid-record-list` | List all streams with recordings |
| `GET` | `/api/playback/streamid-record` | List recording segments for a date |
| `DELETE` | `/api/playback/streamid-record` | Delete all recordings for a stream |
| `GET` | `/api/perf/host-stats` | Host CPU / memory / disk / network stats |
| `GET` | `/api/server/config` | Read ZLMediaKit config |
| `PUT` | `/api/server/config` | Write ZLMediaKit config |
| `GET` | `/api/server/restart` | Restart ZLMediaKit + StreamUI containers |

---

## Troubleshooting

### Stream shows as offline after adding

- **Check source reachability:** Make sure the RTSP/RTMP URL is reachable from the
  Docker host. Test with `ffprobe rtsp://...` on the host.
- **Check logs:** Run `docker compose logs -f streamui-web-server` and look for
  `[addStreamProxy]` messages. A `Failed` message means ZLMediaKit rejected the
  request (wrong secret, bad URL, etc.).
- **ZLM not ready on startup:** StreamUI waits up to 60 seconds for ZLMediaKit to
  become responsive. If ZLM takes longer, previously saved proxies will not be
  synced. Restart StreamUI after ZLM is ready:
  `docker compose restart streamui-web-server`
- **Firewall / NAT:** The ZLM container uses Docker bridge networking. Ensure the
  RTSP source is not blocked by firewall rules.

### Preview shows "Enable HTTP-fMP4 distribution in Settings first"

This means the stream is online but the HTTP-fMP4 protocol is disabled. Go to
**Settings**, enable **HTTP-fMP4 distribution**, and click **Apply Settings**.

### H.265 (HEVC) streams won't play in the browser

This is a browser limitation, not a StreamUI bug. Most browsers (Chrome, Firefox,
Edge) do not support H.265/HEVC in `<video>` tags. Safari on macOS/iOS has partial
support. Workarounds:

- **Transcode to H.264** on the source or with FFmpeg before pushing.
- **Use VLC or ffplay** with the RTSP/RTMP distribution URL instead of the browser
  preview.
- **Enable RTSP direct proxy** in Settings to forward the original codec untouched
  to compatible players.

### Preview shows "Stream offline, waiting for connection..."

The stream is not yet connected. The player will automatically retry with
exponential backoff. If the source comes online, playback starts automatically.

### Recordings not appearing

- Ensure recording is enabled (toggle switch on the stream row).
- Ensure the `./record/` directory is writable by the containers.
- ZLMediaKit writes 5-minute MP4 segments. The first segment may take up to
  5 minutes to appear.

### Login page keeps appearing

The login session expires after 3 days. Clear `localStorage` or log in again.
The default password is `123456a@`.

---

## Tech stack

| Component | Role |
|-----------|------|
| [ZLMediaKit](https://github.com/ZLMediaKit/ZLMediaKit) | High-performance media server (C++) |
| [FastAPI](https://fastapi.tiangolo.com/) | Python async REST API backend |
| [Nginx](https://nginx.org/) | Static file server + reverse proxy |
| [SQLite](https://www.sqlite.org/) | Lightweight embedded database |
| [APScheduler](https://apscheduler.readthedocs.io/) | Task scheduling (cleanup, auto-resume) |
| [Vue 3](https://vuejs.org/) | Frontend UI framework (CDN, no build step) |
| [Apache ECharts](https://echarts.apache.org/) | Dashboard charts |
| [Docker](https://www.docker.com/) | Containerised deployment |

---

## License

See [LICENSE](LICENSE) for details.
