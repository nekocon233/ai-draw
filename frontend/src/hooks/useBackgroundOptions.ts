/**
 * 背景抠除选项共享状态
 *
 * 抽帧编辑（FrameExtractionModal）与单图移除背景（BackgroundRemovalModal）共用，
 * 保证两处「背景」参数 UI 与请求体始终一致。默认值与原 FrameExtractionModal 内联值相同。
 */
import { useCallback, useState } from 'react';
import type { VideoBackgroundMode, VideoBackgroundOptions } from '../api/services';

export interface BackgroundOptionsState extends VideoBackgroundOptions {
  background_mode: VideoBackgroundMode;
  rembg_model: string;
  alpha_matting: boolean;
  post_process_mask: boolean;
  inspyrenet_mode: 'base' | 'fast' | 'base-nightly';
  inspyrenet_resize: 'static' | 'dynamic';
  birefnet_model: string;
  birefnet_image_size: number;
  birefnet_device: string;
  birefnet_precision: 'auto' | 'fp32' | 'fp16' | 'bf16';
  edge_threshold: number;
  edge_feather: number;
}

const DEFAULTS: BackgroundOptionsState = {
  background_mode: 'inspyrenet',
  rembg_model: 'isnet-anime',
  alpha_matting: true,
  post_process_mask: true,
  inspyrenet_mode: 'base',
  inspyrenet_resize: 'static',
  birefnet_model: 'ZhengPeng7/BiRefNet',
  birefnet_image_size: 1024,
  birefnet_device: 'auto',
  birefnet_precision: 'auto',
  edge_threshold: 32,
  edge_feather: 10,
};

export function useBackgroundOptions() {
  const [state, setState] = useState<BackgroundOptionsState>(DEFAULTS);

  const set = useCallback(<K extends keyof BackgroundOptionsState>(key: K, value: BackgroundOptionsState[K]) => {
    setState(prev => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setState(DEFAULTS);
  }, []);

  const toRequest = useCallback((): VideoBackgroundOptions => ({ ...state }), [state]);

  return { state, set, reset, toRequest };
}
