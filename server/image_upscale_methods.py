from dataclasses import dataclass
from typing import Literal, Optional

from utils.config_loader import ImageUpscaleConfig


UpscaleRunner = Literal['local', 'upscale_model', 'invsr']


@dataclass(frozen=True)
class UpscaleModelChoice:
    filename: str
    native_scale: int
    variant: str


@dataclass(frozen=True)
class UpscaleMethodDefinition:
    id: str
    algorithm_id: str
    algorithm_name: str
    label: str
    description: str
    architecture: str
    behavior: str
    license_notice: Optional[str]
    runner: UpscaleRunner
    models: dict[int, UpscaleModelChoice]

    def availability(
        self,
        installed_models: set[str],
        invsr_available: bool,
        model_error: Optional[str] = None,
        invsr_error: Optional[str] = None,
    ) -> dict:
        scale_availability = []
        for scale in (2, 4):
            model = self.models.get(scale)
            if self.runner == 'local':
                available = True
                reason = None
            elif self.runner == 'invsr':
                available = invsr_available
                reason = None if available else invsr_error or 'ComfyUI 未安装 InvSR 节点或模型'
            elif model is None:
                available = False
                reason = '该算法不支持此倍率'
            else:
                available = model.filename in installed_models
                reason = None if available else model_error or f'ComfyUI 未安装 {model.filename}'
            scale_availability.append({
                'scale': scale,
                'available': available,
                'unavailable_reason': reason,
                'model': model.variant if model else None,
                'native_scale': model.native_scale if model else 4 if self.runner == 'invsr' else scale,
                'processing_scale': model.native_scale if model else 4 if self.runner == 'invsr' else scale,
            })

        available_scales = [item['scale'] for item in scale_availability if item['available']]
        return {
            'id': self.id,
            'algorithm_id': self.algorithm_id,
            'algorithm_name': self.algorithm_name,
            'label': self.label,
            'description': self.description,
            'architecture': self.architecture,
            'behavior': self.behavior,
            'license_notice': self.license_notice,
            'kind': 'local' if self.runner == 'local' else 'ai',
            'available': bool(available_scales),
            'supported_scales': available_scales,
            'scale_availability': scale_availability,
            'unavailable_reason': None if available_scales else scale_availability[0]['unavailable_reason'],
        }


def build_upscale_method_registry(cfg: ImageUpscaleConfig) -> dict[str, UpscaleMethodDefinition]:
    methods = [
        UpscaleMethodDefinition(
            id='lanczos',
            algorithm_id='lanczos',
            algorithm_name='Lanczos',
            label='Lanczos 快速放大',
            description='高阶 sinc 重采样，速度快，只改变像素尺寸，不生成新细节。',
            architecture='Lanczos 重采样（非神经网络）',
            behavior='非 AI 插值',
            license_notice=None,
            runner='local',
            models={},
        ),
        UpscaleMethodDefinition(
            id='apisr',
            algorithm_id='apisr',
            algorithm_name='APISR',
            label='APISR 动漫增强',
            description='面向真实退化动漫素材，强化线条并修复压缩、模糊和缩放损伤。',
            architecture='显式动漫退化建模 + GAN；2x RRDB / 4x DAT',
            behavior='感知增强，可能重建纹理',
            license_notice='GPL-3.0 代码；官方项目与权重另有“仅限学术用途”声明',
            runner='upscale_model',
            models={
                2: UpscaleModelChoice(cfg.apisr_2x_model, 2, 'APISR RRDB 2x'),
                4: UpscaleModelChoice(cfg.apisr_4x_model, 4, 'APISR DAT 4x'),
            },
        ),
        UpscaleMethodDefinition(
            id='real_cugan',
            algorithm_id='real_cugan',
            algorithm_name='Real-CUGAN',
            label='Real-CUGAN 动漫保真',
            description='适合动漫、插画和线稿，增强线条并尽量保留平涂、虚化和原有画风。',
            architecture='Cascade U-Net / CUNet + SE 通道注意力',
            behavior='保真修复',
            license_notice='MIT License',
            runner='upscale_model',
            models={
                2: UpscaleModelChoice(cfg.real_cugan_2x_model, 2, 'Real-CUGAN Pro 无降噪 2x'),
                4: UpscaleModelChoice(cfg.real_cugan_4x_model, 4, 'Real-CUGAN 基础保守 4x'),
            },
        ),
        UpscaleMethodDefinition(
            id='realesrgan_general',
            algorithm_id='realesrgan',
            algorithm_name='Real-ESRGAN',
            label='Real-ESRGAN 通用',
            description='适合照片、扫描图和混合内容，去模糊、锐化及纹理重建较强。',
            architecture='RRDBNet + 高阶真实退化建模 + GAN',
            behavior='感知增强，可能改变细小纹理',
            license_notice='BSD 3-Clause',
            runner='upscale_model',
            models={
                2: UpscaleModelChoice(cfg.realesrgan_2x_model, 2, 'RealESRGAN x2plus'),
                4: UpscaleModelChoice(cfg.general_model, cfg.general_native_scale, 'RealESRGAN x4plus'),
            },
        ),
        UpscaleMethodDefinition(
            id='realesrgan_anime',
            algorithm_id='realesrgan',
            algorithm_name='Real-ESRGAN',
            label='Real-ESRGAN 动漫',
            description='适合需要明显锐化的动漫和插画；2x 由原生 4x 推理后精确缩小。',
            architecture='精简 RRDBNet 6B + GAN',
            behavior='感知增强，线条更强',
            license_notice='BSD 3-Clause',
            runner='upscale_model',
            models={
                2: UpscaleModelChoice(cfg.anime_model, cfg.anime_native_scale, 'RealESRGAN Anime 6B 4x → 2x'),
                4: UpscaleModelChoice(cfg.anime_model, cfg.anime_native_scale, 'RealESRGAN Anime 6B 4x'),
            },
        ),
        UpscaleMethodDefinition(
            id='invsr',
            algorithm_id='invsr',
            algorithm_name='InvSR',
            label='InvSR 生成式修复',
            description='使用 SD-Turbo 扩散反演重建细节；可能改变文字、脸部、纹理和细小结构。',
            architecture='SD-Turbo Diffusion Inversion + Noise Predictor',
            behavior='生成式修复',
            license_notice='NTU S-Lab 1.0，仅限非商业使用',
            runner='invsr',
            models={},
        ),
    ]
    return {method.id: method for method in methods}
