import { Button, InputNumber, Segmented, Tooltip } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import { randomSeed, type SeedValue } from '../utils/generationSeed';

interface SeedFieldProps {
  id?: string;
  /** '' 为随机；null 表示已选固定但数值被清空，由表单校验拦下。 */
  value?: SeedValue | null;
  onChange?: (value: SeedValue | null) => void;
  max: number;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

export default function SeedField({ id, value, onChange, max, ...aria }: SeedFieldProps) {
  const fixed = value !== '' && value !== undefined;
  return (
    <div className="seed-field">
      <Segmented
        id={fixed ? undefined : id}
        aria-label="种子模式"
        aria-describedby={fixed ? undefined : aria['aria-describedby']}
        value={fixed ? 'fixed' : 'random'}
        onChange={mode => onChange?.(mode === 'fixed' ? randomSeed() : '')}
        options={[{ label: '随机', value: 'random' }, { label: '固定', value: 'fixed' }]}
      />
      {fixed && (
        <div className="seed-field-value">
          <InputNumber
            id={id}
            {...aria}
            aria-label="种子数值"
            className="seed-field-input"
            value={value}
            min={0}
            max={max}
            precision={0}
            controls={false}
            inputMode="numeric"
            onChange={next => onChange?.(typeof next === 'number' ? next : null)}
          />
          <Tooltip title="换一个随机种子">
            <Button aria-label="换一个随机种子" icon={<SyncOutlined />} onClick={() => onChange?.(randomSeed())} />
          </Tooltip>
        </div>
      )}
    </div>
  );
}
