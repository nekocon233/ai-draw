import os
import yaml
from typing import List
from utils.config_loader import get_comfyui_config

def get_lora_directory() -> str:
    """获取 LoRA 模型目录"""
    try:
        config = get_comfyui_config().local
        comfyui_path = config.path
        
        # 1. 尝试读取 extra_model_paths.yaml
        extra_config_path = os.path.join(comfyui_path, "extra_model_paths.yaml")
        if os.path.exists(extra_config_path):
            try:
                with open(extra_config_path, 'r', encoding='utf-8') as f:
                    extra_config = yaml.safe_load(f)
                    
                if 'comfyui' in extra_config:
                    base_path = extra_config['comfyui'].get('base_path')
                    loras_rel_path = extra_config['comfyui'].get('loras')
                    
                    if base_path and loras_rel_path:
                        # 确保 base_path 是绝对路径
                        if not os.path.isabs(base_path):
                            base_path = os.path.abspath(os.path.join(comfyui_path, base_path))
                            
                        lora_dir = os.path.join(base_path, loras_rel_path)
                        if os.path.exists(lora_dir):
                            return lora_dir
            except Exception as e:
                print(f"[LoraScanner] Failed to parse extra_model_paths.yaml: {e}")

        # 2. 默认路径
        return os.path.join(comfyui_path, "models", "loras")
        
    except Exception as e:
        print(f"[LoraScanner] Error resolving lora directory: {e}")
        return ""

def scan_lora_models() -> List[str]:
    """
    扫描 LoRA 目录下的所有模型文件
    """
    try:
        lora_dir = get_lora_directory()
        
        if not lora_dir or not os.path.exists(lora_dir):
            print(f"[LoraScanner] LoRA directory not found: {lora_dir}")
            return []
            
        print(f"[LoraScanner] Scanning directory: {lora_dir}")
            
        lora_files = []
        valid_extensions = {'.safetensors', '.pt', '.pth', '.ckpt'}
        
        # 递归遍历目录
        for root, _, files in os.walk(lora_dir):
            for file in files:
                # 检查文件扩展名
                _, ext = os.path.splitext(file)
                if ext.lower() in valid_extensions:
                    # 获取相对路径
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, lora_dir)
                    # 统一路径分隔符为正斜杠，方便前端处理
                    rel_path = rel_path.replace(os.sep, '/')
                    lora_files.append(rel_path)
                    
        return sorted(lora_files)
        
    except Exception as e:
        print(f"[LoraScanner] Error scanning lora models: {e}")
        return []
