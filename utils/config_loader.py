"""
配置加载器模块

使用 pydantic-settings 和 YAML 加载应用配置
支持从环境变量覆盖配置项
"""
import os
from typing import List, Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
import yaml


class ComfyUILocalConfig(BaseSettings):
    """ComfyUI 本地配置"""
    enabled: bool = True
    host: str = "127.0.0.1"
    port: int = 8188
    path: str = Field(default="", validation_alias="COMFYUI_PATH")
    python_executable: str = Field(default="", validation_alias="COMFYUI_PYTHON")
    timeout: int = 30
    check_interval: int = 5000
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class ComfyUICloudConfig(BaseSettings):
    """ComfyUI 云端配置"""
    enabled: bool = False
    api_url: str = ""


class ComfyUIConfig(BaseSettings):
    """ComfyUI 配置"""
    local: ComfyUILocalConfig
    cloud: ComfyUICloudConfig


class AIPromptConfig(BaseSettings):
    """AI Prompt 生成配置"""
    provider: str = "openai"
    api_key: str = Field(validation_alias="AI_PROMPT_API_KEY")
    base_url: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: str = "deepseek-v3"
    template: str
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class ServerConfig(BaseSettings):
    """服务器配置"""
    host: str = "0.0.0.0"
    port: int = 8000
    reload: bool = True
    cors_origins: List[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]


class PathsConfig(BaseSettings):
    """路径配置"""
    workflows: str = "configs/workflows"


class WorkflowConfig(BaseSettings):
    """单个工作流配置"""
    description: str = ""
    prompt: str = ""
    lora_prompt: str = ""
    strength: float = 0.8
    count: int = 1


class WorkflowDefaultsConfig(BaseSettings):
    """工作流默认配置"""
    current_workflow_type: str = "参考"
    col_count: int = 4
    workflows: dict = {}


class AppConfig(BaseSettings):
    """应用配置"""
    name: str = "ai-draw"
    debug: bool = True
    version: str = "1.0.0"


class Config(BaseSettings):
    """全局配置类"""
    app: AppConfig
    server: ServerConfig
    comfyui: ComfyUIConfig
    ai_prompt: AIPromptConfig
    paths: PathsConfig
    workflow_defaults: WorkflowDefaultsConfig
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


# 全局配置实例
_config: Optional[Config] = None


def load_config(config_path: str = "configs/app_config.yaml") -> Config:
    """
    加载配置文件
    
    Args:
        config_path: 配置文件路径
        
    Returns:
        Config: 配置对象
    """
    global _config
    
    if _config is not None:
        return _config
    
    # 读取 YAML 配置文件
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"配置文件不存在: {config_path}")
    
    with open(config_path, 'r', encoding='utf-8') as f:
        yaml_content = f.read()
        
    # 替换环境变量占位符
    import re
    from dotenv import load_dotenv
    
    # 加载 .env 文件
    load_dotenv()
    
    # 替换 ${VAR} 格式的环境变量
    def replace_env_var(match):
        var_name = match.group(1)
        return os.getenv(var_name, match.group(0))
    
    yaml_content = re.sub(r'\$\{([^}]+)\}', replace_env_var, yaml_content)
    
    # 解析 YAML
    config_dict = yaml.safe_load(yaml_content)
    
    # 创建配置对象
    _config = Config(**config_dict)
    
    return _config


def get_config() -> Config:
    """
    获取配置实例（单例模式）
    
    Returns:
        Config: 配置对象
    """
    global _config
    if _config is None:
        _config = load_config()
    return _config


# 便捷访问函数
def get_comfyui_config() -> ComfyUIConfig:
    """获取 ComfyUI 配置"""
    return get_config().comfyui


def get_ai_prompt_config() -> AIPromptConfig:
    """获取 AI Prompt 配置"""
    return get_config().ai_prompt


def get_server_config() -> ServerConfig:
    """获取服务器配置"""
    return get_config().server


if __name__ == "__main__":
    # 测试配置加载
    config = load_config()
    print(f"应用名称: {config.app.name}")
    print(f"ComfyUI 地址: {config.comfyui.local.host}:{config.comfyui.local.port}")
    print(f"AI Prompt 模型: {config.ai_prompt.model}")
