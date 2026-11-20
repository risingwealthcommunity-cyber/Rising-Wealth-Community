import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SmoothInput } from '../../../shared/components/SmoothInput';
import AuthShell from '../components/AuthShell';
import { MailIcon } from '../components/Icons';
import VerifyCodeForm from '../components/VerifyCodeForm';

/** Enter the emailed 6-digit code (reached from the login page, or when the link is not at hand). */
export default function VerifyEmailCodePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [confirmed, setConfirmed] = useState(Boolean(params.get('email')));

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    setConfirmed(true);
  };

  return (
    <AuthShell
      icon={<MailIcon />}
      title="Verify your email"
      subtitle={
        confirmed ? (
          <>
            Enter the 6-digit code we emailed to <b>{email}</b>. Lost it? Ask for a new one below.
          </>
        ) : (
          'Enter the email you signed up with.'
        )
      }
      footer={<Link to="/login">{'←'} Back to login</Link>}
    >
      {confirmed ? (
        <>
          <VerifyCodeForm email={email.trim().toLowerCase()} onVerified={() => navigate('/login?verified=true', { replace: true })} />
          <button type="button" className="au-linkbtn" onClick={() => setConfirmed(false)}>
            Use a different email
          </button>
        </>
      ) : (
        <form className="au-form" onSubmit={onEmail}>
          <SmoothInput
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            autoComplete="email"
            required
          />
          <button className="au-btn">Continue</button>
        </form>
      )}
    </AuthShell>
  );
}
