"""Job logs: one JSON object per line, so an agent can resume a multi-step job in a later session."""
import json
from datetime import datetime
from pathlib import Path
from typing import Optional


def append(job: Optional[str], event: str, **fields) -> None:
    if not job:
        return
    path = Path(job)
    path.parent.mkdir(parents=True, exist_ok=True)
    record = {"ts": datetime.now().astimezone().isoformat(timespec="seconds"), "event": event, **fields}
    with path.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record, ensure_ascii=False) + "\n")


AGENT_EVENTS = ("gen", "post")  # events whose URLs the agent produced (picks in gate results may be the user's)


def agent_sources(job: str) -> dict[str, str]:
    """URL → the event that produced it ("gen" or "post"); anything else in the session is the user's."""
    sources = {}
    for record in read(job):
        if record.get("event") not in AGENT_EVENTS:
            continue
        for item in (record.get("images") or []) + (record.get("media") or []):
            url = item.get("url") if isinstance(item, dict) else item
            if isinstance(url, str):
                sources[url] = record["event"]
    return sources


def read(job: str) -> list[dict]:
    path = Path(job)
    if not path.exists():
        return []
    records = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                records.append(json.loads(line))
            except ValueError:
                continue
    return records
