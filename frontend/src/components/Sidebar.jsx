import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { auth } from '../lib/api';

const NAV = [
  { to: '/',          icon: '⊞',  label: 'Dashboard' },
  { to: '/projects',  icon: '📁', label: 'Projects' },
  { to: '/jobs',      icon: '◈',  label: 'Job Explorer' },
  { to: '/workers',   icon: '⚙',  label: 'Workers' },
  { to: '/dlq',       icon: '☠',  label: 'Dead Letter Queue' },
  { to: '/admin',     icon: '🛡', label: 'Admin (Roles)' },
  { to: '/settings',  icon: '⚙',  label: 'Settings' },
];

export default function Sidebar() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);

  useEffect(() => {
    auth.me().then(setUser).catch(() => {});
  }, []);

  const handleLogout = () => {
    auth.logout();
    navigate('/login');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon" style={{ background: 'var(--color-primary)', color: 'var(--color-bg)', fontWeight: 800 }}>JR</div>
        <span className="sidebar-logo-text" style={{ letterSpacing: '0.5px', fontWeight: 800 }}>JobRunR</span>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section-label">Menu</div>
        {NAV.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      <div style={{ borderTop: '1px solid var(--color-border)', padding: 'var(--space-4) var(--space-5)' }}>
        {user && (
          <div style={{ marginBottom: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 'var(--font-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {user.full_name || 'User'}
            </span>
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </span>
          </div>
        )}
        <button
          className="btn btn-ghost"
          style={{ width: '100%', justifyContent: 'flex-start', gap: 'var(--space-2)', fontSize: 'var(--font-sm)' }}
          onClick={handleLogout}
        >
          <span>⎋</span> Logout
        </button>
      </div>
    </aside>
  );
}
