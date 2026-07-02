import { useEffect, useState } from 'react';
import { orgs, members } from '../lib/api';
import Breadcrumb from '../components/Breadcrumb';
import Topbar from '../components/Topbar';

function fmt(dt) {
  if (!dt) return '—';
  return new Date(dt).toLocaleString();
}

export default function AdminPage() {
  const [userList, setUserList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState(null);
  const [userRole, setUserRole] = useState('member_read_only');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form State
  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState('member_read_only');
  const [formError, setFormError] = useState('');
  const [successCreds, setSuccessCreds] = useState(null);

  useEffect(() => {
    loadMembers();
  }, []);

  async function loadMembers() {
    setLoading(true);
    try {
      const orgList = await orgs.list();
      if (!orgList.items?.length) { setLoading(false); return; }
      const org = orgList.items[0];
      setOrgId(org.id);
      setUserRole(org.role || 'member_read_only');

      const mList = await members.list(org.id);
      setUserList(mList || []);
    } catch (e) {
      console.error('Failed to load members:', e);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setFormError('');
    setSuccessCreds(null);
    setCreating(true);

    try {
      await members.create(orgId, {
        full_name: formName,
        email: formEmail,
        password: formPassword,
        role: formRole
      });

      // Save credentials for sharing modal
      setSuccessCreds({
        name: formName,
        email: formEmail,
        password: formPassword,
        role: formRole
      });

      // Reset form
      setFormName('');
      setFormEmail('');
      setFormPassword('');
      setFormRole('member_read_only');

      // Reload members list
      await loadMembers();
    } catch (err) {
      setFormError(err.message || 'Failed to add user.');
    } finally {
      setCreating(false);
    }
  }

  const getRoleLabel = (role) => {
    switch (role) {
      case 'owner':
        return { label: 'Administrator (Owner)', bg: '#09090b', color: '#ffffff' };
      case 'member_read_write':
        return { label: 'Read & Write Access', bg: '#f4f4f5', color: '#09090b' };
      case 'member_read_only':
        return { label: 'Read-Only Access', bg: '#fafafa', color: '#71717a' };
      default:
        return { label: role, bg: '#f4f4f5', color: '#09090b' };
    }
  };

  return (
    <>
      <Topbar
        title="Admin (Roles)"
        subtitle="Manage access control and user memberships"
        actions={
          userRole === 'owner' && (
            <button className="btn btn-primary btn-sm" onClick={() => { setSuccessCreds(null); setShowCreate(true); }}>
              + Invite User
            </button>
          )
        }
      />
      <div className="page-body">
        <Breadcrumb items={[
          { label: 'Settings', to: '/settings' },
          { label: 'Admin (Roles)' }
        ]} />

        <div className="table-container">
          <div className="table-toolbar">
            <div className="table-toolbar-title">Active Workspace Members</div>
            <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)', marginTop: 2 }}>
              ✦ Add, edit, or configure permission access levels for users in this organization.
            </div>
          </div>

          {loading ? (
            <div className="loading-row"><div className="spinner" /> Loading workspace members…</div>
          ) : userList.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" style={{ fontSize: 36 }}>🛡</div>
              <div className="empty-state-title">No members found</div>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Email Address</th>
                  <th>Role & Access Level</th>
                  <th>Joined Date</th>
                </tr>
              </thead>
              <tbody>
                {userList.map(u => {
                  const badge = getRoleLabel(u.role);
                  return (
                    <tr key={u.id} className="fade-in-row">
                      <td>
                        <strong style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-primary)' }}>
                          {u.full_name || '—'}
                        </strong>
                      </td>
                      <td>
                        <span style={{ fontSize: 'var(--font-sm)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                          {u.email}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          background: badge.bg,
                          color: badge.color,
                          padding: '3px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          border: '1px solid var(--color-border)',
                          textTransform: 'uppercase',
                          letterSpacing: '0.2px'
                        }}>
                          {badge.label}
                        </span>
                      </td>
                      <td>
                        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
                          {fmt(u.joined_at)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Invite User Dialog Modal */}
      {showCreate && (
        <div style={modalOverlayStyle}>
          <div style={modalContentStyle} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 'var(--font-lg)', fontWeight: 700 }}>Invite New Workspace Member</h3>
              <button onClick={() => setShowCreate(false)} style={{ fontSize: 18, color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
            </div>

            {successCreds ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div style={{ background: '#fafafa', border: '1px solid var(--color-border)', color: '#09090b', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>
                  <strong style={{ display: 'block', marginBottom: 'var(--space-1)', color: '#16a34a' }}>✓ User Created Successfully</strong>
                  <span>Share these credentials with the user to allow login:</span>
                  <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                    <div><strong>Name:</strong> {successCreds.name}</div>
                    <div><strong>Email:</strong> {successCreds.email}</div>
                    <div><strong>Password:</strong> <code style={{ background: '#f4f4f5', padding: '2px 6px', borderRadius: 3 }}>{successCreds.password}</code></div>
                    <div><strong>Access:</strong> {getRoleLabel(successCreds.role).label}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
                  <button className="btn btn-primary" onClick={() => setShowCreate(false)}>Done</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                {formError && (
                  <div style={{ background: 'var(--color-danger-light)', color: 'var(--color-danger)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-sm)' }}>
                    {formError}
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Full Name</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. John Doe"
                    className="filter-select"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px' }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="e.g. john@company.com"
                    className="filter-select"
                    value={formEmail}
                    onChange={e => setFormEmail(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px' }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Password</label>
                  <input
                    type="password"
                    required
                    placeholder="Minimum 6 characters"
                    className="filter-select"
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px' }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Role & Access Level</label>
                  <select
                    className="filter-select"
                    value={formRole}
                    onChange={e => setFormRole(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <option value="member_read_only">Read-Only Access (Can view only)</option>
                    <option value="member_read_write">Read & Write Access (Can submit jobs/queues)</option>
                    <option value="owner">Administrator (Full Owner access)</option>
                  </select>
                  <span style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'block', marginTop: 4 }}>
                    Determines the privilege and level of actions this user can perform in the workspace.
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                  <button type="button" className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={creating}>
                    {creating ? 'Creating…' : 'Create User'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Modal Inline Styles
const modalOverlayStyle = {
  position: 'fixed',
  top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0, 0, 0, 0.4)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const modalContentStyle = {
  width: 500,
  maxHeight: '90vh',
  overflowY: 'auto',
  background: 'var(--color-surface)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-lg)',
  padding: 'var(--space-5)',
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
