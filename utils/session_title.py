"""使用 OpenAI 兼容接口生成简短会话标题。"""
import re
from functools import lru_cache

from utils.llm import LanguageModel


def fallback_session_title(content: str) -> str:
    text = re.sub(r"\s+", " ", content).strip()
    text = re.sub(r"^(用户|助手)\s*[:：]\s*", "", text)
    if not text:
        return "新对话"
    return text[:10]


def clean_session_title(value: str, fallback: str) -> str:
    title = value.strip().splitlines()[0] if value.strip() else ""
    title = re.sub(r"^(标题|会话标题)\s*[:：]\s*", "", title)
    title = title.strip(" \t\"'“”‘’《》【】[]。！？!?，,")
    return (title or fallback)[:10]


class SessionTitleGenerator:
    def __init__(self) -> None:
        self.llm = LanguageModel()

    def generate(self, content: str) -> str:
        fallback = fallback_session_title(content)
        if not self.llm.api_key:
            return fallback

        try:
            value = self.llm.complete(
                content[:12000],
                system="你是会话标题生成器。根据用户的创作需求生成一个简洁中文标题，概括主体和任务，控制在4到10个汉字，不加引号、句号、前缀或解释。",
                max_tokens=40,
            )
            return clean_session_title(value, fallback)
        except Exception as error:
            print(f"[SessionTitle] 标题总结失败，使用本地标题: {error}")
            return fallback


@lru_cache(maxsize=1)
def get_session_title_generator() -> SessionTitleGenerator:
    return SessionTitleGenerator()
