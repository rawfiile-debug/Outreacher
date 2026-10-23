import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in | OUTREACHER' };

export default function LoginPage() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">OUTREACHER<small>BY RAWFIILE</small></div>
        <h2>Sign in</h2>
        <p className="small">Use the same email and password as FRAME.</p>
        <Suspense fallback={null}><LoginForm /></Suspense>
      </div>
    </div>
  );
}
