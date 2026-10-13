"""Review gates from the agent's side: ask a question in a session, wait for the user's choice, read or close it."""
import time
from pathlib import Path
from typing import Optional

from . import jobs
from .client import Client
from .config import session_link
from .errors import CliError, EXIT_CANCELLED, EXIT_TIMEOUT
from .generate import log


def _question(args) -> str:
    text = Path(args.question_file).read_text(encoding="utf-8") if args.question_file else (args.question or "")
    if not text.strip():
        raise CliError("需要 --question 或 --question-file")
    return text.strip()


def run_gate_open(args, config: dict, client: Client) -> tuple[dict, int]:
    job_name = args.job_name or (Path(args.job).stem if args.job else None)
    body = {
        "session_id": args.session,
        "question": _question(args),
        "job": job_name,
        "step": args.step,
        "min_picks": args.min,
        "max_picks": args.max,
        "rounds": args.round or None,
        "replace_open": args.replace,
    }
    gate = client.json("POST", "/api/agent/gates", json={key: value for key, value in body.items() if value is not None})
    jobs.append(args.job, "gate_open", step=args.step, session_id=args.session, gate_id=gate["gate_id"],
                question=gate["question"], min_picks=gate["min_picks"], max_picks=gate["max_picks"])
    link = session_link(config, args.session)
    if args.wait:
        return wait_gate(client, config, gate["gate_id"], timeout=args.timeout, download=args.download,
                         quiet=args.quiet, job=args.job, step=args.step)
    return {"ok": True, "gate": gate, "link": link, "wait": f"aidraw gate wait {gate['gate_id']}"}, 0


def acknowledge(client: Client, gate_id: str) -> None:
    """Mark the user's answer bubble 「Agent 已收到」; older servers without the route are fine."""
    try:
        client.request("POST", f"/api/agent/gates/{gate_id}/ack", allow=(404, 405, 409))
    except CliError:
        pass


def wait_gate(client: Client, config: dict, gate_id: str, *, timeout: float, download: Optional[str],
              quiet: bool, job: Optional[str], step: Optional[str]) -> tuple[dict, int]:
    started = time.monotonic()
    interval = max(0.05, float(config.get("gate_poll_seconds", 3)))
    announced = False
    while True:
        response = client.request("GET", f"/api/agent/gates/{gate_id}", allow=(404,))
        if response.status_code == 404:
            jobs.append(job, "gate_result", step=step, gate_id=gate_id, status="missing")
            raise CliError("审核不存在了（会话可能已被删除）", EXIT_CANCELLED, gate_id=gate_id)
        gate = response.json()
        if gate["status"] != "open":
            break
        if not announced:
            log(f"等你在网页里审核：{session_link(config, gate['session_id'])}", quiet)
            announced = True
        if time.monotonic() - started >= timeout:
            raise CliError(f"等了 {int(timeout)} 秒，审核还没提交", EXIT_TIMEOUT, gate_id=gate_id,
                           resume=f"aidraw gate wait {gate_id}", link=session_link(config, gate["session_id"]))
        time.sleep(interval)

    if gate["status"] == "submitted":
        acknowledge(client, gate_id)
    picks = [dict(pick) for pick in gate.get("picks") or []]
    if job:
        # Tell the agent's own media (a generation, or a posted asset: "this one is fine") from the user's edits.
        sources = jobs.agent_sources(job)
        for pick in picks:
            pick["by"] = "agent" if pick["url"] in sources else "user"
            if pick["url"] in sources:
                pick["source"] = sources[pick["url"]]
    if download and gate["status"] == "submitted":
        for index, pick in enumerate(picks, start=1):
            target = Path(download).expanduser() / f"pick_{index:02d}_{Path(pick['url']).name}"
            client.download(pick["url"], target)
            pick["file"] = str(target)
    payload = {
        "ok": gate["status"] == "submitted",
        "gate_id": gate["gate_id"],
        "session_id": gate["session_id"],
        "status": gate["status"],
        "decision": gate.get("decision"),
        "note": gate.get("note") or "",
        "picks": picks,
        "cancel_reason": gate.get("cancel_reason"),
        "link": session_link(config, gate["session_id"]),
    }
    jobs.append(job, "gate_result", step=step or gate.get("step"), **{
        key: payload[key] for key in ("gate_id", "status", "decision", "note", "picks", "cancel_reason")})
    return payload, 0 if gate["status"] == "submitted" else EXIT_CANCELLED


def run_gate_wait(args, config: dict, client: Client) -> tuple[dict, int]:
    return wait_gate(client, config, args.gate_id, timeout=args.timeout, download=args.download,
                     quiet=args.quiet, job=args.job, step=args.step)


def run_gate_get(args, config: dict, client: Client) -> tuple[dict, int]:
    gate = client.json("GET", f"/api/agent/gates/{args.gate_id}")
    return {"ok": True, "gate": gate, "link": session_link(config, gate["session_id"])}, 0


def run_gate_list(args, config: dict, client: Client) -> tuple[dict, int]:
    params = {"session_id": args.session, "status": args.status, "limit": args.limit}
    data = client.json("GET", "/api/agent/gates", params={key: value for key, value in params.items() if value})
    return {"ok": True, "gates": data.get("gates", [])}, 0


def run_gate_cancel(args, config: dict, client: Client) -> tuple[dict, int]:
    gate = client.json("POST", f"/api/agent/gates/{args.gate_id}/cancel", json={"reason": args.reason or ""})
    jobs.append(args.job, "gate_result", step=gate.get("step"), gate_id=gate["gate_id"], status="cancelled",
                cancel_reason=gate.get("cancel_reason"))
    return {"ok": True, "gate": gate}, 0


def run_gate_submit(args, config: dict, client: Client) -> tuple[dict, int]:
    """Record a choice the user stated in chat; never decide on the user's behalf."""
    body: dict = {"decision": args.decision, "note": args.note or ""}
    if args.pick:
        body["picks"] = [{"url": url} for url in args.pick]
    gate = client.json("POST", f"/api/agent/gates/{args.gate_id}/submit", json=body)
    acknowledge(client, gate["gate_id"])  # the agent recorded it, so it has obviously read it
    jobs.append(args.job, "gate_result", step=gate.get("step"), gate_id=gate["gate_id"], status=gate["status"],
                decision=gate.get("decision"), note=gate.get("note"), picks=gate.get("picks"), source="chat")
    return {"ok": True, "gate": gate}, 0
