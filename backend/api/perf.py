"""
Performance and host stats API.
"""

from datetime import datetime

import psutil

from fastapi import APIRouter

from .zlm import ZLM_SERVER, client, get_zlm_secret_cached

router = APIRouter(prefix="/api/perf", tags=["Performance"])


@router.get("/statistic", summary="Get object counts")
async def get_statistic():
    query_params = {"secret": get_zlm_secret_cached()}
    response = await client.get(
        f"{ZLM_SERVER}/index/api/getStatistic", params=query_params
    )
    return response.json()


@router.get("/work-threads-load", summary="Get worker thread load")
async def get_work_threads_load():
    query_params = {"secret": get_zlm_secret_cached()}
    response = await client.get(
        f"{ZLM_SERVER}/index/api/getWorkThreadsLoad", params=query_params
    )
    return response.json()


@router.get("/threads-load", summary="Get network thread load")
async def get_threads_load():
    query_params = {"secret": get_zlm_secret_cached()}
    response = await client.get(
        f"{ZLM_SERVER}/index/api/getThreadsLoad", params=query_params
    )
    return response.json()


@router.get("/host-stats", summary="Get host system resource usage")
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
