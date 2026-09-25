from utils.config_loader import get_ai_prompt_config
from utils.llm import LanguageModel
from utils.image_mentions import IMAGE_MENTION, REMOVED_IMAGE_MENTION, image_mention_tokens

# 生成时后端会再把预设拼在描述前面，所以预设只作为系统上下文，不交给模型扩写
PRESET_CONTEXT = (
    "用户已选择提示词预设，生成时系统会自动把预设原文加在用户描述前面。"
    "以下预设原文只用于理解任务意图，不属于要扩写的描述：\n{preset}\n"
    "扩写规则：只扩写用户描述本身，不要复述、改写或扩写预设内容，也不要提及用户描述中没有的图片编号；"
    "不要新增与预设冲突的内容，用户描述中的每项要求都保留原意。"
)


class AIPrompt:
    def __init__(self, prompt_template=None):
        # 从配置加载 AI Prompt 设置
        config = get_ai_prompt_config()

        self.llm = LanguageModel()
        self.api_key = self.llm.api_key
        self.url = self.llm.base_url
        self.model = self.llm.model
        self.prompt_template = prompt_template or config.template
        self.client = self.llm.client

    def generate(self, natural_desc: str, template: str | None = None, preset: str = "") -> str:
        active_template = template if template is not None else self.prompt_template
        prompt = active_template.format(desc=natural_desc)
        if REMOVED_IMAGE_MENTION in natural_desc:
            raise ValueError("引用的图片已移除，请重新选择图片或删除该引用。")
        mentions = image_mention_tokens(natural_desc)
        if mentions:
            prompt += "\n图片引用规则：原样保留以下引用标记及其对应关系，不改写、删除或新增引用标记：" + "、".join(sorted(mentions))
        # 预设里的引用改成普通文字，避免模型把它们抄进扩写结果
        preset_text = IMAGE_MENTION.sub(lambda match: f"图片{match.group(1) or match.group(2)}", preset.strip())
        system = PRESET_CONTEXT.format(preset=preset_text) if preset_text else None
        result = self.llm.complete(prompt, system=system)
        if mentions and (image_mention_tokens(result) != mentions or REMOVED_IMAGE_MENTION in result):
            raise ValueError("提示词扩写改变了图片引用，请重试或保留原提示词。")
        return result


if __name__ == "__main__":
    ai_prompt = AIPrompt()
    user_input = input("请输入你的描述：")
    sd_prompt = ai_prompt.generate(user_input)
    print("Stable Diffusion Prompt:")
    print(sd_prompt)
