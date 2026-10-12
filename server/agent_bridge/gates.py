"""Review gates: an agent asks a question about a session; the user picks results there and submits.

Picks may come from any assistant round of the gate's session, including rounds the user generated
by hand and rounds the agent posted. They are re-resolved on submit, so deleted results cannot slip through.
"""
import uuid
from typing import Optional

from sqlalchemy.orm import Session

from server.models import ChatMessage, GeneratedImage, ReviewGate
from utils.media_file_references import canonical_upload_url, storage_path_variants

GATE_OPEN = "open"
GATE_SUBMITTED = "submitted"
GATE_CANCELLED = "cancelled"
GATE_STATUSES = (GATE_OPEN, GATE_SUBMITTED, GATE_CANCELLED)
MAX_PICKS_LIMIT = 32


class GateError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def new_gate_id() -> str:
    return f"gate-{uuid.uuid4().hex}"


def _ms(value) -> Optional[int]:
    return int(value.timestamp() * 1000) if value else None


def serialize_gate(gate: ReviewGate) -> dict:
    return {
        "gate_id": gate.gate_id,
        "session_id": gate.session_id,
        "job": gate.job,
        "step": gate.step,
        "question": gate.question,
        "min_picks": gate.min_picks,
        "max_picks": gate.max_picks,
        "rounds": list(gate.rounds or []),
        "status": gate.status,
        "decision": gate.decision,
        "picks": list(gate.picks or []),
        "note": gate.note or "",
        "cancel_reason": gate.cancel_reason,
        "created_at": _ms(gate.created_at),
        "updated_at": _ms(gate.updated_at),
        "submitted_at": _ms(gate.submitted_at),
    }


def normalize_limits(min_picks: int, max_picks: int) -> tuple[int, int]:
    """A gate with max_picks 0 only asks for confirmation; otherwise min must not exceed max."""
    if max_picks == 0:
        return 0, 0
    if min_picks > max_picks:
        raise GateError(422, "最少选择数不能大于最多选择数")
    return min_picks, max_picks


def resolve_pick(db: Session, user_id: int, session_id: str, url: str, message_id: Optional[str] = None) -> Optional[dict]:
    """Find the stored result behind a URL inside this user's session; None when it is not there."""
    canonical = canonical_upload_url(url)
    if not canonical:
        return None
    query = db.query(GeneratedImage, ChatMessage.message_id).join(
        ChatMessage, ChatMessage.message_id == GeneratedImage.message_id,
    ).filter(
        ChatMessage.user_id == user_id,
        ChatMessage.session_id == session_id,
        ChatMessage.type == "assistant",
        GeneratedImage.file_path.in_(storage_path_variants(canonical)),
    )
    if message_id:
        query = query.filter(ChatMessage.message_id == message_id)
    row = query.order_by(ChatMessage.created_at.desc(), GeneratedImage.image_index.asc()).first()
    if row is None:
        return None
    image, reply_id = row
    return {"url": canonical, "message_id": reply_id, "image_index": image.image_index, "seed": image.seed}


def resolve_picks(db: Session, gate: ReviewGate, picks: list[dict]) -> list[dict]:
    resolved = []
    seen = set()
    for pick in picks:
        item = resolve_pick(db, gate.user_id, gate.session_id, pick["url"], pick.get("message_id"))
        if item is None:
            raise GateError(422, "所选结果不在本会话中，或已被删除")
        key = (item["message_id"], item["url"])
        if key not in seen:
            seen.add(key)
            resolved.append(item)
    return resolved


def require_open(gate: ReviewGate) -> None:
    if gate.status != GATE_OPEN:
        raise GateError(409, "这个审核已经结束")


def check_pick_count(gate: ReviewGate, count: int, decision: Optional[str] = None) -> None:
    if gate.max_picks == 0 and count:
        raise GateError(422, "这个审核只需确认，不用选择结果")
    if count > gate.max_picks:
        raise GateError(422, f"最多只能选 {gate.max_picks} 个结果")
    if decision == "approve" and count < gate.min_picks:
        raise GateError(422, f"至少要选 {gate.min_picks} 个结果")
