"""
配置加载器模块

从环境变量读取配置
工作流配置从 app_config.yaml 读取
使用 pydantic-settings 进行类型验证和默认值管理
"""
import os
import json
import yaml
from typing import List, Optional
from pydantic import BaseModel, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ComfyUILocalConfig(BaseSettings):
    """ComfyUI 本地配置"""
    enabled: bool = Field(validation_alias="COMFYUI_ENABLED")
    host: str = Field(validation_alias="COMFYUI_HOST")
    port: int = Field(validation_alias="COMFYUI_PORT")
    path: str = Field(validation_alias="COMFYUI_PATH")
    python_executable: str = Field(validation_alias="COMFYUI_PYTHON")
    timeout: int = Field(validation_alias="COMFYUI_TIMEOUT")
    check_interval: int = Field(validation_alias="COMFYUI_CHECK_INTERVAL")
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class ComfyUICloudConfig(BaseSettings):
    """ComfyUI 云端配置"""
    enabled: bool = Field(validation_alias="COMFYUI_CLOUD_ENABLED")
    api_url: str = Field(validation_alias="COMFYUI_CLOUD_API_URL")
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class ComfyUIConfig(BaseSettings):
    """ComfyUI 配置"""
    local: ComfyUILocalConfig = Field(default_factory=ComfyUILocalConfig)
    cloud: ComfyUICloudConfig = Field(default_factory=ComfyUICloudConfig)


class AIPromptConfig(BaseSettings):
    """AI Prompt 生成配置"""
    provider: str = Field(validation_alias="AI_PROMPT_PROVIDER")
    api_key: str = Field(validation_alias="AI_PROMPT_API_KEY")
    base_url: str = Field(validation_alias="AI_PROMPT_BASE_URL")
    model: str = Field(validation_alias="AI_PROMPT_MODEL")
    template: str = Field(validation_alias="AI_PROMPT_TEMPLATE")
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class NanoBananaConfig(BaseSettings):
    """Nano Banana (Gemini) 配置"""
    api_key: str = Field(default="", validation_alias="NANO_BANANA_API_KEY")
    base_url: str = Field(default="https://api.uniapi.io/gemini", validation_alias="NANO_BANANA_BASE_URL")
    model: str = Field(default="gemini-3-pro-image-preview", validation_alias="NANO_BANANA_MODEL")

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class ServerConfig(BaseSettings):
    """服务器配置"""
    host: str = Field(validation_alias="SERVER_HOST")
    port: int = Field(validation_alias="SERVER_PORT")
    reload: bool = Field(validation_alias="SERVER_RELOAD")
    cors_origins: List[str] = Field(validation_alias="CORS_ORIGINS")
    
    @field_validator('cors_origins', mode='before')
    @classmethod
    def parse_cors_origins(cls, v):
        """解析 CORS origins，支持 JSON 字符串或列表"""
        if isinstance(v, str):
            try:
                return json.loads(v)
            except json.JSONDecodeError:
                # 如果不是 JSON，尝试按逗号分隔
                return [origin.strip() for origin in v.split(',') if origin.strip()]
        return v
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class PathsConfig(BaseSettings):
    """路径配置"""
    workflows: str = Field(validation_alias="WORKFLOWS_PATH")
    upload_dir: str = Field(validation_alias="UPLOAD_DIR")
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class DatabaseConfig(BaseSettings):
    """数据库配置"""
    host: str = Field(validation_alias="DB_HOST")
    port: int = Field(validation_alias="DB_PORT")
    name: str = Field(validation_alias="DB_NAME")
    user: str = Field(validation_alias="DB_USER")
    password: str = Field(validation_alias="DB_PASSWORD")
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class AuthConfig(BaseSettings):
    """认证配置"""
    jwt_secret_key: str = Field(validation_alias="JWT_SECRET_KEY")
    jwt_algorithm: str = Field(validation_alias="JWT_ALGORITHM")
    jwt_access_token_expire_minutes: int = Field(validation_alias="JWT_EXPIRE_MINUTES")
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class RedisConfig(BaseSettings):
    """Redis 配置"""
    host: str = Field(validation_alias="REDIS_HOST")
    port: int = Field(validation_alias="REDIS_PORT")
    password: str = Field(validation_alias="REDIS_PASSWORD")
    db: int = Field(validation_alias="REDIS_DB")
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class WorkflowDefaultsConfig(BaseModel):
    """工作流默认配置 - 从 YAML 读取，不从环境变量读取"""
    current_workflow_type: str
    col_count: int
    workflow_files: dict
    workflow_metadata: dict  # 工作流元数据
    
    def get_workflow_parameter_default(self, workflow: str, parameter: str):
        """从 workflow_metadata 获取参数默认值"""
        metadata = self.workflow_metadata.get(workflow, {})
        parameters = metadata.get('parameters', [])
        for param in parameters:
            if param.get('name') == parameter:
                return param.get('default')
        return None

    def get_workflow_prompt_template(self, workflow: str) -> Optional[str]:
        """从 workflow_metadata 获取工作流专属 prompt 模板，未配置时返回 None"""
        metadata = self.workflow_metadata.get(workflow, {})
        return metadata.get('prompt_template', None)


class AppConfig(BaseSettings):
    """应用配置"""
    name: str = Field(validation_alias="APP_NAME")
    debug: bool = Field(validation_alias="APP_DEBUG")
    version: str = Field(validation_alias="APP_VERSION")
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class Config(BaseSettings):
    """全局配置类 - 直接从环境变量加载"""
    app: AppConfig = Field(default_factory=AppConfig)
    server: ServerConfig = Field(default_factory=ServerConfig)
    comfyui: ComfyUIConfig = Field(default_factory=ComfyUIConfig)
    ai_prompt: AIPromptConfig = Field(default_factory=AIPromptConfig)
    nano_banana: NanoBananaConfig = Field(default_factory=NanoBananaConfig)
    auth: AuthConfig = Field(default_factory=AuthConfig)
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    redis: RedisConfig = Field(default_factory=RedisConfig)
    paths: PathsConfig = Field(default_factory=PathsConfig)
    # workflow_defaults 从 YAML 读取，在 load_config 中赋值
    workflow_defaults: Optional[WorkflowDefaultsConfig] = None
    
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


# 全局配置实例（单例模式）
_config: Optional[Config] = None


def load_config(config_path: str = "configs/app_config.yaml") -> Config:
    """
    加载配置
    - 环境变量：所有配置值
    - app_config.yaml：工作流配置（workflow_defaults）
    
    Args:
        config_path: 配置文件路径，仅用于读取工作流配置
        
    Returns:
        Config: 配置对象
    """
    global _config
    
    if _config is not None:
        return _config
    
    from dotenv import load_dotenv
    
    # 加载 .env 文件
    load_dotenv()
    
    # 从环境变量创建配置对象
    _config = Config()
    
    # 从 YAML 读取工作流配置（如果文件存在）
    if config_path and os.path.exists(config_path):
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                yaml_data = yaml.safe_load(f)
                
            # 仅覆盖工作流配置
            if yaml_data and 'workflow_defaults' in yaml_data:
                workflow_data = yaml_data['workflow_defaults']
                _config.workflow_defaults = WorkflowDefaultsConfig(**workflow_data)
        except Exception as e:
            print(f"警告: 无法从 {config_path} 读取工作流配置: {e}")
            print("将使用默认工作流配置")
    
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


def get_nano_banana_config() -> NanoBananaConfig:
    """获取 Nano Banana 配置"""
    return get_config().nano_banana


def get_server_config() -> ServerConfig:
    """获取服务器配置"""
    return get_config().server


def get_database_config() -> DatabaseConfig:
    """获取数据库配置"""
    return get_config().database


def get_auth_config() -> AuthConfig:
    """获取认证配置"""
    return get_config().auth


def get_redis_config() -> RedisConfig:
    """获取 Redis 配置"""
    return get_config().redis


if __name__ == "__main__":
    # 测试配置加载
    config = load_config()
    print(f"应用名称: {config.app.name}")
    print(f"服务器地址: {config.server.host}:{config.server.port}")
    print(f"ComfyUI 地址: {config.comfyui.local.host}:{config.comfyui.local.port}")
    print(f"AI Prompt 模型: {config.ai_prompt.model}")
    print(f"数据库: {config.database.host}:{config.database.port}/{config.database.name}")
