"""Resolve user-visible references without changing saved generation parameters."""
import re
from typing import Literal, Sequence

REMOVED_IMAGE_MENTION = "@图片已移除"
IMAGE_MENTION = re.compile(r"(?<![A-Za-z0-9_@.])@图片([0-9]+)(?![0-9A-Za-z_])|<image([0-9]+)>")


def image_mention_tokens(prompt: str) -> set[str]:
    return {match.group(0) for match in IMAGE_MENTION.finditer(prompt)}


def validate_image_mentions(prompt: str, references: Sequence[str | None]) -> None:
    if REMOVED_IMAGE_MENTION in prompt:
        raise ValueError("引用的图片已移除，请重新选择图片或删除该引用。")
    for match in IMAGE_MENTION.finditer(prompt):
        index = int(match.group(1) or match.group(2))
        if not 1 <= index <= min(3, len(references)) or not references[index - 1]:
            raise ValueError(f"图片{index}不存在，请先添加参考图或修改引用。")


def resolve_image_mentions(prompt: str, references: Sequence[str | None], style: Literal["qwen", "ordinal"]) -> str:
    validate_image_mentions(prompt, references)
    positions = {}
    for slot, image in enumerate(references, 1):
        if image:
            positions[slot] = len(positions) + 1

    def replace(match: re.Match) -> str:
        index = positions[int(match.group(1) or match.group(2))]
        return f"<image{index}>" if style == "qwen" else f"第{index}张参考图"

    return IMAGE_MENTION.sub(replace, prompt)
