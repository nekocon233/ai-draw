"""Session rounds beyond a single read: list every round (telling the agent's media from the user's) and delete the
agent's own posts.

The user edits in the web UI append their results to the round they started from (编辑帧 exports, 编辑 images,
背景处理, 放大), and they may generate whole rounds by hand. The job log records every URL the agent generated or
posted, so anything else in the session is the user's.
"""
from . import jobs
from .client import Client
from .config import session_link
from .errors import CliError, EXIT_USAGE
from .generate import fetch_round

def agent_media(job: str) -> set[str]:
    return set(jobs.agent_sources(job))


def run_round_list(args, config: dict, client: Client) -> tuple[dict, int]:
    if args.user_only and not args.job:
        raise CliError("--user-only 需要 --job：靠任务日志区分 agent 和用户的结果", EXIT_USAGE)
    outline = client.json("GET", f"/api/chat/sessions/{args.session}/outline")
    known = agent_media(args.job) if args.job else None
    rounds = []
    for item in outline.get("rounds", []):
        reply_id = f"{item['id']}-reply"
        media = [url for url in item.get("media") or [] if isinstance(url, str)]
        if (item.get("media_count") or 0) > len(media):  # the outline shows only the first few per round
            media = [url for url in (fetch_round(client, args.session, reply_id) or {}).get("images", [])
                     if isinstance(url, str)]
        entries = [{"index": index, "url": url} for index, url in enumerate(media)]
        if known is not None:
            for entry in entries:
                entry["by"] = "agent" if entry["url"] in known else "user"
        if args.user_only:
            entries = [entry for entry in entries if entry["by"] == "user"]
            if not entries:
                continue
        rounds.append({"message_id": item["id"], "reply_id": reply_id, "workflow": item.get("workflow"),
                       "content": item.get("content"), "timestamp": item.get("timestamp"), "media": entries})
    return {"ok": True, "session_id": args.session, "rounds": rounds, "link": session_link(config, args.session)}, 0


def run_round_delete(args, config: dict, client: Client) -> tuple[dict, int]:
    """Only rounds this job posted: generations and the user's own work are never deleted from here."""
    message_id = args.message.removesuffix("-reply")
    posted = {record.get("message_id") for record in jobs.read(args.job)
              if record.get("event") == "post" and record.get("session_id") == args.session}
    if message_id not in posted:
        raise CliError("只能删除 agent 自己发的帖子：任务日志里没有这条 post 记录", EXIT_USAGE)
    client.json("DELETE", f"/api/chat/sessions/{args.session}/messages/{message_id}")
    jobs.append(args.job, "round_deleted", step=args.step, session_id=args.session, message_id=message_id)
    return {"ok": True, "session_id": args.session, "message_id": message_id, "deleted": True}, 0
