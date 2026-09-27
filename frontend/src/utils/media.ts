// 生成结果既可能是图片也可能是视频；历史 base64 视频以 data:video/ 开头
export function isVideoUrl(url: string): boolean {
  return url.startsWith('data:video/') || /\.(mp4|webm)$/i.test(url) || url.includes('/video/');
}
