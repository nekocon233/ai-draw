"""
Kling 视频生成 API 封装

通过第三方兼容 API（如 UniAPI）调用 Kling 视频模型，支持「首帧 + 尾帧」图生视频
（image2video：image 为首帧、image_tail 为尾帧）。

参考用户提供的 KlingVideoSDK，裁剪为首尾帧图生视频所需的最小实现，并提供高阶同步函数
`generate_image2video_flf2v`：创建任务 → 轮询至完成 → 返回首个视频 URL。
"""
import logging
import time
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

# 默认基础地址（UniAPI 的 Kling 兼容入口）
DEFAULT_BASE_URL = "https://api.uniapi.io/kling"

# 任务终态
_TASK_SUCCEED = "succeed"
_TASK_FAILED = "failed"


class KlingVideoSDK:
    """Kling 视频生成 API SDK（requests + Bearer 鉴权）"""

    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, timeout: int = 120):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(
            {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            }
        )

    def create_image2video_task(
        self,
        image: Optional[str] = None,
        image_tail: Optional[str] = None,
        model_name: str = "kling-v3",
        prompt: Optional[str] = None,
        negative_prompt: Optional[str] = None,
        mode: str = "std",
        duration: str = "5",
        sound: str = "off",
        cfg_scale: Optional[float] = None,
        callback_url: Optional[str] = None,
        external_task_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """创建图生视频任务。image / image_tail 至少二选一。

        Args:
            image: 首帧（Base64 或 URL）
            image_tail: 尾帧（Base64 或 URL）
            model_name: 模型名称（uniapi 可用：kling-v3 / kling-v2-master / kling-v2-1 / kling-v2-6 / kling-v1-6）
            prompt: 正向提示词（≤2500 字符）
            negative_prompt: 负向提示词
            mode: 生成模式（std/pro）
            duration: 视频时长，image2video 仅支持 "5" / "10"
            sound: 是否生成声音（on/off，仅部分模型支持）
            cfg_scale: 自由度 [0,1]（v2.x/v3 不支持，传 None 则不发送）
            callback_url: 结果回调地址
            external_task_id: 自定义任务 ID

        Returns:
            API 响应 dict
        """
        if not image and not image_tail:
            raise ValueError("image 与 image_tail 至少需要提供一项")

        url = f"{self.base_url}/v1/videos/image2video"
        payload: Dict[str, Any] = {
            "model_name": model_name,
            "sound": sound,
            "mode": mode,
            "duration": duration,
        }
        if image:
            payload["image"] = image
        if image_tail:
            payload["image_tail"] = image_tail
        if prompt:
            payload["prompt"] = prompt
        if negative_prompt:
            payload["negative_prompt"] = negative_prompt
        if cfg_scale is not None:
            payload["cfg_scale"] = cfg_scale
        if callback_url:
            payload["callback_url"] = callback_url
        if external_task_id:
            payload["external_task_id"] = external_task_id

        response = self.session.post(url, json=payload, timeout=self.timeout)
        if not response.ok:
            raise RuntimeError(
                f"Kling 创建任务失败 (HTTP {response.status_code}): {response.text[:500]}"
            )
        return response.json()

    def query_task(self, task_id: str) -> Dict[str, Any]:
        """查询图生视频任务状态"""
        url = f"{self.base_url}/v1/videos/image2video/{task_id}"
        response = self.session.get(url, timeout=self.timeout)
        if not response.ok:
            raise RuntimeError(
                f"Kling 查询任务失败 (HTTP {response.status_code}): {response.text[:500]}"
            )
        return response.json()

    def wait_for_completion(
        self,
        task_id: str,
        poll_interval: int = 5,
        max_wait_time: int = 600,
    ) -> Dict[str, Any]:
        """轮询等待任务完成（succeed / failed / 超时）"""
        start_time = time.time()
        while True:
            if time.time() - start_time > max_wait_time:
                raise TimeoutError(f"等待 Kling 任务完成超时（超过 {max_wait_time} 秒）: {task_id}")

            result = self.query_task(task_id)
            if result.get("code") != 0:
                # 查询本身失败，直接返回让上层处理
                return result

            task_status = (result.get("data") or {}).get("task_status")
            if task_status in (_TASK_SUCCEED, _TASK_FAILED):
                return result

            time.sleep(poll_interval)

    @staticmethod
    def get_video_urls(result: Dict[str, Any]) -> List[str]:
        """从结果中提取视频 URL 列表"""
        if result.get("code") != 0:
            return []
        task_result = (result.get("data") or {}).get("task_result") or {}
        videos = task_result.get("videos") or []
        return [v.get("url") for v in videos if v.get("url")]


def _strip_data_url(b64: Optional[str]) -> Optional[str]:
    """去除 data URL 前缀，返回纯 base64 / URL"""
    if not b64:
        return None
    return b64.split(",", 1)[1] if b64.startswith("data:") else b64


def generate_image2video_flf2v(
    api_key: str,
    start_image: str,
    end_image: str,
    prompt: str = "",
    model_name: str = "kling-v3",
    duration: str = "5",
    mode: str = "std",
    base_url: str = DEFAULT_BASE_URL,
    poll_interval: int = 5,
    max_wait_time: int = 600,
) -> str:
    """首尾帧图生视频（同步阻塞，供线程池调用）。

    Args:
        api_key: Kling API 密钥
        start_image: 首帧（data URL / base64 / URL）
        end_image: 尾帧（data URL / base64 / URL）
        prompt: 提示词
        model_name: 模型名称（uniapi 可用：kling-v3 / kling-v2-master / kling-v2-1 / kling-v2-6 / kling-v1-6）
        duration: 时长，image2video 仅支持 "5" / "10"
        mode: 生成模式（std/pro）
        base_url: API 基础地址
        poll_interval: 轮询间隔（秒）
        max_wait_time: 最大等待时间（秒）

    Returns:
        首个视频的 URL

    Raises:
        ValueError: 缺少必要参数
        RuntimeError: 任务创建/查询失败、任务失败或无视频返回
        TimeoutError: 轮询超时
    """
    if not api_key:
        raise ValueError("未配置 KLING_API_KEY，无法调用 Kling")
    if not start_image or not end_image:
        raise ValueError("Kling 首尾帧生视频需要同时提供首帧和尾帧图片")

    sdk = KlingVideoSDK(api_key=api_key, base_url=base_url)

    logger.info(
        "[Kling] 创建首尾帧图生视频任务: model=%s, duration=%ss, mode=%s",
        model_name, duration, mode,
    )
    create_result = sdk.create_image2video_task(
        image=_strip_data_url(start_image),
        image_tail=_strip_data_url(end_image),
        model_name=model_name,
        prompt=prompt or None,
        mode=mode,
        duration=str(duration),
    )

    if create_result.get("code") != 0:
        raise RuntimeError(f"Kling 任务创建失败: {create_result.get('message') or create_result}")

    task_id = (create_result.get("data") or {}).get("task_id")
    if not task_id:
        raise RuntimeError(f"Kling 任务创建未返回 task_id: {create_result}")

    logger.info("[Kling] 任务已创建: %s，开始轮询", task_id)
    final_result = sdk.wait_for_completion(
        task_id=task_id,
        poll_interval=poll_interval,
        max_wait_time=max_wait_time,
    )

    task_status = (final_result.get("data") or {}).get("task_status")
    if task_status != _TASK_SUCCEED:
        status_msg = (final_result.get("data") or {}).get("task_status_msg")
        raise RuntimeError(f"Kling 视频生成失败: {status_msg or final_result}")

    video_urls = KlingVideoSDK.get_video_urls(final_result)
    if not video_urls:
        raise RuntimeError(f"Kling 任务成功但未返回视频 URL: {final_result}")

    logger.info("[Kling] 视频生成成功: %s", video_urls[0])
    return video_urls[0]
