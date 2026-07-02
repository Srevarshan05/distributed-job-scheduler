import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (tab === 'login') {
        await auth.login(email, password);
      } else {
        await auth.signup(email, password, name);
        await auth.login(email, password);
      }
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--color-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      color: 'var(--color-text-primary)',
    }}>
      <div style={{
        maxWidth: 1000,
        width: '100%',
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: '60px',
        alignItems: 'center',
      }}>
        {/* Left Side: Brand presentation */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#09090b',
              color: '#ffffff',
              fontWeight: 900,
              fontSize: 22,
              borderRadius: 'var(--radius-lg)',
              width: 50,
              height: 50,
              marginBottom: 16,
            }}>JR</div>
            <h1 style={{
              fontSize: 48,
              fontWeight: 800,
              letterSpacing: '-1.5px',
              lineHeight: 1.1,
              color: '#09090b',
              margin: 0,
            }}>
              JobRunR
            </h1>
            <p style={{
              fontSize: 18,
              color: 'var(--color-text-secondary)',
              marginTop: 10,
              fontWeight: 400,
            }}>
              The ultimate high-fidelity distributed job scheduler for mission-critical operations.
            </p>
          </div>

          {/* Features Checklist */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {[
              {
                title: 'Atomic Claim Skip-Locking',
                desc: 'Uses pg_try_advisory_xact_lock / SKIP LOCKED mechanics for guaranteed zero-concurrency execution.'
              },
              {
                title: 'Resource-Aware Scheduling',
                desc: 'Intelligent routing that matches standard or high-compute worker nodes with corresponding queues.'
              },
              {
                title: 'AI Failure Diagnostics',
                desc: 'Integrated with llama-3.3-70b-versatile to read failing attempts and build automated plain-English analysis.'
              },
              {
                title: 'Live CPU & Memory Telemetry',
                desc: 'Sub-second worker heartbeats and hardware load metrics are broadcast directly to the dashboard.'
              },
              {
                title: 'Developer CSV & PDF Exports',
                desc: 'Generate complete ReportLab PDF summary log records for external audit log auditing.'
              }
            ].map((f, i) => (
              <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                <span style={{
                  fontSize: 12,
                  background: '#09090b',
                  border: '1px solid var(--color-border)',
                  color: '#ffffff',
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  flexShrink: 0,
                  marginTop: 2,
                }}>✓</span>
                <div>
                  <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#09090b' }}>{f.title}</h4>
                  <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Side: Integrated Grayscale Sign-In */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          padding: '40px var(--space-8)',
          boxShadow: 'var(--shadow-lg)',
        }}>
          {/* Tab switcher */}
          <div style={{ display: 'flex', marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--color-border)' }}>
            {['login', 'signup'].map(t => (
              <button
                key={t}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: 0,
                  borderBottom: tab === t ? '2px solid #09090b' : '2px solid transparent',
                  color: tab === t ? '#09090b' : 'var(--color-text-secondary)',
                  fontWeight: tab === t ? 600 : 400,
                  fontSize: 14,
                  textAlign: 'center',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
                onClick={() => { setTab(t); setError(''); }}
              >
                {t === 'login' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit}>
            {tab === 'signup' && (
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <label style={{ display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                  Full Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your name"
                  style={inputStyle}
                />
              </div>
            )}
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{ display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                style={inputStyle}
              />
            </div>
            <div style={{ marginBottom: 'var(--space-6)' }}>
              <label style={{ display: 'block', fontSize: 'var(--font-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                style={inputStyle}
              />
            </div>

            {error && (
              <div style={{
                background: 'var(--color-border-light)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text-primary)',
                padding: 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--font-sm)',
                marginBottom: 'var(--space-4)',
                lineHeight: 1.4,
              }}>
                ⚠️ {error}
              </div>
            )}

            <button
              type="submit"
              style={{
                width: '100%',
                padding: '12px',
                background: '#09090b',
                color: '#ffffff',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                transition: 'opacity var(--transition)',
              }}
              disabled={loading}
              onMouseOver={e => e.currentTarget.style.opacity = 0.9}
              onMouseOut={e => e.currentTarget.style.opacity = 1}
            >
              {loading ? 'Processing…' : tab === 'login' ? 'Sign In to Dashboard' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '10px 14px',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--font-sm)',
  outline: 'none',
  fontFamily: 'inherit',
  background: '#ffffff',
  color: '#09090b',
};
