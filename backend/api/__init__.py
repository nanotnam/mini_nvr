"""
API routers for StreamUI.
"""

from .perf import router as perf_router
from .streams import router as streams_router
from .webrtc import router as webrtc_router
from .playback import router as playback_router
from .server import router as server_router

__all__ = [
    "perf_router",
    "streams_router",
    "webrtc_router",
    "playback_router",
    "server_router",
]
