"""Agent personal access tokens: only the sha256 is stored, the token is shown once.

Tokens are minted inside the backend container, so the secret never passes through HTTP:

    docker exec -i ai-draw-backend python -B -m server.agent_bridge.tokens create --user <name>
"""
import argparse
import hashlib
import json
import secrets
import sys
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from server.models import AgentAccessToken, User

PAT_PREFIX = "aidp_"
MAX_TOKEN_LENGTH = 128
DEFAULT_DAYS = 90
# Writing on every request would turn each read into a commit; minute-level accuracy is enough.
LAST_USED_RESOLUTION = timedelta(minutes=10)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue_token(db: Session, user: User, name: str, days: Optional[int] = DEFAULT_DAYS,
                now: Optional[datetime] = None) -> tuple[AgentAccessToken, str]:
    now = now or datetime.now()
    token = PAT_PREFIX + secrets.token_urlsafe(32)
    record = AgentAccessToken(
        user_id=user.id,
        name=name,
        token_prefix=token[:12],
        token_hash=hash_token(token),
        created_at=now,
        expires_at=now + timedelta(days=days) if days else None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record, token


def user_for_access_token(db: Session, token: str, now: Optional[datetime] = None) -> Optional[User]:
    """Return the active owner of a valid token; revoked or expired tokens and inactive users fail."""
    if not token.startswith(PAT_PREFIX) or len(token) > MAX_TOKEN_LENGTH:
        return None
    record = db.query(AgentAccessToken).filter(AgentAccessToken.token_hash == hash_token(token)).first()
    if record is None or record.revoked_at is not None:
        return None
    now = now or datetime.now()
    if record.expires_at is not None and record.expires_at <= now:
        return None
    user_id = record.user_id
    if record.last_used_at is None or now - record.last_used_at >= LAST_USED_RESOLUTION:
        record.last_used_at = now
        try:
            db.commit()
        except Exception:
            db.rollback()
    # Loaded after the commit so callers that close the session (WebSocket) still read a fresh user.
    return db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712


def _describe(record: AgentAccessToken, username: str) -> dict:
    def stamp(value):
        return value.isoformat(timespec="seconds") if value else None

    return {
        "id": record.id,
        "user": username,
        "name": record.name,
        "prefix": record.token_prefix,
        "created_at": stamp(record.created_at),
        "last_used_at": stamp(record.last_used_at),
        "expires_at": stamp(record.expires_at),
        "revoked_at": stamp(record.revoked_at),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m server.agent_bridge.tokens", description="管理 Agent 个人访问令牌")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("users", help="列出可用账号")
    create = commands.add_parser("create", help="新建令牌；令牌只在输出里出现这一次")
    create.add_argument("--user", required=True)
    create.add_argument("--name", default="agent")
    create.add_argument("--days", type=int, default=DEFAULT_DAYS, help="有效天数，0 表示不过期")
    listing = commands.add_parser("list", help="列出令牌（不含密钥）")
    listing.add_argument("--user")
    revoke = commands.add_parser("revoke", help="吊销令牌")
    target = revoke.add_mutually_exclusive_group(required=True)
    target.add_argument("--id", type=int)
    target.add_argument("--prefix")
    args = parser.parse_args(argv)

    from server.database import Base, SessionLocal, engine

    # The app creates this table at startup; creating it here too keeps the command usable right after a deploy.
    Base.metadata.create_all(bind=engine, tables=[AgentAccessToken.__table__])
    db = SessionLocal()
    try:
        if args.command == "users":
            users = db.query(User).order_by(User.id).all()
            print(json.dumps([{"id": user.id, "username": user.username, "is_active": bool(user.is_active)} for user in users], ensure_ascii=False))
            return 0
        if args.command == "create":
            user = db.query(User).filter(User.username == args.user).first()
            if user is None or not user.is_active:
                print(json.dumps({"error": f"账号不存在或已停用: {args.user}"}, ensure_ascii=False), file=sys.stderr)
                return 1
            record, token = issue_token(db, user, args.name, args.days or None)
            print(json.dumps({**_describe(record, user.username), "token": token}, ensure_ascii=False))
            return 0
        query = db.query(AgentAccessToken, User.username).join(User, User.id == AgentAccessToken.user_id)
        if args.command == "list":
            if args.user:
                query = query.filter(User.username == args.user)
            print(json.dumps([_describe(record, name) for record, name in query.order_by(AgentAccessToken.id)], ensure_ascii=False))
            return 0
        rows = query.filter(
            AgentAccessToken.id == args.id if args.id is not None else AgentAccessToken.token_prefix == args.prefix
        ).all()
        if len(rows) != 1:
            print(json.dumps({"error": "没有找到唯一匹配的令牌"}, ensure_ascii=False), file=sys.stderr)
            return 1
        record, name = rows[0]
        if record.revoked_at is None:
            record.revoked_at = datetime.now()
            db.commit()
        print(json.dumps(_describe(record, name), ensure_ascii=False))
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
