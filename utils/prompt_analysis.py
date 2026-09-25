"""Image-to-text descriptions using the same LLM connection as prompt generation."""
from utils.llm import LanguageModel


def describe_image(image: str, description: str) -> str:
    return LanguageModel().complete(
        "请分析这张图片，只生成以下要求的提示词：" + description.strip(),
        system=("你是专业的 AI 图像生成提示词工程师。请用中文自然语言描述图片，"
                "准确表达主体、动作、镜头、构图和风格。只输出提示词本身，不要解释、标题或序号。"),
        images=[image],
    )
