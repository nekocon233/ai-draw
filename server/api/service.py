"""
服务状态管理 API
"""
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
import hashlib
import json
import os
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Any

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.auth import get_current_user
from server.database import get_db
from server.models import WorkflowDefinition, User
from server.schemas import ServiceStatusResponse
from server.workflow_sync import sync_workflows_from_directory
from server.utils.model_options import get_model_options, get_model_options_meta

router = APIRouter(prefix="/service", tags=["服务管理"])


def _require_workflow_admin(user: User = Depends(get_current_user)) -> User:
    configured = os.environ.get("WORKFLOW_ADMIN_USERS", "")
    allowed = [u.strip() for u in configured.split(",") if u.strip()]
    if allowed and user.username not in allowed:
        raise HTTPException(status_code=403, detail="无权限管理工作流")
    return user


def _normalize_json_text(json_text: str) -> str:
    obj = json.loads(json_text)
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _content_hash(workflow_json: str, metadata: dict) -> str:
    payload = json.dumps(
        {"workflow": json.loads(workflow_json), "metadata": metadata},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class WorkflowUpsertRequest(BaseModel):
    key: str
    label: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    requires_image: bool = False
    generator_type: Optional[str] = None
    parameters: list[dict] = []
    bindings: list[dict] = []
    workflow_json: str
    output_node_title: Optional[str] = None


def _safe_key_to_filename(key: str) -> str:
    safe = "".join(ch if (ch.isalnum() or ch in ("-", "_")) else "_" for ch in key)
    if not safe:
        safe = "workflow"
    return f"{safe}.json"


def _write_workflow_file(key: str, workflow_json: str) -> None:
    config = get_config()
    workflows_dir = config.paths.workflows
    if not workflows_dir:
        return
    os.makedirs(workflows_dir, exist_ok=True)
    filename = _safe_key_to_filename(key)
    target = os.path.join(workflows_dir, filename)
    tmp = f"{target}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(workflow_json)
    os.replace(tmp, target)


def _detect_saveimage_titles(workflow_dict: dict) -> list[str]:
    titles: list[str] = []
    for node in workflow_dict.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") != "SaveImage":
            continue
        meta = node.get("_meta") or {}
        title = meta.get("title")
        if title:
            titles.append(str(title))
    return titles


def _is_api_format_workflow(workflow_dict: dict) -> bool:
    if not isinstance(workflow_dict, dict):
        return False
    if isinstance(workflow_dict.get("nodes"), list):
        return False
    for node in workflow_dict.values():
        if isinstance(node, dict) and node.get("class_type"):
            return True
    return False


def _detect_model_loader_from_workflow_dict(workflow_dict: dict) -> str | None:
    try:
        has_unet = False
        has_checkpoint = False
        for node in workflow_dict.values():
            if not isinstance(node, dict):
                continue
            class_type = node.get("class_type")
            if class_type == "UNETLoader":
                has_unet = True
            elif class_type in ("CheckpointLoaderSimple", "CheckpointLoader"):
                has_checkpoint = True
        if has_unet and has_checkpoint:
            return "both"
        if has_unet:
            return "unet"
        if has_checkpoint:
            return "checkpoint"
        return "none"
    except Exception:
        return None


def _detect_supports_lora_from_workflow_dict(workflow_dict: dict) -> bool:
    try:
        lora_nodes = {
            "LoraLoader",
            "LoraLoaderModelOnly",
            "LoRALoader",
            "LoRALoaderModelOnly",
            "PCLazyLoraLoader",
        }
        for node in workflow_dict.values():
            if not isinstance(node, dict):
                continue
            class_type = node.get("class_type")
            if class_type in lora_nodes:
                return True
        return False
    except Exception:
        return False


def _filter_parameters(parameters: list[dict], *, supports_lora: bool) -> list[dict]:
    if supports_lora:
        return parameters
    out: list[dict] = []
    for p in parameters or []:
        try:
            if isinstance(p, dict) and p.get("name") == "lora_prompt":
                continue
        except Exception:
            pass
        out.append(p)
    return out


def _ensure_output_node_title(workflow_dict: dict, requested: Optional[str]) -> tuple[dict, str]:
    if requested:
        return workflow_dict, requested

    titles = _detect_saveimage_titles(workflow_dict)
    if titles:
        return workflow_dict, titles[0]

    for node in workflow_dict.values():
        if not isinstance(node, dict):
            continue
        if node.get("class_type") != "SaveImage":
            continue
        meta = node.get("_meta")
        if not isinstance(meta, dict):
            meta = {}
            node["_meta"] = meta
        meta["title"] = "保存图像"
        return workflow_dict, "保存图像"

    return workflow_dict, "保存图像"


@router.get("/status", response_model=ServiceStatusResponse)
async def get_service_status(service: AIDrawService = Depends(get_ai_draw_service)) -> ServiceStatusResponse:
    """获取服务状态"""
    return ServiceStatusResponse(
        available=service.is_service_available,
        message="服务正常" if service.is_service_available else "服务不可用"
    )


@router.post("/start")
async def start_service(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """启动服务"""
    await service.start_service()
    return {"success": True, "message": "服务已启动"}


@router.post("/stop")
async def stop_service(service: AIDrawService = Depends(get_ai_draw_service)) -> dict:
    """停止服务"""
    await service.stop_service()
    return {"success": True, "message": "服务已停止"}


@router.get("/workflows")
async def get_available_workflows(
    service: AIDrawService = Depends(get_ai_draw_service),
    db: Session = Depends(get_db),
) -> dict:
    """获取可用的工作流列表和默认工作流"""
    try:
        sync_workflows_from_directory()
    except Exception:
        pass
    try:
        rows = (
            db.query(WorkflowDefinition)
            .filter(WorkflowDefinition.enabled == True)
            .order_by(WorkflowDefinition.is_custom.asc(), WorkflowDefinition.key.asc())
            .all()
        )
    except Exception:
        rows = []

    if rows:
        workflows = []
        for row in rows:
            try:
                parameters = json.loads(row.parameters_json) if row.parameters_json else []
            except Exception:
                parameters = []
            model_loader = None
            supports_lora = False
            try:
                workflow_dict = json.loads(row.workflow_json) if row.workflow_json else None
                if isinstance(workflow_dict, dict):
                    model_loader = _detect_model_loader_from_workflow_dict(workflow_dict)
                    supports_lora = _detect_supports_lora_from_workflow_dict(workflow_dict)
            except Exception:
                model_loader = None
                supports_lora = False
            parameters = _filter_parameters(parameters, supports_lora=supports_lora)
            workflows.append({
                "key": row.key,
                "label": row.label or row.key,
                "description": row.description or "",
                "requires_image": bool(row.requires_image),
                "parameters": parameters,
                "model_loader": model_loader,
                "supports_lora": supports_lora,
            })
        return {
            "workflows": workflows,
            "default_workflow": service.get_current_workflow()
        }

    from utils.config_loader import get_config
    config = get_config()
    
    # 获取所有工作流及其元数据
    workflows = []
    for workflow_key in service.get_available_workflows():
        metadata = config.workflow_defaults.workflow_metadata.get(workflow_key, {})
        model_loader = None
        supports_lora = False
        try:
            template = await service.comfyui.get_workflow_template_dict(workflow_key)
            if isinstance(template, dict):
                model_loader = _detect_model_loader_from_workflow_dict(template)
                supports_lora = _detect_supports_lora_from_workflow_dict(template)
        except Exception:
            model_loader = None
            supports_lora = False
        parameters = _filter_parameters(metadata.get("parameters", []), supports_lora=supports_lora)
        workflows.append({
            "key": workflow_key,
            "label": metadata.get("label", workflow_key),
            "description": metadata.get("description", ""),
            "requires_image": metadata.get("requires_image", False),
            "parameters": parameters,
            "model_loader": model_loader,
            "supports_lora": supports_lora,
        })
    
    return {
        "workflows": workflows,
        "default_workflow": service.get_current_workflow()
    }


@router.get("/model-options")
async def get_model_options_api() -> dict:
    options = get_model_options()
    meta = get_model_options_meta()
    return {
        "checkpoints": options.checkpoints,
        "loras": options.loras,
        "unets": options.unets,
        "source": meta.get("source", "unknown"),
        "counts": meta.get("counts", {}),
    }


@router.post("/inspect-workflow")
async def inspect_workflow(file: UploadFile = File(...)) -> dict:
    try:
        raw = await file.read()
        text = None
        for encoding in ("utf-8", "gbk"):
            try:
                text = raw.decode(encoding)
                break
            except Exception:
                continue
        if text is None:
            text = raw.decode("utf-8", errors="ignore")

        workflow = json.loads(text)
        if not isinstance(workflow, dict):
            raise ValueError("workflow JSON 顶层必须是对象")

        if isinstance(workflow.get("nodes"), list):
            return {"format": "ui", "nodes": [], "output_node_titles": []}

        output_node_titles = _detect_saveimage_titles(workflow)

        nodes = []
        for node_id, node in workflow.items():
            if not isinstance(node, dict):
                continue
            meta = node.get("_meta") or {}
            node_title = meta.get("title") or node.get("class_type") or str(node_id)
            inputs_obj = node.get("inputs") or {}
            inputs = list(inputs_obj.keys()) if isinstance(inputs_obj, dict) else []
            nodes.append({
                "node_id": str(node_id),
                "node_title": node_title,
                "class_type": node.get("class_type"),
                "inputs": inputs,
            })

        nodes.sort(key=lambda n: (n["node_title"] or "", n["node_id"]))
        return {"format": "api", "nodes": nodes, "output_node_titles": output_node_titles}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"解析工作流失败: {str(e)}")


@router.post("/sync-workflows")
async def sync_workflows(
    user: User = Depends(_require_workflow_admin),
) -> dict:
    try:
        result = sync_workflows_from_directory()
        return {"success": True, "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workflow-definitions")
async def list_workflow_definitions(
    db: Session = Depends(get_db),
    user: User = Depends(_require_workflow_admin),
) -> dict:
    rows = (
        db.query(WorkflowDefinition)
        .order_by(WorkflowDefinition.is_custom.desc(), WorkflowDefinition.key.asc())
        .all()
    )
    items = []
    for row in rows:
        try:
            parameters = json.loads(row.parameters_json) if row.parameters_json else []
        except Exception:
            parameters = []
        try:
            bindings = json.loads(row.bindings_json) if row.bindings_json else []
        except Exception:
            bindings = []
        items.append({
            "key": row.key,
            "label": row.label,
            "description": row.description,
            "enabled": bool(row.enabled),
            "requires_image": bool(row.requires_image),
            "generator_type": row.generator_type,
            "parameters": parameters,
            "bindings": bindings,
            "output_node_title": row.output_node_title,
            "is_custom": bool(row.is_custom),
            "builtin_version": row.builtin_version,
            "content_hash": row.content_hash,
            "updated_at": row.updated_at.timestamp() if row.updated_at else None,
        })
    return {"items": items}


@router.get("/workflow-definitions/{workflow_key}")
async def get_workflow_definition(
    workflow_key: str,
    db: Session = Depends(get_db),
    user: User = Depends(_require_workflow_admin),
) -> dict:
    row = db.query(WorkflowDefinition).filter(WorkflowDefinition.key == workflow_key).first()
    if not row:
        raise HTTPException(status_code=404, detail="工作流不存在")
    try:
        parameters = json.loads(row.parameters_json) if row.parameters_json else []
    except Exception:
        parameters = []
    try:
        bindings = json.loads(row.bindings_json) if row.bindings_json else []
    except Exception:
        bindings = []
    return {
        "key": row.key,
        "label": row.label,
        "description": row.description,
        "enabled": bool(row.enabled),
        "requires_image": bool(row.requires_image),
        "generator_type": row.generator_type,
        "parameters": parameters,
        "bindings": bindings,
        "workflow_json": row.workflow_json,
        "output_node_title": row.output_node_title,
        "is_custom": bool(row.is_custom),
        "builtin_version": row.builtin_version,
        "content_hash": row.content_hash,
        "updated_at": row.updated_at.timestamp() if row.updated_at else None,
    }


@router.post("/workflow-definitions")
async def create_workflow_definition(
    req: WorkflowUpsertRequest,
    db: Session = Depends(get_db),
    user: User = Depends(_require_workflow_admin),
) -> dict:
    existing = db.query(WorkflowDefinition).filter(WorkflowDefinition.key == req.key).first()
    if existing:
        raise HTTPException(status_code=409, detail="工作流 key 已存在")

    workflow_dict = json.loads(req.workflow_json)
    if not isinstance(workflow_dict, dict):
        raise HTTPException(status_code=400, detail="workflow_json 顶层必须是对象")
    if not _is_api_format_workflow(workflow_dict):
        raise HTTPException(status_code=400, detail="不支持该工作流 JSON 格式，请导出 ComfyUI 的 API 格式（workflow_api.json）")
    workflow_dict, output_node_title = _ensure_output_node_title(workflow_dict, req.output_node_title)
    normalized_workflow_json = json.dumps(workflow_dict, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    generator_type = req.generator_type or ("i2i" if req.requires_image else "t2i")
    metadata = {
        "label": req.label,
        "description": req.description,
        "requires_image": req.requires_image,
        "generator_type": generator_type,
        "parameters": req.parameters,
        "bindings": req.bindings,
        "output_node_title": output_node_title,
    }
    row = WorkflowDefinition(
        key=req.key,
        label=req.label or req.key,
        description=req.description or "",
        enabled=True if req.enabled is None else bool(req.enabled),
        requires_image=bool(req.requires_image),
        generator_type=generator_type,
        parameters_json=json.dumps(req.parameters, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        bindings_json=json.dumps(req.bindings, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        workflow_json=normalized_workflow_json,
        output_node_title=output_node_title,
        is_custom=True,
        builtin_version=None,
        content_hash=_content_hash(normalized_workflow_json, metadata),
    )
    db.add(row)
    db.commit()
    try:
        _write_workflow_file(row.key, normalized_workflow_json)
    except Exception:
        pass
    return {"success": True, "key": row.key}


@router.put("/workflow-definitions/{workflow_key}")
async def update_workflow_definition(
    workflow_key: str,
    req: WorkflowUpsertRequest,
    db: Session = Depends(get_db),
    user: User = Depends(_require_workflow_admin),
) -> dict:
    row = db.query(WorkflowDefinition).filter(WorkflowDefinition.key == workflow_key).first()
    if not row:
        raise HTTPException(status_code=404, detail="工作流不存在")

    workflow_dict = json.loads(req.workflow_json)
    if not isinstance(workflow_dict, dict):
        raise HTTPException(status_code=400, detail="workflow_json 顶层必须是对象")
    if not _is_api_format_workflow(workflow_dict):
        raise HTTPException(status_code=400, detail="不支持该工作流 JSON 格式，请导出 ComfyUI 的 API 格式（workflow_api.json）")
    workflow_dict, output_node_title = _ensure_output_node_title(workflow_dict, req.output_node_title)
    normalized_workflow_json = json.dumps(workflow_dict, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    generator_type = req.generator_type or ("i2i" if req.requires_image else "t2i")
    metadata = {
        "label": req.label,
        "description": req.description,
        "requires_image": req.requires_image,
        "generator_type": generator_type,
        "parameters": req.parameters,
        "bindings": req.bindings,
        "output_node_title": output_node_title,
    }

    row.label = req.label or row.key
    row.description = req.description or ""
    if req.enabled is not None:
        row.enabled = bool(req.enabled)
    row.requires_image = bool(req.requires_image)
    row.generator_type = generator_type
    row.parameters_json = json.dumps(req.parameters, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    row.bindings_json = json.dumps(req.bindings, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    row.workflow_json = normalized_workflow_json
    row.output_node_title = output_node_title
    if row.is_custom:
        row.builtin_version = None
    row.content_hash = _content_hash(normalized_workflow_json, metadata)
    db.commit()
    try:
        if row.is_custom:
            _write_workflow_file(row.key, normalized_workflow_json)
    except Exception:
        pass
    return {"success": True, "key": row.key}


@router.delete("/workflow-definitions/{workflow_key}")
async def delete_workflow_definition(
    workflow_key: str,
    db: Session = Depends(get_db),
    user: User = Depends(_require_workflow_admin),
) -> dict:
    row = db.query(WorkflowDefinition).filter(WorkflowDefinition.key == workflow_key).first()
    if not row:
        raise HTTPException(status_code=404, detail="工作流不存在")
    if row.is_custom:
        db.delete(row)
        db.commit()
        return {"success": True}
    row.enabled = False
    db.commit()
    return {"success": True}
