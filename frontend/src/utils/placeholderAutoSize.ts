import type { TextAreaProps } from 'antd/es/input/TextArea';

/**
 * Ant Design 的 autoSize 只在内容或尺寸变化时重新测量高度；提示文字随预设、生成方式或参考图变长后，
 * 空输入框仍停在旧高度，手机上多行提示会被截断。空输入框按提示文字测量，所以给 minRows 加一个随提示
 * 文字变化、远小于 1 像素的差值，提示文字一变就会重新测量。
 */
export function placeholderAutoSize(
  autoSize: TextAreaProps['autoSize'],
  placeholder: string | undefined,
): TextAreaProps['autoSize'] {
  if (!autoSize || typeof autoSize !== 'object' || !placeholder) return autoSize;
  let hash = 0;
  for (const char of placeholder) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 997;
  return { ...autoSize, minRows: (autoSize.minRows ?? 1) + (hash + 1) / 1e6 };
}
