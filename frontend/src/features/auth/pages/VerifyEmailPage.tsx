import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { authApi } from '../auth.api';

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

  return (
    <div className="auth-page">
      <div className="card">
        {state === 'loading' && <p>Verifying your email...</p>}
        {state === 'ok' && (
          <>
            <h1>Email verified</h1>
            <p className="muted">Your account is active. You can log in now.</p>
            <Link className="btn" to="/login">
              Go to login
            </Link>
          </>
        )}
        {state === 'error' && (
          <>
            <h1>Verification failed</h1>
            <div className="alert error">{message}</div>
            <p className="muted">Log in with your email and password to request a new verification email.</p>
            <Link className="btn" to="/login">
              Go to login
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
