export interface ImageUpscaleLimits {
  maxEdge: number;
  maxPixels: number;
}

export interface ImageUpscaleTarget {
  width: number;
  height: number;
  allowed: boolean;
  reason?: string;
}

export function getImageUpscaleTarget(
  width: number,
  height: number,
  scale: 2 | 4,
  limits: ImageUpscaleLimits,
  processingScale: number = scale,
): ImageUpscaleTarget {
  const targetWidth = width * scale;
  const targetHeight = height * scale;
  if (targetWidth > limits.maxEdge || targetHeight > limits.maxEdge) {
    return {
      width: targetWidth,
      height: targetHeight,
      allowed: false,
      reason: `输出最长边不能超过 ${limits.maxEdge}px`,
    };
  }
  if (targetWidth * targetHeight > limits.maxPixels) {
    return {
      width: targetWidth,
      height: targetHeight,
      allowed: false,
      reason: `输出总像素不能超过 ${limits.maxPixels.toLocaleString()} pixels`,
    };
  }
  const processingWidth = width * processingScale;
  const processingHeight = height * processingScale;
  if (processingWidth > limits.maxEdge || processingHeight > limits.maxEdge) {
    return {
      width: targetWidth,
      height: targetHeight,
      allowed: false,
      reason: `该算法内部会生成 ${processingWidth}×${processingHeight}，最长边不能超过 ${limits.maxEdge}px`,
    };
  }
  if (processingWidth * processingHeight > limits.maxPixels) {
    return {
      width: targetWidth,
      height: targetHeight,
      allowed: false,
      reason: `该算法内部处理像素不能超过 ${limits.maxPixels.toLocaleString()} pixels`,
    };
  }
  return { width: targetWidth, height: targetHeight, allowed: true };
}
