import { useState } from 'react';
import { Button, Popover } from 'antd';
import { CloseOutlined, FormOutlined } from '@ant-design/icons';
import type { PromptPreset } from '../types/api';
import './PromptPresetTag.css';

interface PromptPresetTagProps {
  preset: PromptPreset;
  /** Why the request cannot be sent with this preset yet. */
  issue?: string | null;
  onRemove?: () => void;
  onChange?: () => void;
}

/** The preset stays outside the description; its full text is one click away. */
export default function PromptPresetTag({ preset, issue, onRemove, onChange }: PromptPresetTagProps) {
  const [open, setOpen] = useState(false);
  const details = (
    <div className="prompt-preset-details">
      {preset.description && <p>{preset.description}</p>}
      <p className="prompt-preset-details-text">{preset.prompt}</p>
      {preset.images.length > 0 && (
        <dl className="prompt-preset-details-images">
          {preset.images.map(image => (
            <div key={image.label}><dt>{image.label}</dt><dd>{image.role}</dd></div>
          ))}
        </dl>
      )}
      {onChange && (
        <Button size="small" onClick={() => { setOpen(false); onChange(); }}>更换预设</Button>
      )}
    </div>
  );

  return (
    <span className={`prompt-preset-tag${issue ? ' has-issue' : ''}`}>
      <Popover open={open} onOpenChange={setOpen} trigger="click" placement="topLeft"
        align={{ overflow: { shiftX: true, shiftY: true, adjustY: true } }} title={preset.title} content={details}>
        <button type="button" className="prompt-preset-tag-main" aria-label={`查看预设「${preset.title}」`}>
          <FormOutlined aria-hidden="true" />
          <span>{preset.title}</span>
        </button>
      </Popover>
      {issue && <span className="prompt-preset-tag-issue">{issue}</span>}
      {onRemove && (
        <button type="button" className="prompt-preset-tag-remove" onClick={onRemove} aria-label={`移除预设「${preset.title}」`}>
          <CloseOutlined aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
