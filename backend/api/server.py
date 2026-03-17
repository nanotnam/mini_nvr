"""
Server config and restart API.
"""

import asyncio
import socket

import docker

from fastapi import APIRouter, Query, Request

from .zlm import ZLM_SERVER, ZLM_CONTAINER_NAME, STREAMUI_CONTAINER_NAME, client, get_zlm_secret_cached

router = APIRouter(prefix="/api/server", tags=["Config"])


def _get_lan_ip() -> str | None:
    """Return the host's primary LAN IP (for WebRTC externIP)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


@router.get("/lan-ip", summary="Get host LAN IP for WebRTC externIP")
async def get_lan_ip():
    """Return the host's primary LAN IP. Use this for rtc.externIP when WebRTC
    must work from other devices on the same network."""
    ip = _get_lan_ip()
    return {"code": 0, "ip": ip or ""}


@router.get("/config", summary="Get server configuration")
async def get_server_config():
    query_params = {"secret": get_zlm_secret_cached()}
    response = await client.get(
        f"{ZLM_SERVER}/index/api/getServerConfig", params=query_params
    )
    return response.json()


@router.put("/config", summary="Update server configuration")
async def put_server_config(request: Request):
    query_params = dict(request.query_params)
    query_params["secret"] = get_zlm_secret_cached()

    response = await client.get(
        f"{ZLM_SERVER}/index/api/setServerConfig", params=query_params
    )
    return response.json()


@router.get("/restart", summary="Restart ZLMediaKit (and StreamUI)")
async def get_restart_zlm(delay_ms: int = Query(0, description="Delay before restart (ms)")):
    await asyncio.sleep(max(delay_ms, 0) / 1000)

    try:
        dc = docker.DockerClient(base_url="unix://var/run/docker.sock")
        zlm_container = dc.containers.get(ZLM_CONTAINER_NAME)
        zlm_container.restart()

        if STREAMUI_CONTAINER_NAME:

            async def _restart_self():
                try:
                    c = docker.DockerClient(base_url="unix://var/run/docker.sock")
                    self_container = c.containers.get(STREAMUI_CONTAINER_NAME)
                    self_container.restart()
                except Exception:
                    pass

            asyncio.create_task(_restart_self())

        return {
            "code": 0,
            "msg": "Restart successful",
            "via": "docker",
            "restart_self": True,
        }
    except Exception as e:
        return {"code": -1, "msg": "Restart failed", "error": str(e), "via": "docker"}
