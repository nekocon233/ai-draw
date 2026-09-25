import { forwardRef, useId, useLayoutEffect, useRef, useState } from 'react';
import { Input, Popover, theme } from 'antd';
import type { TextAreaProps, TextAreaRef } from 'antd/es/input/TextArea';
import { findImageMentionQuery, getImageMentionError, insertImageMention } from '../utils/imageMentions';
import './ImageMentionInput.css';

interface ImageMentionInputProps extends Omit<TextAreaProps, 'value' | 'onChange'> {
  value: string;
  onChange: (value: string) => void;
  images: readonly (string | null | undefined)[];
  enabled: boolean;
}

const ImageMentionInput = forwardRef<TextAreaRef, ImageMentionInputProps>(function ImageMentionInput({
  value, onChange, images, enabled, onKeyDown, onPressEnter, onSelect, onFocus, onBlur,
  onCompositionStart, onCompositionEnd, ...props
}, ref) {
  const inputRef = useRef<TextAreaRef | null>(null);
  const pendingCaret = useRef<{ value: string; caret: number } | null>(null);
  const [selection, setSelection] = useState<{ value: string; start: number; end: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const errorId = useId();
  const { token } = theme.useToken();
  const query = enabled && focused && !composing && selection?.value === value
    ? findImageMentionQuery(value, selection.start, selection.end) : null;
  const options = images.flatMap((image, index) => image ? [{ image, index: index + 1 }] : [])
    .filter(option => !query?.search || `图片${option.index}`.includes(query.search));
  const open = Boolean(query);
  const active = options[activeIndex % Math.max(1, options.length)];
  const error = enabled ? getImageMentionError(value, images) : null;

  useLayoutEffect(() => {
    const pending = pendingCaret.current;
    if (!pending || pending.value !== value) return;
    pendingCaret.current = null;
    const input = inputRef.current?.resizableTextArea?.textArea;
    input?.focus();
    input?.setSelectionRange(pending.caret, pending.caret);
  }, [value]);

  const trackSelection = (input: HTMLTextAreaElement) => {
    if (selection?.value === input.value && selection.start === input.selectionStart && selection.end === input.selectionEnd) return;
    setSelection({ value: input.value, start: input.selectionStart, end: input.selectionEnd });
    setActiveIndex(0);
  };
  const choose = (index: number) => {
    if (!query) return;
    const next = insertImageMention(value, query, index);
    pendingCaret.current = next;
    setSelection(null);
    onChange(next.value);
  };

  return (
    <div className="image-mention-input">
      <Popover
        open={open}
        placement="topLeft"
        arrow={false}
        trigger={[]}
        content={(
          <div id={listId} role="listbox" aria-label="选择参考图片" className="image-mention-list">
            {options.length ? options.map(option => (
              <button
                key={option.index}
                id={`${listId}-${option.index}`}
                type="button"
                role="option"
                aria-selected={active?.index === option.index}
                className="image-mention-option"
                style={{ color: token.colorText, background: active?.index === option.index ? token.colorFillSecondary : undefined }}
                onMouseDown={event => event.preventDefault()}
                onPointerMove={() => setActiveIndex(options.indexOf(option))}
                onClick={() => choose(option.index)}
              >
                <img src={option.image} alt="" />
                <span>图片{option.index}</span>
              </button>
            )) : <div className="image-mention-empty">{images.some(Boolean) ? '没有匹配的参考图' : '请先添加参考图'}</div>}
          </div>
        )}
      >
        <div className="image-mention-anchor">
        <Input.TextArea
          {...props}
          ref={node => {
            inputRef.current = node;
            if (typeof ref === 'function') ref(node);
            else if (ref) ref.current = node;
          }}
          value={value}
          role={enabled ? 'combobox' : undefined}
          aria-autocomplete={enabled ? 'list' : undefined}
          aria-expanded={enabled ? open : undefined}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && active ? `${listId}-${active.index}` : undefined}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : props['aria-describedby']}
          onChange={event => { trackSelection(event.target); onChange(event.target.value); }}
          onSelect={event => { trackSelection(event.currentTarget); onSelect?.(event); }}
          onFocus={event => { setFocused(true); onFocus?.(event); }}
          onBlur={event => { setFocused(false); onBlur?.(event); }}
          onCompositionStart={event => { setComposing(true); onCompositionStart?.(event); }}
          onCompositionEnd={event => { setComposing(false); trackSelection(event.currentTarget); onCompositionEnd?.(event); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || composing || event.keyCode === 229) return;
            if (open && ['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key) && !event.shiftKey) {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === 'Escape') setSelection(null);
              else if (event.key === 'Enter') { if (active) choose(active.index); }
              else setActiveIndex(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, options.length)) % Math.max(1, options.length));
              return;
            }
            onKeyDown?.(event);
          }}
          onPressEnter={event => {
            if (!event.defaultPrevented && !composing && !event.nativeEvent.isComposing && event.keyCode !== 229 && !(open && !event.shiftKey)) onPressEnter?.(event);
          }}
        />
        </div>
      </Popover>
      {error && <div id={errorId} role="alert" className="image-mention-error" style={{ color: token.colorError }}>{error}</div>}
    </div>
  );
});

export default ImageMentionInput;
