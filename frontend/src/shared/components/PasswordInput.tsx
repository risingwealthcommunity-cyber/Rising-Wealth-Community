import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';

/** A password box with an eye button that shows or hides what was typed. */
export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <span className="pw-wrap">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-eye" aria-label={show ? 'Hide the password' : 'Show the password'} aria-pressed={show} onClick={() => setShow((v) => !v)} tabIndex={-1}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {show ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 6.2A9.8 9.8 0 0 1 12 6c5 0 8.5 4 9.5 6a12 12 0 0 1-3.1 3.8M6.3 7.6A12.4 12.4 0 0 0 2.5 12c1 2 4.5 6 9.5 6a9.6 9.6 0 0 0 3.6-.7" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            </>
          ) : (
            <>
              <path d="M2.5 12C3.5 10 7 6 12 6s8.5 4 9.5 6c-1 2-4.5 6-9.5 6s-8.5-4-9.5-6z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </span>
  );
}
