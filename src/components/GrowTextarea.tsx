import { useLayoutEffect, useRef } from 'react';

/** Chat composer input: a textarea that auto-grows upward with its content (up
 *  to `maxRows`, then scrolls) instead of scrolling horizontally. Enter sends,
 *  Shift+Enter inserts a newline. */
export function GrowTextarea({
  value,
  onChange,
  onEnter,
  placeholder,
  disabled,
  autoFocus,
  maxRows = 6,
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  maxRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto'; // shrink first so it can also get smaller
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const extra = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * maxRows + extra;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, maxRows]);

  return (
    <textarea
      ref={ref}
      className="chat-textarea"
      rows={1}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onEnter();
        }
      }}
    />
  );
}
