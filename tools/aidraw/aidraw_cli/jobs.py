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
