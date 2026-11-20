import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { authApi } from '../auth.api';
import AuthShell from '../components/AuthShell';
import { CheckIcon, MailIcon } from '../components/Icons';

export default function VerifyEmailPage() {
  const { token = '' } = useParams();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice in dev; the link is single-use so only call once.
    if (started.current) return;
    started.current = true;

    authApi
      .verifyEmail(token)
      .then(() => setState('ok'))
      .catch((err: Error) => {
        setMessage(err.message);
        setState('error');
      });
  }, [token]);

  if (state === 'loading') {
    return (
      <AuthShell
        spin
        icon={
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M12 3a9 9 0 1 0 9 9" />
          </svg>
        }
        title="Verifying your email"
        subtitle="One moment..."
      >
        <span />
      </AuthShell>
    );
  }

  if (state === 'ok') {
    return (
      <AuthShell icon={<CheckIcon size={28} />} title="Email verified" subtitle="Your account is active. You can log in now.">
        <Link className="au-btn" to="/login">
          Go to login
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      icon={<MailIcon />}
      title="Verification failed"
      subtitle="Log in with your email and password to get a new verification email."
    >
      <div className="au-alert error">{message}</div>
      <Link className="au-btn" to="/login">
        Go to login
      </Link>
    </AuthShell>
  );
}
