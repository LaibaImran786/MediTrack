import { useEffect, useMemo, useState } from 'react'
import {
  health, register, login, meds, addMed, deleteMed, takeMed,
  adherence, notifications, readNotification, readAllNotifications,
  uploadPrescription
} from './api'

const blank = { name: '', dosage: '', frequency: 'Once daily', time: '08:00', start_date: '', end_date: '', instructions: '' }

const nav = [
  ['dashboard', '⌂', 'Dashboard'],
  ['medications', '💊', 'Medications'],
  ['add', '＋', 'Add Medicine'],
  ['prescription', '▤', 'Prescription'],
  ['history', '◷', 'History'],
  ['reports', '▥', 'Reports'],
  ['profile', '◎', 'Profile']
]

function App() {
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user') || 'null'))
  const [page, setPage] = useState('dashboard')
  const [items, setItems] = useState([])
  const [stats, setStats] = useState({
    total: 0,
    taken: 0,
    pending: 0,
    percentage: 0,
    weekly: []
  })
  const [notes, setNotes] = useState([])
  const [unread, setUnread] = useState(0)
  const [form, setForm] = useState(blank)
  function usePrescriptionMedicine(m) {
    setForm({
      ...blank,
      name: m.name || '',
      dosage: m.dosage || '',
      frequency: m.frequency || '',
      time: m.time || '',
      instructions: m.instructions || ''
    })

    setPage('add')
    setMessage('Review the extracted details before saving.')
  }
  const [authMode, setAuthMode] = useState('login')
  const [auth, setAuth] = useState({ name: '', email: '', password: '' })
  const [message, setMessage] = useState('')
  const [mobile, setMobile] = useState(false)
  const [installPrompt, setInstallPrompt] = useState(null)
  const [installable, setInstallable] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    const handler = e => { e.preventDefault(); setInstallPrompt(e); setInstallable(true) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  useEffect(() => {
    const expired = () => setUser(null)
    window.addEventListener('auth-expired', expired)
    return () => window.removeEventListener('auth-expired', expired)
  }, [])

  async function refresh() {
    if (!user) return
    try {
      const [m, s, n] = await Promise.all([meds(), adherence(), notifications()])
      setItems(m); setStats(s); setNotes(n.items); setUnread(n.unread)
      maybeBrowserNotify(n.items)
    } catch (e) { setMessage(e.message) }
  }

  useEffect(() => { refresh() }, [user])

  useEffect(() => {
    if (!user) return
    const timer = setInterval(refresh, 60000)
    return () => clearInterval(timer)
  }, [user])

  async function maybeBrowserNotify(list) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    const lastSeen = Number(localStorage.getItem('last-notification-id') || 0)
    const fresh = list.filter(n => !n.read && n.id > lastSeen)
    if (fresh.length) {
      const n = fresh[0]
      new Notification(n.title, { body: n.body.split('|')[0] })
      localStorage.setItem('last-notification-id', String(Math.max(...fresh.map(x => x.id))))
    }
  }

  async function enableBrowserNotifications() {
    if (!('Notification' in window)) { setMessage('This browser does not support notifications.'); return }
    const permission = await Notification.requestPermission()
    setMessage(permission === 'granted' ? 'Browser notifications enabled.' : 'Browser notifications were not allowed.')
  }

  async function submitAuth(e) {
    e.preventDefault()
    try {
      const r = authMode === 'login' ? await login(auth) : await register(auth)
      localStorage.setItem('token', r.access_token)
      localStorage.setItem('user', JSON.stringify(r.user))
      setUser(r.user); setMessage(authMode === 'login' ? 'Welcome back.' : 'Account created successfully.')
    } catch (e) { setMessage(e.message) }
  }

  async function add(e) {
    e.preventDefault()
    try { await addMed(form); setForm(blank); setPage('medications'); setMessage('Medication added.'); refresh() }
    catch (e) { setMessage(e.message) }
  }

  async function mark(id) {
    try { await takeMed(id); setMessage('Dose marked as taken.'); refresh() }
    catch (e) { setMessage(e.message) }
  }

  async function remove(id) {
    if (!confirm('Delete this medication?')) return
    try { await deleteMed(id); setMessage('Medication deleted.'); refresh() }
    catch (e) { setMessage(e.message) }
  }

  function logout() {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    localStorage.removeItem('last-notification-id')
    setUser(null); setPage('dashboard'); setNotes([]); setUnread(0)
  }

  async function installApp() {
    if (!installPrompt) return
    installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null); setInstallable(false)
  }

  function go(id) { setPage(id); setMobile(false) }

  if (!user) return <Auth auth={auth} setAuth={setAuth} mode={authMode} setMode={setAuthMode} submit={submitAuth} message={message} />

  return (
    <div className="shell">
      <aside className={`sidebar ${mobile ? 'open' : ''}`}>
        <div className="brand"><span>✚</span><div><b>MediTrack</b><small>Medication Management</small></div></div>
        <nav>
          {nav.map(([id, icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => go(id)}><span>{icon}</span>{label}</button>)}
          <button className="notification-nav" onClick={() => go('notifications')}><span>♢</span>Notifications{unread > 0 && <em>{unread > 99 ? '99+' : unread}</em>}</button>
        </nav>
        <div className="side-bottom">
          {installable && <button className="install-side" onClick={installApp}>⌄ Install MediTrack</button>}
          <button className="logout" onClick={logout}>↪ Logout</button>
        </div>
      </aside>

      <main>
        <header>
          <button className="mobile-menu" onClick={() => setMobile(!mobile)}>☰</button>
          <div><small>MEDICATION MANAGEMENT SYSTEM</small><h1>{page === 'dashboard' ? `Welcome, ${user.name?.split(' ')[0] || 'there'}` : pageTitle(page)}</h1></div>
          <div className="header-actions">
            {installable && <button className="install-btn" onClick={installApp}>Install app</button>}
            <button className="bell" onClick={() => go('notifications')}>♢{unread > 0 && <i>{unread}</i>}</button>
            <div className="profile-wrapper">
              <button
                className="user-menu"
                onClick={() => setProfileOpen(!profileOpen)}
                type="button"
              >
                <span>{user.name?.[0]?.toUpperCase()}</span>
                <b>{user.name}</b>
              </button>

              {profileOpen && (
                <div className="profile-dropdown">
                  <div className="profile-dropdown-user">
                    <div className="dropdown-avatar">
                      {user.name?.[0]?.toUpperCase()}
                    </div>

                    <div>
                      <strong>{user.name}</strong>
                      <small>{user.email}</small>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setPage('profile')
                      setProfileOpen(false)
                    }}
                  >
                    ◎ Profile
                  </button>

                  <button
                    type="button"
                    onClick={logout}
                  >
                    ↪ Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        {message && <div className="toast">{message}<button onClick={() => setMessage('')}>×</button></div>}

        <div className="content">
          {page === 'dashboard' && <Dashboard stats={stats} items={items} go={go} mark={mark} />}
          {page === 'medications' && <Medications items={items} go={go} mark={mark} remove={remove} />}
          {page === 'add' && <Add form={form} setForm={setForm} submit={add} />}
          {page === 'prescription' && (
            <Prescription
              setMessage={setMessage}
              useMedicine={usePrescriptionMedicine}
            />
          )}
          {page === 'history' && <History items={items} />}
          {page === 'reports' && <Reports stats={stats} items={items} />}
          {page === 'profile' && <Profile user={user} logout={logout} />}
          {page === 'notifications' && <Notifications notes={notes} unread={unread} refresh={refresh} enable={enableBrowserNotifications} />}
        </div>
      </main>
    </div>
  )
}

function pageTitle(p) { return { medications: 'Medications', add: 'Add Medicine', prescription: 'Prescription', history: 'Medication History', reports: 'Reports', profile: 'Profile', notifications: 'Notifications' }[p] || 'Dashboard' }

function Auth({ auth, setAuth, mode, setMode, submit, message }) {
  return <div className="auth-page"><div className="auth-orb one" /><div className="auth-orb two" /><div className="auth-card">
    <div className="brand auth-brand"><span>✚</span><b>MediTrack</b></div><div className="auth-icon">💊</div>
    <small>SMART MEDICATION MANAGEMENT</small><h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1><p>Organize medicines, reminders and adherence in one calm workspace.</p>
    <form onSubmit={submit}>{mode === 'register' && <label>Full name<input value={auth.name} onChange={e => setAuth({ ...auth, name: e.target.value })} required /></label>}<label>Email<input type="email" value={auth.email} onChange={e => setAuth({ ...auth, email: e.target.value })} required /></label><label>Password<input type="password" value={auth.password} onChange={e => setAuth({ ...auth, password: e.target.value })} minLength="6" required /></label><button className="primary">{mode === 'login' ? 'Sign in →' : 'Create account →'}</button></form>
    {message && <div className="error">{message}</div>}<button className="switch" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'New to MediTrack? Create an account' : 'Already have an account? Sign in'}</button>
  </div></div>
}

function Dashboard({ stats, items, go, mark }) {
  return (
    <>
      <section className="hero">
        <div>
          <small>YOUR HEALTH, ORGANIZED</small>
          <h2>Stay on top of your medications.</h2>
          <p>Keep your doses, prescriptions and daily routine organized.</p>
        </div>

        <button className="primary" onClick={() => go('add')}>
          ＋ Add medication
        </button>
      </section>

      <div className="stats">
        {[
          ['💊', 'Scheduled', stats.total, 'Today'],
          ['✓', 'Completed', stats.taken, 'Doses taken'],
          ['◷', 'Pending', stats.pending, 'Need attention'],
          ['♧', 'Adherence', `${stats.percentage}%`, 'Current rate']
        ].map(x => (
          <div className="stat" key={x[1]}>
            <span>{x[0]}</span>
            <small>{x[1]}</small>
            <strong>{x[2]}</strong>
            <em>{x[3]}</em>
          </div>
        ))}
      </div>

      <div className="grid2">

        <section className="panel">
          <div className="panel-head">
            <div>
              <h2>Today's schedule</h2>
              <p>Your medication plan</p>
            </div>

            <button onClick={() => go('medications')}>
              View all →
            </button>
          </div>

          {items.length ? (
            items.map(m => (
              <div className="med-row" key={m.id}>
                <div className="pill">💊</div>

                <div className="grow">
                  <b>{m.name}</b>
                  <p>{m.dosage} · {m.frequency}</p>
                  <small>
                    ⏱ {m.time} {m.instructions && `· ${m.instructions}`}
                  </small>
                </div>

                {m.taken ? (
                  <span className="taken">✓ Taken</span>
                ) : (
                  <button
                    className="primary small"
                    onClick={() => mark(m.id)}
                  >
                    Mark taken
                  </button>
                )}
              </div>
            ))
          ) : (
            <Empty go={() => go('add')} />
          )}
        </section>

        <section className="panel chart">
          <div className="panel-head">
            <div>
              <h2>Weekly adherence</h2>
              <p>Current progress</p>
            </div>

            <strong>{stats.percentage}%</strong>
          </div>

          <div className="line-chart">
            <svg viewBox="0 0 700 250" preserveAspectRatio="none">
              <line
                x1="0"
                y1={230 - (stats.percentage / 100) * 200}
                x2="700"
                y2={230 - (stats.percentage / 100) * 200}
                stroke="var(--coral)"
                strokeWidth="4"
              />
            </svg>

            <div className="line-labels">
              <small>M</small>
              <small>T</small>
              <small>W</small>
              <small>T</small>
              <small>F</small>
              <small>S</small>
              <small>S</small>
            </div>
          </div>
        </section>

      </div>

      <div className="quick">
        <button onClick={() => go('add')}>
          <b>＋</b>
          <span>
            <strong>Add medication</strong>
            <small>Create a new schedule</small>
          </span>
          →
        </button>

        <button onClick={() => go('prescription')}>
          <b>▤</b>
          <span>
            <strong>Scan prescription</strong>
            <small>Upload for Gemini analysis</small>
          </span>
          →
        </button>

        <button onClick={() => go('history')}>
          <b>◷</b>
          <span>
            <strong>Medication history</strong>
            <small>Review your doses</small>
          </span>
          →
        </button>
      </div>
    </>
  )
}

function Medications({ items, go, mark, remove }) { return <section><div className="page-head"><div><h2>My medications</h2><p>Manage your current schedule.</p></div><button className="primary" onClick={() => go('add')}>＋ Add medication</button></div><section className="panel">{items.length ? items.map(m => <div className="med-row" key={m.id}><div className="pill">💊</div><div className="grow"><b>{m.name}</b><p>{m.dosage} · {m.frequency} · {m.time}</p><small>{m.instructions || 'No special instructions'}</small></div><button className="danger" onClick={() => remove(m.id)}>Delete</button>{m.taken ? <span className="taken">✓ Taken</span> : <button className="primary small" onClick={() => mark(m.id)}>Take dose</button>}</div>) : <Empty go={() => go('add')} />}</section></section> }

function Add({ form, setForm, submit }) { return <section><div className="page-head"><div><h2>Add medication</h2><p>Create an easy-to-follow schedule.</p></div></div><section className="panel form-panel"><div className="form-title"><span>💊</span><div><h3>Medication details</h3><p>Enter information exactly as prescribed.</p></div></div><form onSubmit={submit} className="form-grid">{[['name', 'Medicine name', 'text', 'Paracetamol'], ['dosage', 'Dosage', 'text', '500 mg'], ['frequency', 'Frequency', 'text', 'Twice daily'], ['time', 'Time', 'time', ''], ['start_date', 'Start date', 'date', ''], ['end_date', 'End date', 'date', ''], ['instructions', 'Instructions', 'text', 'After meal']].map(([k, l, t, p]) => <label key={k}>{l}<input type={t} placeholder={p} value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} required={['name', 'dosage', 'frequency', 'time'].includes(k)} /></label>)}<button className="primary">Save medication →</button></form></section></section> }

function Prescription({ setMessage, useMedicine }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [analysis, setAnalysis] = useState(null)

  async function run() {
    if (!file) {
      return setMessage('Choose a prescription image first.')
    }

    setBusy(true)

    try {
      const r = await uploadPrescription(file)
      setAnalysis(r.analysis)
      setMessage(r.ai_status)
    } catch (e) {
      setMessage(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>Prescription scanner</h2>
          <p>
            Upload an image and let Gemini extract medication details.
          </p>
        </div>
      </div>

      <section className="panel upload-panel">

        <div className="upload-box">
          <div>▤</div>

          <h3>Upload prescription</h3>

          <p>JPG, PNG or WEBP · max 8 MB</p>

          <label className="file-btn">
            Choose image
            <input
              type="file"
              accept="image/*"
              onChange={e =>
                setFile(e.target.files?.[0] || null)
              }
            />
          </label>

          {file && (
            <p className="file-name">
              ✓ {file.name}
            </p>
          )}

          <button
            className="primary"
            disabled={busy}
            onClick={run}
          >
            {busy
              ? 'Analyzing…'
              : 'Upload & Analyze with Gemini'}
          </button>
        </div>

        {/* ADD THIS */}
        {busy && (
          <div className="analysis-loading">
            <div className="loading-spinner"></div>

            <strong>Analyzing prescription...</strong>

            <span>
              Gemini is reading the prescription and extracting medicines.
            </span>
          </div>
        )}

        {analysis && (
          <div className="analysis">

            <h3>AI extraction</h3>

            {analysis.medications?.length
              ? analysis.medications.map((m, i) => (
                <div
                  className="analysis-med"
                  key={i}
                >
                  <b>
                    {m.name || 'Unnamed medicine'}
                  </b>

                  <span>
                    {m.dosage || 'Dosage not detected'}
                    {' · '}
                    {m.frequency || 'Frequency not detected'}
                    {m.time && ` · ${m.time}`}
                  </span>

                  <small>
                    {m.instructions}
                  </small>

                  <small>
                    {m.instructions}
                  </small>

                  <button
                    className="primary"
                    type="button"
                    disabled={!m.name}
                    onClick={() => useMedicine(m)}
                  >
                    + Add to schedule
                  </button>

                </div>
              ))
              : (
                <p>
                  No medication entries were confidently extracted.
                </p>
              )}

            <div className="safety">
              <b>Verify before saving:</b>{' '}
              AI extraction is an assistant feature. Confirm every medicine,
              dose and timing with the prescription or pharmacist.
            </div>

          </div>
        )}

      </section>
    </section>
  )
}
function History({ items }) { return <section><div className="page-head"><div><h2>Medication history</h2><p>Review your dose status.</p></div></div><section className="panel">{items.length ? items.map(m => <div className="history-row" key={m.id}><span>{m.time}</span><div><b>{m.name}</b><small>{m.dosage} · {m.frequency}</small></div><strong className={m.taken ? 'ok' : 'pending'}>{m.taken ? '✓ Taken' : '○ Pending'}</strong></div>) : <Empty />}</section></section> }

function Reports({ stats, items }) { return <section><div className="page-head"><div><h2>Reports</h2><p>Medication activity overview.</p></div><div><button className="secondary" onClick={() => print()}>Print</button></div></div><div className="report-grid">{[['Adherence', `${stats.percentage}%`], ['Scheduled', stats.total], ['Completed', stats.taken], ['Pending', stats.pending]].map(x => <div className="report-card" key={x[0]}><small>{x[0]}</small><strong>{x[1]}</strong></div>)}</div><section className="panel"><h3>Medication overview</h3>{items.map(m => <div className="history-row" key={m.id}><span>{m.time}</span><div><b>{m.name}</b><small>{m.dosage} · {m.frequency}</small></div><strong className={m.taken ? 'ok' : 'pending'}>{m.taken ? 'Taken' : 'Pending'}</strong></div>)}</section></section> }

function Profile({ user, logout }) { return <section><div className="page-head"><div><h2>Profile</h2><p>Account and session controls.</p></div></div><section className="profile"><div className="panel profile-card"><div className="big-avatar">{user.name?.[0]?.toUpperCase()}</div><h2>{user.name}</h2><p>{user.email}</p><span className="status">Active account</span><button className="danger wide" onClick={logout}>Logout from this device</button></div><div className="panel"><h3>Security</h3><p>Your login uses a signed bearer token. Logging out removes the local session from this browser.</p><button className="secondary" onClick={logout}>Sign out</button></div></section></section> }

function Notifications({ notes, unread, refresh, enable }) { return <section><div className="page-head"><div><h2>Notifications</h2><p>{unread ? `${unread} unread notification${unread > 1 ? 's' : ''}` : 'You are all caught up.'}</p></div><div><button className="secondary" onClick={enable}>Enable browser alerts</button>{unread > 0 && <button className="primary" onClick={async () => { await readAllNotifications(); refresh() }}>Mark all read</button>}</div></div><section className="panel">{notes.length ? notes.map(n => <button className={`note ${n.read ? 'read' : ''}`} key={n.id} onClick={async () => { if (!n.read) { await readNotification(n.id); refresh() } }}><span>{n.kind === 'reminder' ? '⏰' : n.kind === 'ai' ? '✨' : n.kind === 'dose' ? '✓' : '♢'}</span><div><b>{n.title}</b><p>{n.body.split('|')[0]}</p><small>{new Date(n.created_at).toLocaleString()}</small></div>{!n.read && <i />}</button>) : <Empty />}</section></section> }

function Empty({ go }) { return <div className="empty"><div>💊</div><h3>No data yet</h3><p>Start by adding your first medication.</p>{go && <button className="secondary" onClick={go}>Add medication</button>}</div> }

export default App
