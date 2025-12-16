from openai import OpenAI
from utils.config_loader import get_ai_prompt_config


class AIPrompt:
    def __init__(self, api_key=None, url=None, model=None, prompt_template=None):
        # 从配置加载 AI Prompt 设置
        config = get_ai_prompt_config()
        
        self.api_key = api_key or config.api_key
        self.url = url or config.base_url
        self.model = model or config.model
        self.prompt_template = prompt_template or config.template
        self.client = OpenAI(api_key=self.api_key, base_url=self.url)

    def generate(self, natural_desc: str) -> str:
        prompt = self.prompt_template.format(desc=natural_desc)
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{'role': 'user', 'content': prompt}]
        )
        return response.choices[0].message.content.strip()


if __name__ == "__main__":
    ai_prompt = AIPrompt()
    user_input = input("请输入你的描述：")
    sd_prompt = ai_prompt.generate(user_input)
    print("Stable Diffusion Prompt:")
    print(sd_prompt)
