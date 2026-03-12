"""
AI Prompt 生成相关 API
"""
from fastapi import APIRouter, HTTPException, Depends

from server.ai_draw_service import AIDrawService, get_ai_draw_service
from server.schemas import GeneratePromptRequest, GeneratePromptResponse

router = APIRouter(prefix="/prompt", tags=["Prompt生成"])


@router.post("/generate", response_model=GeneratePromptResponse)
async def generate_prompt(
    request: GeneratePromptRequest,
    service: AIDrawService = Depends(get_ai_draw_service)
) -> GeneratePromptResponse:
    """根据中文描述生成英文 Prompt"""
    try:
        prompt = await service.generate_prompt(request.description, request.workflow_id)
        return GeneratePromptResponse(prompt=prompt)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
