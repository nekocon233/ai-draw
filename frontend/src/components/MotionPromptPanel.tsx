import { useEffect, useRef, useState } from 'react';
import { Button, Input, message } from 'antd';
import { BulbOutlined } from '@ant-design/icons';
import { apiService } from '../api/services';
import type { MotionPromptSnapshot } from '../types/api';
import { motionPromptSourceKey, type MotionPromptSource } from '../utils/motionPrompt';

interface Props {
  source: MotionPromptSource;
  snapshot?: MotionPromptSnapshot | null;
  onChange: (snapshot: MotionPromptSnapshot) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}

function MotionPromptEditor({ source, snapshot, onChange, onBusyChange, disabled }: Props) {
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; controller.current?.abort(); onBusyChange?.(false); };
  }, [onBusyChange]);

  const analyze = async () => {
    if (loading) return;
    controller.current = new AbortController();
    setLoading(true); onBusyChange?.(true);
    try {
      const response = await apiService.analyzeMotionPrompt(source, controller.current.signal);
      if (alive.current) onChange(response);
    } catch (error) {
      if (alive.current && !controller.current?.signal.aborted) message.error(error instanceof Error ? error.message : '动作图分析失败，请重试');
    } finally {
      if (alive.current) { setLoading(false); onBusyChange?.(false); }
    }
  };

  return <section className="motion-prompt-panel" aria-label="动作提示词">
    <div className="motion-reference-heading">
      <strong>保留原画面，只改变姿势</strong>
      <Button size="small" icon={<BulbOutlined />} loading={loading} disabled={disabled || !source.reference_image || !source.motion_reference_images.length}
        onClick={() => void analyze()}>{snapshot ? '重新识别动作' : '预览动作提示词'}</Button>
    </div>
    <p className="motion-reference-hint">保持人物、背景、光照、镜头与裁切。生成视频前自动看图分析，补充文字可留空。</p>
    {snapshot && <details className="motion-prompt-details">
      <summary>查看或修改动作提示词</summary>
      <Input.TextArea value={snapshot.prompt} aria-label="识别的动作提示词" autoSize={{minRows:3,maxRows:8}}
        maxLength={12000} disabled={disabled || loading} onChange={event => onChange({...snapshot, prompt:event.target.value})} />
      <span className="motion-reference-hint">原始补充描述会单独保留；固定人物、背景和镜头的要求始终生效。</span>
    </details>}
  </section>;
}

export default function MotionPromptPanel(props: Props) {
  // A changed source unmounts/aborts the old analysis before it can overwrite a different draft.
  return <MotionPromptEditor key={motionPromptSourceKey(props.source)} {...props} />;
}
