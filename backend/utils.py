import json
import os
import re
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo(os.getenv("TZ_NAME", "UTC"))


def parse_timestamp_to_local(time_str: str) -> datetime | None:
    """Parse a creation_time string and convert to LOCAL_TZ."""
    if not time_str:
        return None
    try:
        if time_str.endswith("Z"):
            dt = datetime.fromisoformat(time_str[:-1] + "+00:00")
        else:
            dt = datetime.fromisoformat(time_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=LOCAL_TZ)
        return dt.astimezone(LOCAL_TZ)
    except Exception as e:
        print(f"Timestamp parse error: {e}")
        return None


def get_video_local_time(video_path: Path) -> dict | None:
    """
    Extract the time range of a video file using ffprobe.
    Returns: { filename, duration, start, end } or None.
    """
    cmd = [
        "ffprobe",
        "-v",
        "quiet",
        "-show_format",
        "-print_format",
        "json",
        str(video_path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            print(f"ffprobe failed: {video_path}")
            return None

        info = json.loads(result.stdout)
        fmt = info.get("format", {})
        tags = fmt.get("tags", {})

        creation_time_str = tags.get("creation_time")
        start_local = parse_timestamp_to_local(creation_time_str)
        if not start_local:
            print(f"Invalid creation_time: {video_path}")
            return None

        duration_str = fmt.get("duration")
        if not duration_str:
            return None
        try:
            duration = float(duration_str)
        except ValueError:
            return None

        end_local = start_local + timedelta(seconds=duration)

        return {
            "filename": video_path,
            "duration": round(duration, 3),
            "start": start_local.isoformat(),
            "end": end_local.isoformat(),
        }
    except Exception as e:
        print(f"Processing failed {video_path}: {e}")
        return None


def get_video_local_time_from_filename(
    video_path: Path, *, default_duration_seconds: float = 300.0
) -> dict | None:
    filename = video_path.name
    match = re.match(
        r"(\d{4})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})",
        filename,
    )
    if not match:
        return None
    year, month, day, hour, minute, second = map(int, match.groups())
    try:
        start_local = datetime(year, month, day, hour, minute, second, tzinfo=LOCAL_TZ)
    except ValueError:
        return None
    duration = float(default_duration_seconds)
    end_local = start_local + timedelta(seconds=duration)
    return {
        "filename": video_path,
        "duration": round(duration, 3),
        "start": start_local.isoformat(),
        "end": end_local.isoformat(),
    }


def get_zlm_secret(file_path: str) -> str:
    """Read the ZLMediaKit API secret from its config file."""

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Config file not found: {file_path}")

    with open(file_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()

            if not line or line.startswith("#") or line.startswith(";"):
                continue

            if line.startswith("secret"):
                try:
                    secret = line.split("=", 1)[1].strip()
                    if not secret:
                        raise ValueError("secret value is empty")
                    return secret
                except IndexError:
                    raise ValueError("secret config malformed, expected secret=xxx")

    raise ValueError(f"'secret' key not found in config file: {file_path}")


def summarize_existing_recordings(
    *,
    record_root: Path,
    app: str,
    stream: str,
) -> dict | None:
    base_dir = record_root / app / stream
    if not base_dir.exists() or not base_dir.is_dir():
        return None

    date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    dates: list[str] = []
    slice_num = 0
    total_size_bytes = 0

    try:
        for item in base_dir.iterdir():
            if not item.is_dir():
                continue
            if not date_pattern.match(item.name):
                continue
            try:
                mp4_files = [
                    p
                    for p in item.iterdir()
                    if p.is_file() and p.suffix.lower() == ".mp4"
                ]
            except Exception:
                continue
            if not mp4_files:
                continue
            dates.append(item.name)
            slice_num += len(mp4_files)
            for p in mp4_files:
                try:
                    total_size_bytes += p.stat().st_size
                except Exception:
                    continue
    except Exception:
        return None

    if slice_num <= 0 or not dates:
        return None

    dates.sort()
    date_from = dates[0]
    date_to = dates[-1]
    return {
        "has_old_recordings": True,
        "app": app,
        "stream": stream,
        "slice_num": slice_num,
        "total_storage_gb": round(total_size_bytes / (1024**3), 2),
        "date_from": date_from,
        "date_to": date_to,
        "date_count": len(dates),
    }
