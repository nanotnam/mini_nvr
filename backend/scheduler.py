import re
from datetime import datetime
from pathlib import Path

from db import list_record_policies


def parse_filename_time(filename: str) -> datetime:
    """
    Extract a datetime from a filename like 2025-09-22-17-31-15-0.mp4.
    Returns datetime.min if the pattern does not match.
    """
    match = re.match(
        r"(\d{4})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})", filename
    )
    if match:
        year, month, day, hour, minute, second = map(int, match.groups())
        try:
            return datetime(year, month, day, hour, minute, second)
        except ValueError:
            return datetime.min
    return datetime.min


def cleanup_old_videos(path: Path):
    """
    Scan all app/stream directories under path and delete old .mp4 segments
    according to the retention policy stored in the database.
    """
    print(
        f"[Scheduler {datetime.now()}] Scanning {path} for old video segments..."
    )

    if not path.exists():
        print(f"[Scheduler Error] Recording root not found: {path}")
        return

    if not path.is_dir():
        print(f"[Scheduler Error] Path is not a directory: {path}")
        return

    try:
        rows = list_record_policies(enabled_only=True)
    except Exception:
        rows = []
    if not rows:
        print(f"[Scheduler {datetime.now()}] No enabled retention policies found, skipping cleanup.")
        return

    total_deleted = 0

    date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    safe_seconds = 15 * 60

    for row in rows:
        app_name = str(row.get("app", "")).strip()
        stream_name = str(row.get("stream", "")).strip()
        if not (app_name and stream_name):
            continue

        try:
            retention_days = int(row.get("retention_days", 0) or 0)
        except Exception:
            retention_days = 0
        if retention_days <= 0:
            continue

        keep_videos = retention_days * 24 * 12
        stream_path = path / app_name / stream_name
        if not stream_path.exists() or not stream_path.is_dir():
            continue

        video_files: list[Path] = []
        now_ts = datetime.now().timestamp()
        for p in stream_path.rglob("*.mp4"):
            if not p.is_file():
                continue
            if p.name.startswith("."):
                continue
            try:
                if now_ts - p.stat().st_mtime < safe_seconds:
                    continue
            except Exception:
                continue
            if parse_filename_time(p.name) == datetime.min:
                continue
            video_files.append(p)
        if len(video_files) <= keep_videos:
            continue

        sorted_files = sorted(
            video_files,
            key=lambda f: parse_filename_time(f.name),
            reverse=True,
        )
        for file_path in sorted_files[keep_videos:]:
            try:
                file_path.unlink()
                relative_path = file_path.relative_to(path)
                print(f"[Scheduler {datetime.now()}] Deleted old segment: {relative_path}")
                total_deleted += 1
            except Exception as e:
                print(f"[Scheduler Error] Delete failed {file_path}: {e}")

        for item in stream_path.iterdir():
            if not item.is_dir():
                continue
            if not date_pattern.match(item.name):
                continue
            try:
                has_mp4 = any(
                    p.is_file() and p.suffix.lower() == ".mp4" for p in item.iterdir()
                )
                if not has_mp4:
                    item.rmdir()
            except Exception:
                continue

    print(
        f"[Scheduler {datetime.now()}] Cleanup complete. Deleted {total_deleted} old segments."
    )
