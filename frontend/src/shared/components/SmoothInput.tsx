import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import gsap from 'gsap';
import './smoothInput.css';

export interface SmoothInputProps extends ComponentPropsWithoutRef<'input'> {
  label?: string;
  /** Shown on the right of the label row, e.g. a "Forgot password?" link. */
  labelAside?: ReactNode;
  hint?: ReactNode;
  leftElement?: ReactNode;
  rightElement?: ReactNode;
}

const IS_FIREFOX = typeof navigator !== 'undefined' && /firefox|fxios/i.test(navigator.userAgent);
const IS_CHROMIUM = typeof navigator !== 'undefined' && /chrome|chromium|crios/i.test(navigator.userAgent);
const PASSWORD_CHAR = IS_FIREFOX ? '●' : '•';
const EMAIL_PATTERN = '[^@\\s]+@[^@\\s]+\\.[^@\\s]+';

/**
 * A text field whose caret glides smoothly as you type (ported from the NGO project).
 *
 * The browser's own caret is hidden and replaced by a thin animated bar. Its position is
 * worked out by measuring the text before the caret in a hidden span that copies the input's
 * font. GSAP's quickTo gives the glide, so no extra animation library is needed.
 * email/number types are rendered as text (with the right keyboard) because the browser
 * blocks reading the caret position on those types; an email pattern keeps basic validation.
 */
export const SmoothInput = forwardRef<HTMLInputElement, SmoothInputProps>(function SmoothInput(
  {
    label,
    labelAside,
    hint,
    leftElement,
    rightElement,
    className,
    id,
    type = 'text',
    value,
    defaultValue,
    onChange,
    onFocus,
    onBlur,
    onSelect,
    onClick,
    onKeyUp,
    onKeyDown,
    inputMode,
    autoComplete,
    pattern,
    disabled,
    ...rest
  },
  forwardedRef
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const [internalValue, setInternalValue] = useState(String(defaultValue ?? ''));

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const caretRef = useRef<HTMLSpanElement>(null);
  const glideTo = useRef<((x: number) => void) | null>(null);
  const placed = useRef(false); // false until the caret has been positioned since focus

  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement);

  const isControlled = value !== undefined;
  const text = isControlled ? String(value ?? '') : internalValue;

  const isEmail = type === 'email';
  const isNumber = type === 'number';
  const resolvedType = isEmail || isNumber ? 'text' : type;
  const resolvedInputMode = isEmail ? 'email' : isNumber ? 'numeric' : inputMode;
  const resolvedAutoComplete = isEmail && !autoComplete ? 'email' : autoComplete;
  const resolvedPattern = isEmail && !pattern ? EMAIL_PATTERN : pattern;

  const showCaret = (visible: boolean) => {
    if (caretRef.current) caretRef.current.style.opacity = visible ? '1' : '0';
  };

  const syncMeasureSpan = useCallback(() => {
    const input = inputRef.current;
    const span = measureRef.current;
    if (!input || !span) return;
    const s = window.getComputedStyle(input);
    let fontSize = s.fontSize;
    // Password bullets are drawn larger than the bullet character in non-Chromium browsers.
    if (PASSWORD_CHAR === '•' && type === 'password' && !IS_CHROMIUM) fontSize = `${parseFloat(fontSize) + 6.25}px`;
    span.style.fontFamily = s.fontFamily;
    span.style.fontSize = fontSize;
    span.style.fontWeight = s.fontWeight;
    span.style.fontStyle = s.fontStyle;
    span.style.letterSpacing = s.letterSpacing;
    span.style.fontFeatureSettings = s.fontFeatureSettings;
    span.style.textTransform = s.textTransform;
  }, [type]);

  const update = useCallback(
    (input: HTMLInputElement) => {
      const span = measureRef.current;
      const caret = caretRef.current;
      if (!span || !caret) return;

      let start: number | null = null;
      let end: number | null = null;
      try {
        start = input.selectionStart;
        end = input.selectionEnd;
      } catch {
        /* some input types do not expose a selection */
      }
      const value = input.value || '';
      const hasSelection = start !== null && start !== end;
      const index = start === null ? value.length : input.selectionDirection === 'backward' ? start : (end ?? start);

      const before = type === 'password' ? PASSWORD_CHAR.repeat(index) : value.slice(0, index);
      syncMeasureSpan();
      span.textContent = before;
      const s = window.getComputedStyle(input);
      const padLeft = parseFloat(s.paddingLeft) || 0;
      const padRight = parseFloat(s.paddingRight) || 0;
      const width = before.length > 0 ? (span.getBoundingClientRect().width || span.offsetWidth) + padLeft : padLeft;

      // keep the caret inside the visible part of a long value
      const maxScroll = Math.max(0, input.scrollWidth - input.clientWidth);
      const visibleRight = input.scrollLeft + input.clientWidth - padRight;
      const visibleLeft = input.scrollLeft + padLeft;
      if (width > visibleRight) input.scrollLeft = Math.min(width - input.clientWidth + padRight, maxScroll);
      else if (width < visibleLeft) input.scrollLeft = Math.max(0, width - padLeft);

      const x = Math.min(Math.max(width - input.scrollLeft, padLeft), input.clientWidth - padRight);
      if (!placed.current) {
        gsap.set(caret, { x }); // first placement after focus: appear in place, do not glide in from the left edge
        placed.current = true;
      } else {
        glideTo.current?.(x);
      }
      const visible = width - input.scrollLeft >= padLeft - 2 && width - input.scrollLeft <= input.clientWidth - padRight + 2;
      showCaret(visible && !hasSelection);
    },
    [type, syncMeasureSpan]
  );

  const updateRef = useRef(update);
  updateRef.current = update;
  const later = (target: HTMLInputElement) => requestAnimationFrame(() => updateRef.current(target));

  useEffect(() => {
    const caret = caretRef.current;
    if (!caret) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    glideTo.current = gsap.quickTo(caret, 'x', { duration: reduce ? 0 : 0.16, ease: 'power3.out' });
    return () => {
      glideTo.current = null;
      gsap.killTweensOf(caret);
    };
  }, []);

  // value changed from outside (for example the field was cleared): re-place the caret
  useEffect(() => {
    const input = inputRef.current;
    if (input && document.activeElement === input) updateRef.current(input);
  }, [text, type]);

  useEffect(() => {
    const input = inputRef.current;
    const container = containerRef.current;
    if (!input || !container) return;
    const ifFocused = () => {
      if (document.activeElement === input) updateRef.current(input);
    };
    const onSelectionChange = () => {
      if (document.activeElement === input) later(input);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    input.addEventListener('scroll', ifFocused);
    void document.fonts?.ready.then(ifFocused);
    const ro = new ResizeObserver(ifFocused);
    ro.observe(container);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      input.removeEventListener('scroll', ifFocused);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="si-field">
      {(label || labelAside) && (
        <div className="si-label-row">
          {label && (
            <label className="si-label" htmlFor={inputId}>
              {label}
            </label>
          )}
          {labelAside}
        </div>
      )}

      <div className={`si-box${leftElement ? ' has-left' : ''}${rightElement ? ' has-right' : ''}`} data-disabled={disabled || undefined}>
        {leftElement && <div className="si-side">{leftElement}</div>}

        <div className="si-inner" ref={containerRef}>
          <input
            {...rest}
            id={inputId}
            ref={inputRef}
            className={`si-input${className ? ` ${className}` : ''}`}
            type={resolvedType}
            inputMode={resolvedInputMode}
            autoComplete={resolvedAutoComplete}
            pattern={resolvedPattern}
            disabled={disabled}
            value={text}
            onChange={(e) => {
              if (!isControlled) setInternalValue(e.target.value);
              onChange?.(e);
              later(e.currentTarget);
            }}
            onFocus={(e) => {
              placed.current = false;
              later(e.currentTarget);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              showCaret(false);
              placed.current = false;
              onBlur?.(e);
            }}
            onSelect={(e) => {
              updateRef.current(e.currentTarget);
              onSelect?.(e);
            }}
            onClick={(e) => {
              updateRef.current(e.currentTarget);
              onClick?.(e);
            }}
            onKeyUp={(e) => {
              updateRef.current(e.currentTarget);
              onKeyUp?.(e);
            }}
            onKeyDown={(e) => {
              later(e.currentTarget);
              onKeyDown?.(e);
            }}
          />
          <span className="si-measure" ref={measureRef} aria-hidden="true" />
          <span className="si-caret" ref={caretRef} aria-hidden="true">
            <i />
          </span>
        </div>

        {rightElement && <div className="si-side">{rightElement}</div>}
      </div>

      {hint && <small className="si-hint">{hint}</small>}
    </div>
  );
});

export default SmoothInput;
