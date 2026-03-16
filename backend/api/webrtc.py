"""
WebRTC signaling API.
"""

from fastapi import APIRouter, Query, Request

from .zlm import ZLM_SERVER, client

router = APIRouter(prefix="/api/webrtc", tags=["Streams"])


@router.post("/play", summary="WebRTC play signaling (proxy to ZLMediaKit)")
async def webrtc_play(
    request: Request,
    app: str = Query(..., description="App name"),
    stream: str = Query(..., description="Stream ID"),
    vhost: str = Query("__defaultVhost__", description="Virtual host"),
):
    """Proxy WebRTC offer SDP to ZLMediaKit and return answer SDP."""
    body = await request.body()
    url = f"{ZLM_SERVER}/index/api/webrtc"
    params = {"vhost": vhost, "app": app, "stream": stream, "type": "play"}
    try:
        resp = await client.post(
            url,
            params=params,
            content=body,
            headers={"Content-Type": "text/plain;charset=utf-8"},
        )
        return resp.json()
    except Exception as e:
        return {"code": -1, "msg": str(e)}
