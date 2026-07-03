import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [isSignUpActive, setIsSignUpActive] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleNavScroll = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const script = document.createElement('script');
    script.src = "https://unpkg.com/@lottiefiles/dotlottie-wc@0.9.14/dist/dotlottie-wc.js";
    script.type = "module";
    document.body.appendChild(script);
    return () => {
      document.body.removeChild(script);
    };
  }, []);

  // --- Animation States ---
  const [simMode, setSimMode] = useState('success'); // 'success', 'failure'
  const [simStep, setSimStep] = useState(0); // 0 to 5 for the horizontal step cards
  const [simProgress, setSimProgress] = useState(0);
  const [attempts, setAttempts] = useState(1);

  // Batch / Load Balancer simulation states
  const [batchStep, setBatchStep] = useState(0); // 0: Idle, 1: Enqueue/Router, 2: Load Balancing to Workers, 3: Completed
  const [w1Progress, setW1Progress] = useState(0);
  const [w2Progress, setW2Progress] = useState(0);
  const [w3Progress, setW3Progress] = useState(0);

  // Export report simulation states
  const [exportFormat, setExportFormat] = useState('PDF');
  const [exportState, setExportState] = useState('idle'); // 'idle', 'running', 'success'
  const [exportProgress, setExportProgress] = useState(0);
  const [exportLines, setExportLines] = useState([]);

  // Lifecycle loop timer
  useEffect(() => {
    const interval = setInterval(() => {
      setSimStep(prev => {
        if (prev === 0) return 1; // Queued -> Scheduled
        if (prev === 1) return 2; // Scheduled -> Claimed
        if (prev === 2) {
          // Claimed -> Running
          setSimProgress(0);
          return 3;
        }
        if (prev === 3) {
          // Running -> Retries or Outcomes
          if (simMode === 'failure' && attempts < 3) {
            setAttempts(a => a + 1);
            return 4; // Go to Retries
          }
          return 5; // Go to Final Outcome (Success/DLQ)
        }
        if (prev === 4) {
          // Retries -> Queued loop
          return 0;
        }
        // Completed -> Loop back
        setAttempts(1);
        return 0;
      });
    }, 4500);

    return () => clearInterval(interval);
  }, [simMode, attempts]);

  // Handle running progress bar ticker
  useEffect(() => {
    if (simStep === 3) {
      const pInterval = setInterval(() => {
        setSimProgress(p => {
          if (p >= 100) {
            clearInterval(pInterval);
            return 100;
          }
          return p + 10;
        });
      }, 100);
      return () => clearInterval(pInterval);
    }
  }, [simStep]);

  // Load balancer / Batch simulation handler
  const triggerBatchSim = () => {
    if (batchStep > 0) return;
    
    // Step 1: Batch Submission & Routing
    setBatchStep(1);
    setW1Progress(0);
    setW2Progress(0);
    setW3Progress(0);

    // Step 2: Load Balancing to Workers
    setTimeout(() => {
      setBatchStep(2);
      
      // Animate progress on standard-1, standard-2, and high-1 concurrently
      let w1 = 0, w2 = 0, w3 = 0;
      const t1 = setInterval(() => {
        w1 += 10;
        setW1Progress(w1);
        if (w1 >= 100) clearInterval(t1);
      }, 120);

      const t2 = setInterval(() => {
        w2 += 8;
        setW2Progress(w2);
        if (w2 >= 100) clearInterval(t2);
      }, 150);

      const t3 = setInterval(() => {
        w3 += 12;
        setW3Progress(w3);
        if (w3 >= 100) {
          clearInterval(t3);
          // Step 3: Completed
          setTimeout(() => setBatchStep(3), 600);
        }
      }, 90);

    }, 1500);
  };

  const resetBatchSim = () => {
    setBatchStep(0);
    setW1Progress(0);
    setW2Progress(0);
    setW3Progress(0);
  };

  // Export logs simulation handler
  const triggerExportSim = () => {
    if (exportState === 'running') return;
    setExportState('running');
    setExportProgress(0);
    setExportLines([]);

    const logMessages = [
      'Establishing transaction pipeline...',
      'Filtering job logs where status is completed...',
      'Found 1,492 matching logs.',
      'Formatting table lines for PDF compiler...',
      'Writing document metadata structure...',
      'Finalizing file stream and downloading...'
    ];

    let step = 0;
    const interval = setInterval(() => {
      if (step >= logMessages.length) {
        clearInterval(interval);
        setExportState('success');
        return;
      }
      setExportLines(prev => [...prev, logMessages[step]]);
      setExportProgress(Math.floor(((step + 1) / logMessages.length) * 100));
      step++;
    }, 500);
  };

  // Intersection Observer for scroll animations
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const handleSignInSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignUpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await auth.signup(email, password, name);
      await auth.login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: '#fafafa', minHeight: '100vh', fontFamily: 'var(--font-family)', color: '#09090b', overflowX: 'hidden' }}>
      
      {/* Global CSS for transitions */}
      <style>{`
        .scroll-reveal {
          opacity: 0;
          transform: translateY(35px);
          transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .scroll-reveal.visible {
          opacity: 1;
          transform: translateY(0);
        }
        .nav-hover {
          transition: color 0.2s ease;
        }
        .nav-hover:hover {
          color: #09090b !important;
        }

        /* Classic Sliding login container layout */
        .auth-container {
          background-color: #ffffff;
          border: 1px solid #e4e4e7;
          border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.02);
          position: relative;
          overflow: hidden;
          width: 820px;
          max-width: 100%;
          min-height: 520px;
          display: flex;
        }

        .form-container {
          position: absolute;
          top: 0;
          height: 100%;
          transition: all 0.6s ease-in-out;
          width: 50%;
          padding: 40px 50px;
          background: #ffffff;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .sign-in-container {
          left: 0;
          z-index: 2;
          opacity: 1;
        }

        .sign-up-container {
          left: 0;
          opacity: 0;
          z-index: 1;
        }

        .auth-container.right-panel-active .sign-in-container {
          transform: translateX(100%);
          opacity: 0;
        }

        .auth-container.right-panel-active .sign-up-container {
          transform: translateX(100%);
          opacity: 1;
          z-index: 5;
        }

        .overlay-container {
          position: absolute;
          top: 0;
          left: 50%;
          width: 50%;
          height: 100%;
          overflow: hidden;
          transition: transform 0.6s ease-in-out;
          z-index: 100;
        }

        .auth-container.right-panel-active .overlay-container {
          transform: translateX(-100%);
        }

        .overlay {
          background: #09090b;
          color: #ffffff;
          position: relative;
          left: -100%;
          height: 100%;
          width: 200%;
          transform: translateX(0);
          transition: transform 0.6s ease-in-out;
          display: flex;
        }

        .auth-container.right-panel-active .overlay {
          transform: translateX(50%);
        }

        .overlay-panel {
          position: absolute;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          padding: 0 40px;
          text-align: center;
          top: 0;
          height: 100%;
          width: 50%;
          transform: translateX(0);
          transition: transform 0.6s ease-in-out;
        }

        .overlay-left {
          transform: translateX(-20%);
        }

        .auth-container.right-panel-active .overlay-left {
          transform: translateX(0);
        }

        .overlay-right {
          right: 0;
          transform: translateX(0);
        }

        .auth-container.right-panel-active .overlay-right {
          transform: translateX(20%);
        }

        /* Flow connection lines animation */
        @keyframes pulseLine {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -20; }
        }
        .flow-line-active {
          stroke: #09090b;
          stroke-width: 2;
          stroke-dasharray: 6, 6;
          animation: pulseLine 1.5s linear infinite;
          fill: none;
        }
      `}</style>

      {/* 1. Header Navigation Bar */}
      <header style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #e4e4e7',
        padding: '0 var(--space-8)',
        height: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            background: '#09090b', color: '#ffffff', fontWeight: 900, fontSize: 18,
            borderRadius: 6, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>JR</div>
          <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '0.2px', fontFamily: 'var(--font-header)' }}>JobRunR</span>
        </div>

        <nav style={{ display: 'flex', gap: 32, fontSize: 14, fontWeight: 500 }}>
          <span onClick={() => handleNavScroll('hero')} className="nav-hover" style={navLinkStyle}>Home</span>
          <span onClick={() => handleNavScroll('lifecycle')} className="nav-hover" style={navLinkStyle}>Data Lifecycle</span>
          <span onClick={() => handleNavScroll('strategies')} className="nav-hover" style={navLinkStyle}>Strategies</span>
          <span onClick={() => handleNavScroll('batch')} className="nav-hover" style={navLinkStyle}>Batch Processing</span>
          <span onClick={() => handleNavScroll('export')} className="nav-hover" style={navLinkStyle}>Report Exports</span>
        </nav>

        <div>
          <button className="btn btn-primary btn-sm" onClick={() => handleNavScroll('hero')} style={{ padding: '8px 16px' }}>
            Get Started
          </button>
        </div>
      </header>

      {/* 2. Hero Section (Split Column with Sliding Panel) */}
      <section id="hero" style={{
        padding: '80px var(--space-8) 100px var(--space-8)',
        display: 'flex',
        justifyContent: 'center',
        background: 'radial-gradient(circle at top right, #f4f4f5, #ffffff)'
      }}>
        <div style={{ maxWidth: 1300, width: '100%', display: 'grid', gridTemplateColumns: '1fr 1.1fr', gap: 40, alignItems: 'center' }}>
          
          {/* Left Pitch */}
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              background: '#e4e4e7', color: '#09090b', fontSize: 12, fontWeight: 700,
              padding: '4px 10px', borderRadius: 12, textTransform: 'uppercase', marginBottom: 20
            }}>
              Background Task Manager
            </div>
            <h1 style={{ fontSize: 50, fontWeight: 900, lineHeight: 1.05, letterSpacing: '-1.5px', margin: '0 0 20px 0', fontFamily: 'var(--font-header)' }}>
              Run background tasks reliably <br />
              <span style={{ color: '#71717a' }}>without duplication.</span>
            </h1>
            <p style={{ fontSize: 18, color: '#71717a', lineHeight: 1.5, margin: '0 0 30px 0', maxWidth: 500 }}>
              JobRunR runs heavy tasks in the background, explains why errors happen in plain English, and tracks worker machine status in real-time.
            </p>
            <div style={{ display: 'flex', gap: 16 }}>
              <button className="btn btn-primary" onClick={() => handleNavScroll('lifecycle')} style={{ padding: '14px 28px' }}>
                Explore Lifecycle
              </button>
            </div>
          </div>

          {/* Right Sliding Form Card */}
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div className={`auth-container ${isSignUpActive ? 'right-panel-active' : ''}`}>
              
              {/* Form 1: Sign Up */}
              <div className="form-container sign-up-container">
                <form onSubmit={handleSignUpSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px 0', letterSpacing: '-0.5px', fontFamily: 'var(--font-header)' }}>Create Account</h2>
                  <div>
                    <label style={labelStyle}>Full Name</label>
                    <input
                      type="text" value={name} onChange={e => setName(e.target.value)}
                      placeholder="John Doe" required style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Email Address</label>
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com" required style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Password</label>
                    <input
                      type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" required style={inputStyle}
                    />
                  </div>
                  {error && <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div>}
                  <button type="submit" className="btn btn-primary" style={{ padding: '12px', marginTop: 10 }}>
                    {loading ? 'Registering...' : 'Sign Up'}
                  </button>
                </form>
              </div>

              {/* Form 2: Sign In */}
              <div className="form-container sign-in-container">
                <form onSubmit={handleSignInSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 10px 0', letterSpacing: '-0.5px', fontFamily: 'var(--font-header)' }}>Sign In</h2>
                  <div>
                    <label style={labelStyle}>Email Address</label>
                    <input
                      type="email" value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@company.com" required style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>Password</label>
                    <input
                      type="password" value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" required style={inputStyle}
                    />
                  </div>
                  {error && <div style={{ color: '#b91c1c', fontSize: 12 }}>{error}</div>}
                  <button type="submit" className="btn btn-primary" style={{ padding: '12px', marginTop: 10 }}>
                    {loading ? 'Connecting...' : 'Sign In'}
                  </button>
                </form>
              </div>

              {/* Slide Overlay */}
              <div className="overlay-container">
                <div className="overlay">
                  
                  <div className="overlay-panel overlay-left">
                    <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 15px 0', fontFamily: 'var(--font-header)' }}>Welcome Back</h2>
                    <p style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.8, margin: '0 0 30px 0' }}>
                      To keep monitoring your background workers, sign in with your credentials.
                    </p>
                    <button
                      className="btn btn-outline"
                      style={{ color: '#ffffff', borderColor: '#ffffff', padding: '10px 30px' }}
                      onClick={() => setIsSignUpActive(false)}
                    >
                      Sign In
                    </button>
                  </div>

                  <div className="overlay-panel overlay-right">
                    <h2 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 15px 0', fontFamily: 'var(--font-header)' }}>Hello, Friend</h2>
                    <p style={{ fontSize: 13, lineHeight: 1.5, opacity: 0.8, margin: '0 0 30px 0' }}>
                      Enter your details to create a new workspace organization and start scheduler nodes.
                    </p>
                    <button
                      className="btn btn-outline"
                      style={{ color: '#ffffff', borderColor: '#ffffff', padding: '10px 30px' }}
                      onClick={() => setIsSignUpActive(true)}
                    >
                      Sign Up
                    </button>
                  </div>

                </div>
              </div>

            </div>
          </div>

        </div>
      </section>

      {/* 3. Section: High Precision Data Lifecycle Animation (FIRST IMAGE UI MAP) */}
      <section id="lifecycle" className="scroll-reveal" style={{ padding: '100px var(--space-8) 120px var(--space-8)', background: '#ffffff', borderTop: '1px solid #e4e4e7', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: 1200, width: '100%' }}>
          
          <div style={{ textAlign: 'center', marginBottom: 50 }}>
            <h2 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-1.2px', fontFamily: 'var(--font-header)' }}>Automated Task Execution & Data Lifecycle</h2>
            <p style={{ fontSize: 16, color: '#71717a', marginTop: 10, maxWidth: 700, marginLeft: 'auto', marginRight: 'auto' }}>
              See how JobRunR transforms raw tasks into active jobs, tracked executions, and error explanations.
            </p>

            <div style={{ display: 'inline-flex', background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 8, padding: 4, marginTop: 20 }}>
              {[
                { key: 'success', label: 'Success Lifecycle' },
                { key: 'failure', label: 'Failure & DLQ Lifecycle' }
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => { setSimMode(opt.key); setSimStep(0); setAttempts(1); }}
                  style={{
                    padding: '6px 16px', border: 'none', background: simMode === opt.key ? '#09090b' : 'none',
                    color: simMode === opt.key ? '#ffffff' : '#71717a',
                    fontWeight: 700, borderRadius: 6, cursor: 'pointer', fontSize: 12
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Lifecycle Card Grid Connected horizontally */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            {[
              {
                title: 'Queued',
                desc: 'Task details saved securely to SQLite/Postgre database.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                )
              },
              {
                title: 'Scheduled',
                desc: 'Task processed by scheduler poller at execution time.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                )
              },
              {
                title: 'Claimed',
                desc: 'Row locked via advisory locks to prevent duplicates.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )
              },
              {
                title: 'Running',
                desc: 'Background worker node actively executes payload.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="12" x2="16" y2="14" />
                  </svg>
                )
              },
              {
                title: 'Retries',
                desc: 'If temporary errors occur, task loops back to queue.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                )
              },
              {
                title: simMode === 'failure' ? 'DLQ Failed' : 'Completed',
                desc: simMode === 'failure' ? 'Exhausted retries promoted to DLQ explanation.' : 'Finished successfully and cleaned up database row.',
                icon: simMode === 'failure' ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )
              }
            ].map((step, idx) => {
              const isCurrent = simStep === idx;
              const isPassed = simStep > idx;

              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', flex: '1 1 14%', minWidth: 150 }}>
                  <div style={{
                    background: '#ffffff',
                    border: isCurrent ? '2px solid #09090b' : '1px solid #e4e4e7',
                    borderRadius: 12,
                    padding: '24px 16px',
                    textAlign: 'center',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    minHeight: 220,
                    boxShadow: isCurrent ? '0 8px 24px rgba(0,0,0,0.04)' : 'none',
                    transform: isCurrent ? 'scale(1.03)' : 'scale(1)',
                    transition: 'all 0.4s ease'
                  }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: '50%',
                      background: '#f0fdf4',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      marginBottom: 16
                    }}>
                      {step.icon}
                    </div>
                    <strong style={{ fontSize: 14, color: '#09090b', display: 'block', marginBottom: 8, fontFamily: 'var(--font-header)' }}>
                      {step.title}
                    </strong>
                    <span style={{ fontSize: 11, color: '#71717a', lineHeight: 1.4 }}>
                      {step.desc}
                    </span>
                  </div>

                  {idx < 5 && (
                    <div style={{ color: '#e4e4e7', fontWeight: 900, fontSize: 14, padding: '0 4px', display: 'flex', alignItems: 'center' }}>
                      <span style={{ color: isPassed ? '#09090b' : '#e4e4e7', transition: 'color 0.4s ease' }}>→</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Simulation Active Info Boxes below the lifecycle cards */}
          <div style={{ marginTop: 30, background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 12, padding: 24 }}>
            {simStep === 3 && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                  <span>Processor Node standard-1 Active execution progress</span>
                  <span>{simProgress}%</span>
                </div>
                <div style={{ height: 4, background: '#e4e4e7', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${simProgress}%`, height: '100%', background: '#09090b', transition: 'width 0.1s linear' }}></div>
                </div>
              </div>
            )}
            {simStep === 4 && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ background: '#d97706', color: '#ffffff', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10 }}>RETRYING</span>
                <span style={{ fontSize: 13, color: '#71717a' }}>Attempt {attempts} / 3: Temporary network connection dropped. Looping back to Queued state.</span>
              </div>
            )}
            {simStep === 5 && simMode === 'success' && (
              <div style={{ fontSize: 13, color: '#166534', fontWeight: 500 }}>
                Done: Task resolved successfully in 740ms. Database record finalized.
              </div>
            )}
            {simStep === 5 && simMode === 'failure' && (
              <div style={{ fontSize: 13, color: '#991b1b', fontWeight: 500 }}>
                DLQ: Job aborted permanently after 3 attempts. AI Breakdown generated.
              </div>
            )}
            {simStep !== 3 && simStep !== 4 && simStep !== 5 && (
              <span style={{ fontSize: 13, color: '#71717a' }}>Pipeline Status: Moving to next execution queue phase.</span>
            )}
          </div>

        </div>
      </section>

      {/* 4. Section: Premium Distributed Job Strategy (SECOND IMAGE UI MAP - RELEVANT COPY) */}
      <section id="strategies" className="scroll-reveal" style={{ padding: '100px var(--space-8)', background: '#fafafa', borderTop: '1px solid #e4e4e7', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: 1200, width: '100%' }}>
          
          {/* Centered strategy header */}
          <div style={{ textAlign: 'center', marginBottom: 50 }}>
            <div style={{
              display: 'inline-flex', background: '#f0fdf4', border: '1px solid #16a34a', color: '#166534',
              fontSize: 10, fontWeight: 700, padding: '4px 14px', borderRadius: 9999, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16
            }}>
              Featured Strategy Option
            </div>
            <h2 style={{ fontSize: 36, fontWeight: 900, letterSpacing: '-1px', fontFamily: 'var(--font-header)', margin: '0 0 12px 0' }}>
              Premium Distributed Job Strategy
            </h2>
            <p style={{ fontSize: 16, color: '#71717a', maxWidth: 650, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.5 }}>
              High-performance job isolation with concurrent worker assignments. Route processing loads without execution blockages.
            </p>
          </div>

          {/* Row of 5 strategy cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
            {[
              {
                num: '1. Queue Isolation',
                desc: 'Bind specific tasks to dedicated standard or high compute queues.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
                )
              },
              {
                num: '2. Claim Lock Protection',
                desc: 'Atomic skip-locking database queries prevent duplicate executions.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                )
              },
              {
                num: '3. AI Diagnostics',
                desc: 'Decode stack traces instantly when tasks are promoted to DLQ.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                )
              },
              {
                num: '4. Live Telemetry',
                desc: 'Websocket broadcasts of sub-second CPU and memory metrics.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                )
              },
              {
                num: '5. Audit Logs',
                desc: 'Generate ReportLab PDF summaries and CSV logs on demand.',
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00A99D" strokeWidth="2.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
                  </svg>
                )
              }
            ].map((card, i) => (
              <div key={i} style={{
                background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 8, padding: 24, textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: 180, justifyContent: 'center'
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: '50%', background: '#f0fdf4',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14
                }}>
                  {card.icon}
                </div>
                <strong style={{ fontSize: 13, color: '#09090b', display: 'block', marginBottom: 6, fontFamily: 'var(--font-header)' }}>{card.num}</strong>
                <span style={{ fontSize: 11, color: '#71717a', lineHeight: 1.4 }}>{card.desc}</span>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* 5. Section: Distributed Computing & Load Balancer Flowchart (NEW GRAPHIC FLOWCHART) */}
      <section id="batch" className="scroll-reveal" style={{ padding: '100px var(--space-8)', background: '#ffffff', borderTop: '1px solid #e4e4e7', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: 1200, width: '100%', display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 80, alignItems: 'center' }}>
          
          {/* Dynamic Flowchart Graphics */}
          <div style={{
            background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 16, padding: '40px 30px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.01)', minHeight: 400, display: 'flex', flexDirection: 'column',
            justifyContent: 'space-between', position: 'relative', overflow: 'hidden'
          }}>
            
            {/* SVG Connecting Flow Lines */}
            <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
              {batchStep === 1 && (
                <path d="M 285 90 L 285 170" className="flow-line-active" />
              )}
              {batchStep === 2 && (
                <>
                  <path d="M 285 90 L 285 170" stroke="#09090b" strokeWidth="1" fill="none" opacity="0.2" />
                  <path d="M 285 220 L 95 300" className="flow-line-active" />
                  <path d="M 285 220 L 285 300" className="flow-line-active" />
                  <path d="M 285 220 L 475 300" className="flow-line-active" />
                </>
              )}
              {batchStep === 3 && (
                <>
                  <path d="M 285 90 L 285 170" stroke="#16a34a" strokeWidth="2" fill="none" />
                  <path d="M 285 220 L 95 300" stroke="#16a34a" strokeWidth="2" fill="none" />
                  <path d="M 285 220 L 285 300" stroke="#16a34a" strokeWidth="2" fill="none" />
                  <path d="M 285 220 L 475 300" stroke="#16a34a" strokeWidth="2" fill="none" />
                </>
              )}
            </svg>

            {/* TOP: Batch Source */}
            <div style={{ display: 'flex', justifyContent: 'center', zIndex: 2 }}>
              <div style={{
                background: batchStep === 0 ? '#09090b' : '#ffffff',
                color: batchStep === 0 ? '#ffffff' : '#09090b',
                border: '2px solid #09090b',
                borderRadius: 8, padding: '12px 20px', width: 260, textAlign: 'center',
                transition: 'all 0.5s ease',
                boxShadow: batchStep === 0 ? '0 8px 20px rgba(0,0,0,0.06)' : 'none'
              }}>
                <strong style={{ fontSize: 13, display: 'block', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Batch Jobs Source</strong>
                <span style={{ fontSize: 11, color: batchStep === 0 ? '#a1a1aa' : '#71717a' }}>5,000 tasks queued</span>
              </div>
            </div>

            {/* MIDDLE: Intelligent Load Balancer Router */}
            <div style={{ display: 'flex', justifyContent: 'center', zIndex: 2, margin: '20px 0' }}>
              <div style={{
                background: batchStep === 1 ? '#09090b' : '#ffffff',
                color: batchStep === 1 ? '#ffffff' : '#09090b',
                border: '2px solid #09090b',
                borderRadius: '50%', width: 150, height: 50, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', textAlign: 'center',
                transition: 'all 0.5s ease',
                boxShadow: batchStep === 1 ? '0 8px 20px rgba(0,0,0,0.06)' : 'none'
              }}>
                <strong style={{ fontSize: 11, textTransform: 'uppercase' }}>Load Balancer</strong>
                <span style={{ fontSize: 9, color: batchStep === 1 ? '#a1a1aa' : '#71717a' }}>Queue router</span>
              </div>
            </div>

            {/* BOTTOM: Distributed Workers (spanned concurrently) */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, zIndex: 2 }}>
              {[
                { name: 'Worker node 1', type: 'Standard', progress: w1Progress },
                { name: 'Worker node 2', type: 'Standard', progress: w2Progress },
                { name: 'Worker node 3', type: 'High Compute', progress: w3Progress }
              ].map((worker, i) => {
                const isActive = batchStep === 2;
                const isDone = batchStep === 3;
                return (
                  <div key={i} style={{
                    flex: 1, background: '#ffffff',
                    border: isDone ? '2px solid #16a34a' : isActive ? '2px solid #09090b' : '1px solid #e4e4e7',
                    borderRadius: 8, padding: 12,
                    boxShadow: isActive ? '0 4px 12px rgba(0,0,0,0.04)' : 'none',
                    transition: 'all 0.4s ease'
                  }}>
                    <strong style={{ fontSize: 12, display: 'block', color: isDone ? '#16a34a' : '#09090b' }}>{worker.name}</strong>
                    <span style={{ fontSize: 9, color: '#71717a' }}>Class: {worker.type}</span>
                    
                    <div style={{ marginTop: 10 }}>
                      {isDone ? (
                        <span style={{ fontSize: 10, color: '#16a34a', fontWeight: 700 }}>Completed</span>
                      ) : isActive ? (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
                            <span>Computing</span>
                            <span>{worker.progress}%</span>
                          </div>
                          <div style={{ height: 3, background: '#e4e4e7', borderRadius: 1.5, overflow: 'hidden', marginTop: 4 }}>
                            <div style={{ width: `${worker.progress}%`, height: '100%', background: '#09090b' }}></div>
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: 9, color: '#a1a1aa' }}>Standby</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

          </div>

          {/* Description */}
          <div>
            <h2 style={sectionTitleStyle}>Scalable batch processing engine.</h2>
            <p style={sectionDescStyle}>
              Submit groups of tasks simultaneously as single transaction sets. The scheduler load balancer splits the batch across multiple worker nodes to maintain system throughput, resolving bulk jobs efficiently.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button className="btn btn-primary" onClick={triggerBatchSim} disabled={batchStep > 0 && batchStep < 3}>
                {batchStep > 0 && batchStep < 3 ? 'Running...' : 'Simulate Load Balancer'}
              </button>
              <button className="btn btn-outline" onClick={resetBatchSim}>
                Reset Flow
              </button>
            </div>
          </div>

        </div>
      </section>

      {/* 6. Section: Logs & Reports Export Animation */}
      <section id="export" className="scroll-reveal" style={{ padding: '100px var(--space-8)', background: '#fafafa', borderTop: '1px solid #e4e4e7', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: 1200, width: '100%', display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: 80, alignItems: 'center' }}>
          
          <div>
            <h2 style={sectionTitleStyle}>Comprehensive log & report exports.</h2>
            <p style={sectionDescStyle}>
              Export complete task run reports for developer diagnostics or audit trails. Generate clean spreadsheets or PDF summaries built directly by our ReportLab compiling engine.
            </p>

            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              {['PDF', 'CSV'].map(fmt => (
                <button
                  key={fmt}
                  onClick={() => setExportFormat(fmt)}
                  style={{
                    padding: '8px 20px', border: '1px solid #e4e4e7', borderRadius: 8,
                    background: exportFormat === fmt ? '#09090b' : '#ffffff',
                    color: exportFormat === fmt ? '#ffffff' : '#09090b',
                    fontWeight: 700, cursor: 'pointer', fontSize: 13
                  }}
                >
                  {fmt} format
                </button>
              ))}
            </div>

            <button
              className="btn btn-outline"
              onClick={triggerExportSim}
              disabled={exportState === 'running'}
              style={{ width: '100%', padding: '12px' }}
            >
              {exportState === 'running' ? 'Compiling Report...' : `Export System ${exportFormat}`}
            </button>
          </div>

          <div style={{
            background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 16, padding: 32,
            boxShadow: '0 4px 20px rgba(0,0,0,0.01)', minHeight: 380, display: 'flex', flexDirection: 'column',
            position: 'relative', overflow: 'hidden'
          }}>
            
            {exportState === 'idle' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#71717a' }}>
                <dotlottie-wc src="https://lottie.host/dc817b73-a86b-47f2-9f0a-ec6a415fabfc/6YPOQGxhh2.lottie" style={{ width: '300px', height: '300px' }} autoplay="true" loop="true"></dotlottie-wc>
                <span style={{ fontSize: 13, marginTop: 12 }}>Click Export on the left to compile report.</span>
              </div>
            )}

            {exportState === 'running' && (
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <strong style={{ fontSize: 13 }}>Compiling PDF Summary Document</strong>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{exportProgress}%</span>
                </div>
                <div style={{ height: 4, background: '#e4e4e7', borderRadius: 2, overflow: 'hidden', marginBottom: 20 }}>
                  <div style={{ width: `${exportProgress}%`, height: '100%', background: '#09090b', transition: 'width 0.3s ease' }}></div>
                </div>

                <div style={{
                  background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 8, padding: 16,
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: '#71717a', flex: 1, display: 'flex', flexDirection: 'column', gap: 6
                }}>
                  {exportLines.map((line, idx) => (
                    <div key={idx} style={{ borderBottom: '1px solid #f4f4f5', paddingBottom: 4 }}>
                      {line}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {exportState === 'success' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, animation: 'fadeIn 0.5s ease' }}>
                <div style={{
                  width: 50, height: 50, borderRadius: '50%', background: '#f0fdf4', border: '2px solid #16a34a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a', marginBottom: 16
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <strong style={{ fontSize: 15, marginBottom: 4 }}>Export Completed Successfully</strong>
                <span style={{ fontSize: 12, color: '#71717a', marginBottom: 20 }}>
                  system_logs_{exportFormat.toLowerCase()}.{exportFormat.toLowerCase()} compiled (242 entries)
                </span>
                <button className="btn btn-outline btn-sm" onClick={() => setExportState('idle')}>Export Again</button>
              </div>
            )}

          </div>

        </div>
      </section>

      {/* 7. Section: Real-time Lifecycle Tracking of Worker Nodes */}
      <section id="telemetry" className="scroll-reveal" style={{ padding: '100px var(--space-8)', background: '#ffffff', borderTop: '1px solid #e4e4e7', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: 1200, width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>
          
          {/* Mock Telemetry Graphic Panel */}
          <div style={{ background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 16, padding: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.01)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <strong style={{ fontSize: 15, fontWeight: 700 }}>Live Worker Status</strong>
              <span style={{ fontSize: 10, background: '#e4e4e7', padding: '2px 8px', borderRadius: 10, textTransform: 'uppercase', fontWeight: 700 }}>Live ws</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Node 1 */}
              <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%' }}></span>
                    <strong style={{ fontSize: 13 }}>Standard Background Worker #1</strong>
                  </div>
                  <span style={{ fontSize: 11, color: '#71717a' }}>standard-1</span>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700 }}>
                      <span>CPU Load</span>
                      <span>42%</span>
                    </div>
                    <div style={{ height: 6, background: '#f4f4f5', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                      <div style={{ width: '42%', height: '100%', background: '#09090b' }}></div>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700 }}>
                      <span>Memory</span>
                      <span>124 MB</span>
                    </div>
                    <div style={{ height: 6, background: '#f4f4f5', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                      <div style={{ width: '25%', height: '100%', background: '#71717a' }}></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Node 2 */}
              <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 12, padding: 18 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%' }}></span>
                    <strong style={{ fontSize: 13 }}>High-Compute Task Worker #2</strong>
                  </div>
                  <span style={{ fontSize: 11, color: '#71717a' }}>high-1</span>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700 }}>
                      <span>CPU Load</span>
                      <span>88%</span>
                    </div>
                    <div style={{ height: 6, background: '#f4f4f5', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                      <div style={{ width: '88%', height: '100%', background: '#09090b' }}></div>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 700 }}>
                      <span>Memory</span>
                      <span>1.2 GB</span>
                    </div>
                    <div style={{ height: 6, background: '#f4f4f5', borderRadius: 3, overflow: 'hidden', marginTop: 4 }}>
                      <div style={{ width: '60%', height: '100%', background: '#71717a' }}></div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <h2 style={sectionTitleStyle}>Real-time lifecycle tracking of all active worker nodes.</h2>
            <p style={sectionDescStyle}>
              Watch worker node state changes and resource consumption in real time. WebSocket connectivity streams sub-second hardware load telemetry (CPU core utilization and memory footprints) directly to your monitoring cards.
            </p>
            <ul style={{ paddingLeft: 20, margin: 0, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 15, color: '#71717a' }}>
              <li><strong>Fluid Activity Logs:</strong> Automatic pulsing loaders indicate active execution cycles.</li>
              <li><strong>Offline Grace Period Detection:</strong> Heartbeat timeouts automatically flag dead nodes.</li>
              <li><strong>Capacity Aware Allocation:</strong> Real-time loads prevent resource overloading.</li>
            </ul>
          </div>

        </div>
      </section>

      {/* 8. Section: Strong DB Design (Transactional Skip-Locking) */}
      <section id="db-design" className="scroll-reveal" style={{ padding: '100px var(--space-8)', background: '#fafafa', borderTop: '1px solid #e4e4e7', display: 'flex', justifyContent: 'center' }}>
        <div style={{ maxWidth: 1200, width: '100%', display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 80, alignItems: 'center' }}>
          
          {/* Description */}
          <div>
            <h2 style={sectionTitleStyle}>Built to avoid database claim conflicts.</h2>
            <p style={sectionDescStyle}>
              The system locks database rows so no two workers attempt to run the same task at the same time. Multiple worker nodes query the database concurrently without race conditions.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
              {[
                { title: "No waiting on locks", desc: "Workers skip locked rows instantly instead of blocking on databases." },
                { title: "Zero duplicates", desc: "No background task is ever claimed twice by separate background threads." },
                { title: "Automatic clean recovery", desc: "Database-level rollback safeguards ensure failed job claims reset cleanly." }
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 14 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, background: '#09090b', color: '#ffffff', width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {i + 1}
                  </div>
                  <div>
                    <strong style={{ fontSize: 15, color: '#09090b' }}>{item.title}</strong>
                    <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#71717a' }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Strong DB Visual Graphics Box instead of Code Snippets */}
          <div style={{ background: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 16, padding: 36, boxShadow: '0 4px 20px rgba(0,0,0,0.01)' }}>
            <strong style={{ fontSize: 16, display: 'block', marginBottom: 20 }}>How task claiming prevents duplicates</strong>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Row 1 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 8 }}>
                <div>
                  <span style={{ fontSize: 11, color: '#71717a', fontWeight: 600 }}>Job #3492</span>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>GeneratePDFReport</div>
                </div>
                <span style={{ fontSize: 10, background: '#f4f4f5', padding: '2px 8px', borderRadius: 4, color: '#09090b', fontWeight: 700 }}>CLAIMED BY WORKER 1</span>
              </div>

              {/* Row 2 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, background: '#fafafa', border: '2px solid #09090b', borderRadius: 8 }}>
                <div>
                  <span style={{ fontSize: 11, color: '#71717a', fontWeight: 600 }}>Job #3493</span>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>ProcessPaymentRequest</div>
                </div>
                <span style={{ fontSize: 10, background: '#09090b', padding: '2px 8px', borderRadius: 4, color: '#ffffff', fontWeight: 700 }}>NEXT CLAIM FOR WORKER 2</span>
              </div>

              {/* Row 3 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, background: '#fafafa', border: '1px solid #e4e4e7', borderRadius: 8, opacity: 0.6 }}>
                <div>
                  <span style={{ fontSize: 11, color: '#71717a', fontWeight: 600 }}>Job #3494</span>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>SendWelcomeEmail</div>
                </div>
                <span style={{ fontSize: 10, color: '#71717a', fontWeight: 600 }}>QUEUED</span>
              </div>
            </div>

            <div style={{ borderTop: '1px solid #e4e4e7', marginTop: 24, paddingTop: 16, fontSize: 12, color: '#71717a', lineHeight: 1.4 }}>
              💡 <strong>Skip-Locking Principle:</strong> Rather than forcing Worker 2 to wait for Worker 1 to release its lock on Job #3492, Worker 2 simply skips the locked row and claims Job #3493 instantly.
            </div>
          </div>

        </div>
      </section>

      {/* 9. Black Banner CTA Section */}
      <section style={{
        background: '#000000',
        padding: '80px var(--space-8)',
        color: '#ffffff',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <h2 style={{ fontSize: 36, fontWeight: 800, color: '#ffffff', fontFamily: 'var(--font-header)', marginBottom: 12 }}>
          Orchestrate your tasks. Scale your business.
        </h2>
        <p style={{ fontSize: 15, color: '#a1a1aa', marginBottom: 32 }}>
          Deploy instantly. Zero configuration required.
        </p>
        <div style={{ display: 'flex', gap: 16 }}>
          <button
            onClick={() => handleNavScroll('hero')}
            style={{
              background: '#00A99D', color: '#ffffff', border: 'none', borderRadius: 6,
              padding: '12px 30px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              transition: 'opacity 0.2s ease'
            }}
            onMouseOver={e => e.currentTarget.style.opacity = 0.9}
            onMouseOut={e => e.currentTarget.style.opacity = 1}
          >
            SIGN UP FOR FREE
          </button>
          <button
            onClick={() => handleNavScroll('lifecycle')}
            style={{
              background: 'transparent', color: '#ffffff', border: '1px solid #a1a1aa', borderRadius: 6,
              padding: '12px 30px', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              transition: 'border-color 0.2s ease'
            }}
            onMouseOver={e => e.currentTarget.style.borderColor = '#ffffff'}
            onMouseOut={e => e.currentTarget.style.borderColor = '#a1a1aa'}
          >
            BOOK A DEMO
          </button>
        </div>
      </section>

      {/* 10. Multi-column Footer */}
      <footer style={{
        padding: '80px var(--space-8) 60px var(--space-8)',
        background: '#ffffff',
        borderTop: '1px solid #e4e4e7',
        display: 'flex',
        justifyContent: 'center'
      }}>
        <div style={{ maxWidth: 1200, width: '100%', display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 60 }}>
          
          {/* Column 1: Brand Info */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <div style={{
                background: '#09090b', color: '#ffffff', fontWeight: 900, fontSize: 18,
                borderRadius: 6, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>JR</div>
              <span style={{ fontWeight: 800, fontSize: 18, letterSpacing: '0.2px', fontFamily: 'var(--font-header)' }}>JobRunR</span>
            </div>
            <p style={{ fontSize: 13, color: '#71717a', lineHeight: 1.6, maxWidth: 320 }}>
              Enterprise background task manager optimized for claim-safe promotion management, system telemetry tracking, and distributed compute scaling.
            </p>
          </div>

          {/* Column 2: Products */}
          <div>
            <h4 style={footerColHeaderStyle}>PRODUCTS</h4>
            <ul style={footerColListStyle}>
              <li><span onClick={() => handleNavScroll('lifecycle')} style={footerLinkStyle}>Features</span></li>
              <li><span onClick={() => handleNavScroll('strategies')} style={footerLinkStyle}>Projects</span></li>
              <li><span onClick={() => handleNavScroll('batch')} style={footerLinkStyle}>Workspaces</span></li>
            </ul>
          </div>

          {/* Column 3: Resources */}
          <div>
            <h4 style={footerColHeaderStyle}>RESOURCES</h4>
            <ul style={footerColListStyle}>
              <li><span onClick={() => handleNavScroll('lifecycle')} style={footerLinkStyle}>How it works</span></li>
              <li><span onClick={() => handleNavScroll('strategies')} style={footerLinkStyle}>Why JobRunR</span></li>
              <li><a href="https://github.com/Srevarshan05/distributed-job-scheduler.git" target="_blank" rel="noreferrer" style={footerLinkStyle}>GitHub Project</a></li>
            </ul>
          </div>

          {/* Column 4: Enterprise */}
          <div>
            <h4 style={footerColHeaderStyle}>ENTERPRISE</h4>
            <ul style={footerColListStyle}>
              <li><span onClick={() => handleNavScroll('hero')} style={footerLinkStyle}>Sign In</span></li>
              <li><span onClick={() => handleNavScroll('hero')} style={footerLinkStyle}>Launch App</span></li>
            </ul>
          </div>

        </div>
      </footer>

    </div>
  );
}

// Sub styling configurations
const footerColHeaderStyle = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '1px',
  color: '#09090b',
  marginBottom: 20
};

const footerColListStyle = {
  listStyle: 'none',
  padding: 0,
  margin: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 12
};

const footerLinkStyle = {
  fontSize: 13,
  color: '#71717a',
  cursor: 'pointer',
  textDecoration: 'none',
  transition: 'color 0.2s ease',
  ':hover': { color: '#09090b' }
};

const navLinkStyle = {
  cursor: 'pointer',
  color: '#71717a',
  transition: 'color var(--transition)',
};

const labelStyle = {
  display: 'block',
  fontSize: 'var(--font-xs)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  color: 'var(--color-text-secondary)',
  marginBottom: 6,
};

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

const sectionTitleStyle = {
  fontSize: 32,
  fontWeight: 800,
  letterSpacing: '-0.8px',
  lineHeight: 1.15,
  margin: '0 0 20px 0',
  color: '#09090b'
};

const sectionDescStyle = {
  fontSize: 16,
  color: '#71717a',
  lineHeight: 1.5,
  margin: '0 0 24px 0',
};
