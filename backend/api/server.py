"""
Server config and restart API.
"""

import asyncio
import os
import socket

import docker

from fastapi import APIRouter, Query, Request

from .zlm import (
    ZLM_CONTAINER_NAME,
    ZLM_SERVER,
    STREAMUI_CONTAINER_NAME,
    client,
    get_zlm_secret_cached,
)

router = APIRouter(prefix="/api/server", tags=["Config"])

# Host ports for ZLMediaKit (must match docker-compose port mappings)
ZLM_HTTP_PORT = int(os.getenv("ZLM_HTTP_PORT", "8080"))
ZLM_RTSP_PORT = int(os.getenv("ZLM_RTSP_PORT", "8554"))
ZLM_RTMP_PORT = int(os.getenv("ZLM_RTMP_PORT", "1935"))
ZLM_RTC_PORT = int(os.getenv("ZLM_RTC_PORT", "8000"))


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


@router.get("/ports", summary="Get ZLM host ports for stream URLs")
async def get_ports():
    """Return the configured host ports for ZLMediaKit. Use these when building
    stream URLs so they work when ports are changed in docker-compose."""
    return {
        "code": 0,
        "http": ZLM_HTTP_PORT,
        "rtsp": ZLM_RTSP_PORT,
        "rtmp": ZLM_RTMP_PORT,
        "rtc": ZLM_RTC_PORT,
    }


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
