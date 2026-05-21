import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  GraduationCap, LogIn, LogOut, User, Users, UserPlus,
  Calendar, CalendarOff, Clock, Phone, Mail, MapPin,
  Plus, Trash2, Edit2, Save, X, Search,
  ChevronRight, ArrowLeft, CheckCircle, XCircle,
  AlertTriangle, Info, BarChart3, MessageSquare, Send,
  Megaphone, Eye, EyeOff, BookOpen, Settings,
  Cake, Share2, MessageCircle, CalendarDays, Copy,
  Wallet, RotateCcw, KeyRound, IndianRupee, Layers,
  Camera, Sparkles, RefreshCw, AlertCircle, Inbox, Hash, Check
} from 'lucide-react';
import axios from 'axios';
import './index.css';

// ============================
// AXIOS SETUP
// ============================
const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ============================
// HELPERS
// ============================
const TZ = 'Asia/Kolkata';

const todayISO = () => {
  // Local date in IST as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
};

const thisMonth = () => todayISO().substring(0, 7);

const isOffDayToday = (announcements, batchId) => {
  const today = todayISO();
  return announcements.find(a =>
    a.type === 'off-day' && a.dates && a.dates.includes(today) &&
    (!a.batchId || !batchId || a.batchId === batchId || a.batchId === '')
  );
};

const isBirthdayToday = (birthday) => {
  if (!birthday) return false;
  const today = new Date();
  const parts = birthday.split('-');
  if (parts.length < 3) return false;
  return parseInt(parts[1]) === today.getMonth() + 1 &&
         parseInt(parts[2]) === today.getDate();
};

const cleanPhone = (phone) => (phone || '').replace(/\D/g, '');

const whatsappLink = (phone, text) => {
  let num = cleanPhone(phone);
  if (num && num.length === 10) num = '91' + num;
  const t = encodeURIComponent(text || '');
  return num ? `https://wa.me/${num}?text=${t}` : `https://wa.me/?text=${t}`;
};

const formatDate = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', {
      day: 'numeric', month: 'short', year: 'numeric'
    });
  } catch { return iso; }
};

const formatRupee = (n) => '₹' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const getSubjectName = (s) => typeof s === 'string' ? s : s?.name;

// Find a batch object from its id within an info.batches array
const findBatch = (info, batchId) => (info?.batches || []).find(b => String(b._id) === String(batchId));

// Find a class object by name (classes are keyed by name)
const findClass = (info, name) => (info?.classes || []).find(c => c.name === name);

// Compute age in whole years from a YYYY-MM-DD birthday string
const ageFromDOB = (dob) => {
  if (!dob) return null;
  const [y, m, d] = String(dob).split('-').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  let age = today.getFullYear() - y;
  const mDiff = (today.getMonth() + 1) - m;
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d)) age--;
  return age >= 0 && age < 150 ? age : null;
};

// Days until next birthday (0..364, or null)
const daysUntilBirthday = (dob) => {
  if (!dob) return null;
  const [_, m, d] = String(dob).split('-').map(Number);
  if (!m || !d) return null;
  const now = new Date();
  const target = new Date(now.getFullYear(), m - 1, d);
  if (target < new Date(now.getFullYear(), now.getMonth(), now.getDate())) target.setFullYear(now.getFullYear() + 1);
  return Math.round((target - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
};

// Aadhar Verhoeff checksum (client-side validation for instant feedback)
const VERHOEFF_D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]];
const VERHOEFF_P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]];
const isValidAadhar = (s) => {
  const d = (s || '').replace(/\s/g, '');
  if (!/^\d{12}$/.test(d)) return false;
  let c = 0;
  const rev = d.split('').reverse();
  for (let i = 0; i < rev.length; i++) c = VERHOEFF_D[c][VERHOEFF_P[i % 8][parseInt(rev[i], 10)]];
  return c === 0;
};

// ============================
// MAIN APP
// ============================
export default function App() {
  const [view, setView] = useState('landing');
  const [info, setInfo] = useState({});
  const [role, setRole] = useState(localStorage.getItem('role'));
  const [selectedStudent, setSelectedStudent] = useState(
    JSON.parse(localStorage.getItem('selectedStudent') || 'null')
  );
  const [announcements, setAnnouncements] = useState([]);

  const refreshInfo = useCallback(async () => {
    try {
      // Authenticated /config returns the full doc including _id'd batches/subjects;
      // fall back to public/info when not logged in or on error.
      const tok = localStorage.getItem('token');
      if (tok) {
        const r = await api.get('/config');
        if (r.data) { setInfo(r.data); return; }
      }
      const r2 = await api.get('/public/info');
      setInfo(r2.data);
    } catch {
      try { const r2 = await api.get('/public/info'); setInfo(r2.data); } catch {}
    }
  }, []);

  useEffect(() => {
    refreshInfo();
    const savedRole = localStorage.getItem('role');
    const savedStudent = JSON.parse(localStorage.getItem('selectedStudent') || 'null');
    if (savedRole === 'teacher') setView('teacher');
    else if (savedRole === 'parent' && savedStudent) setView('parent');
    else if (savedRole === 'student' && savedStudent) setView('student');
  }, [refreshInfo]);

  useEffect(() => {
    if (role) {
      api.get('/announcements').then(r => setAnnouncements(r.data)).catch(() => {});
    }
  }, [role, view]);

  const handleSignOut = () => {
    localStorage.clear();
    setRole(null);
    setSelectedStudent(null);
    setView('landing');
    refreshInfo();
  };

  if (view === 'landing') return <Landing info={info} onSignIn={() => setView('login')} onRegister={() => setView('register')} />;
  if (view === 'register') return <Register info={info} onBack={() => setView('landing')} onDone={() => setView('login')} />;
  if (view === 'login') return <Login info={info} onBack={() => setView('landing')} onLogin={(role, student) => {
    setRole(role); refreshInfo();
    if (role === 'parent' && student) {
      setSelectedStudent(student);
      localStorage.setItem('selectedStudent', JSON.stringify(student));
      setView('parent');
    } else if (role === 'student' && student) {
      setSelectedStudent(student);
      localStorage.setItem('selectedStudent', JSON.stringify(student));
      setView('student');
    } else {
      setView('teacher');
    }
  }} />;
  if (view === 'teacher') return <TeacherDashboard info={info} announcements={announcements} onSignOut={handleSignOut} refreshInfo={refreshInfo} />;
  if (view === 'parent') return <ParentDashboard student={selectedStudent} info={info} announcements={announcements} onSignOut={handleSignOut} />;
  if (view === 'student') return <StudentChatDashboard student={selectedStudent} info={info} announcements={announcements} onSignOut={handleSignOut} />;
  return null;
}

// ============================
// OFF-DAY BANNER (shared)
// ============================
function OffDayBanner({ announcements, batchId }) {
  const off = isOffDayToday(announcements, batchId);
  if (!off) return null;
  return (
    <div className="off-day-banner">
      <CalendarOff size={20} />
      <div>
        <strong>Today is a holiday</strong>
        <p>{off.message}</p>
      </div>
    </div>
  );
}

// ============================
// LANDING
// ============================
function Landing({ info, onSignIn, onRegister }) {
  return (
    <div className="page">
      <header className="header">
        <div className="logo">
          <GraduationCap size={28} />
          <div>
            <h1>{info.classroomName || 'Coaching Center'}</h1>
            <p className="muted">Attendance &amp; Management</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={onSignIn}>
          <LogIn size={16} /> Sign In
        </button>
      </header>

      <section className="hero">
        <div className="hero-icon-wrap">
          <GraduationCap size={72} color="#0a84ff" />
        </div>
        <h1 className="display">{info.classroomName || 'Gunjan Coaching'}</h1>
        <p className="hero-sub">Attendance · Fees · Chat — all in one place.</p>
        <div className="hero-buttons">
          <button className="btn btn-primary btn-xl" onClick={onSignIn}>
            <LogIn size={20} /> Sign In
          </button>
          <button className="btn btn-outline btn-xl" onClick={onRegister}>
            <UserPlus size={20} /> New Student? Register
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 20 }}>
          Teacher uses their <strong>password</strong> &nbsp;·&nbsp; Parents use their <strong>code</strong> (e.g. K7842M) &nbsp;·&nbsp; Students use their <strong>roll number</strong>
        </p>
      </section>

      <section className="features">
        <div className="feature-grid">
          <div className="card">
            <CheckCircle size={28} color="#16a34a" />
            <h3>Attendance</h3>
            <p>Teacher hands the device to the student. They tap their name, add a note, and done.</p>
          </div>
          <div className="card">
            <IndianRupee size={28} color="#d97706" />
            <h3>Fees</h3>
            <p>Class-based monthly fees. Per-day auto-calculated. Parents see their child's full breakdown.</p>
          </div>
          <div className="card">
            <MessageCircle size={28} color="#9333ea" />
            <h3>Chat &amp; AI</h3>
            <p>Group chat, private complaints to teacher, and a multilingual AI assistant for everyone.</p>
          </div>
        </div>
      </section>

      <section className="info-section">
        <h2 className="display">Contact</h2>
        <div className="info-grid">
          {info.teacherName && <div className="info-row"><User size={18} /><span>{info.teacherName}</span></div>}
          {info.phone && <div className="info-row"><Phone size={18} /><a href={`tel:${info.phone}`}>{info.phone}</a></div>}
          {info.email && <div className="info-row"><Mail size={18} /><a href={`mailto:${info.email}`}>{info.email}</a></div>}
          {info.mapUrl && <div className="info-row"><MapPin size={18} /><a href={info.mapUrl} target="_blank" rel="noreferrer">View Location</a></div>}
          {info.classStart && info.classEnd && <div className="info-row"><Clock size={18} /><span>Class: {info.classStart} - {info.classEnd}</span></div>}
        </div>
        <p className="tip muted text-center small">
          <Info size={14} /> Tip: Add this page to your home screen for one-tap access!
        </p>
      </section>

      <footer className="footer">
        <p>© {new Date().getFullYear()} {info.classroomName || 'Coaching Center'}</p>
      </footer>
    </div>
  );
}


// ============================
// UNIFIED LOGIN — teacher password / parent code / student roll number
// ============================
function Login({ info, onBack, onLogin }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    if (e) e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await api.post('/auth/login', { password });
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('role', res.data.role);
      if (res.data.student) {
        localStorage.setItem('selectedStudent', JSON.stringify(res.data.student));
      }
      onLogin(res.data.role, res.data.student || null);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not sign in');
    } finally { setLoading(false); }
  };

  return (
    <div className="page-center">
      <div className="container-narrow">
        <button className="btn-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <div className="auth-form" style={{ maxWidth: 460, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <GraduationCap size={48} color="#0a84ff" />
            <h1 className="display" style={{ marginTop: 10 }}>{info.classroomName || 'Coaching Center'}</h1>
          </div>

          <div className="login-hints">
            <div className="login-hint">🎓 <strong>Teacher</strong> — enter your password</div>
            <div className="login-hint">👨‍👩‍👧 <strong>Parent</strong> — enter your code (e.g. K7842M)</div>
            <div className="login-hint">📚 <strong>Student</strong> — enter your roll number (e.g. 003)</div>
          </div>

          <form onSubmit={submit}>
            <label>PASSWORD / CODE / ROLL NUMBER</label>
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password, code, or roll number"
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
              />
              <button type="button" className="icon-btn" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {error && <div className="error-box">{error}</div>}
            <button type="submit" className="btn btn-primary btn-block" disabled={loading || !password.trim()}>
              {loading ? 'Signing in...' : 'Sign In →'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}


// ============================
// REGISTER (self-registration form)
// ============================
function Register({ info, onBack, onDone }) {
  const [form, setForm] = useState({
    name: '', phone: '', parentName: '', parentPhone: '',
    aadhar: '', birthday: '', subjects: [], notes: '',
    className: '', batchId: '', photo: ''
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [createdStudent, setCreatedStudent] = useState(null);

  const toggleSubject = (s) => {
    setForm(f => ({
      ...f,
      subjects: f.subjects.includes(s) ? f.subjects.filter(x => x !== s) : [...f.subjects, s]
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name || !form.phone) { setError('Name and phone are required'); return; }
    // Strict Aadhar checksum if provided (request #4)
    if (form.aadhar && !isValidAadhar(form.aadhar)) {
      setError('Aadhar number is invalid. Please check the 12 digits.');
      return;
    }
    setLoading(true);
    try {
      const r = await api.post('/public/register', form);
      setCreatedStudent(r.data.student);
      setSuccess(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Registration failed');
    } finally { setLoading(false); }
  };

  if (success) {
    return (
      <div className="page-center">
        <div className="container-narrow">
          <div className="success-box">
            <CheckCircle size={48} color="#16a34a" />
            <h2 className="display">Thanks, {form.name}!</h2>
            <p>Your registration is in. The teacher will review and approve it before you can be marked present.</p>
            {createdStudent?.parentCode && (
              <div className="code-box" style={{ marginTop: 16 }}>
                <span className="muted small">Parent code (give this to your parent):</span>
                <strong>{createdStudent.parentCode}</strong>
              </div>
            )}
            <button className="btn btn-primary btn-lg" onClick={onDone}>Back to Sign In</button>
          </div>
        </div>
      </div>
    );
  }

  const availableSubjects = (info.subjects || []).map(getSubjectName).filter(Boolean);
  const fallback = availableSubjects.length ? availableSubjects : ['Mathematics', 'Science', 'English'];
  const age = ageFromDOB(form.birthday);
  const aadharValid = form.aadhar ? isValidAadhar(form.aadhar) : null;

  return (
    <div className="page-center">
      <div className="container-narrow">
        <button className="btn-back" onClick={onBack}><ArrowLeft size={16} /> Back</button>
        <div className="auth-form">
          <h1 className="display">Register as New Student</h1>
          <p className="muted">Fill in your details to join {info.classroomName || 'our coaching center'}. The teacher will approve before you can mark attendance.</p>
          <form onSubmit={submit}>
            <PhotoCapture value={form.photo} onChange={(p) => setForm(f => ({ ...f, photo: p }))} />

            <label>Student Name *</label>
            <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Your full name" required />

            <label>Phone Number *</label>
            <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} placeholder="10-digit phone number" required />

            <label>Date of Birth {age != null && <span className="age-tag">Age {age}</span>}</label>
            <input type="date" value={form.birthday} onChange={e => setForm({...form, birthday: e.target.value})} />

            <label>Parent / Guardian Name</label>
            <input value={form.parentName} onChange={e => setForm({...form, parentName: e.target.value})} placeholder="Parent's name" />

            <label>Parent / Guardian Phone</label>
            <input value={form.parentPhone} onChange={e => setForm({...form, parentPhone: e.target.value})} placeholder="Parent's phone number" />

            <label>Aadhar Number (optional) {aadharValid === true && <span className="badge green small"><Check size={12} /> valid</span>} {aadharValid === false && <span className="badge red small">invalid</span>}</label>
            <input value={form.aadhar} onChange={e => setForm({...form, aadhar: e.target.value.replace(/\D/g, '').slice(0, 12)})} placeholder="12-digit Aadhar" maxLength={12} inputMode="numeric" />

            {(info.classes?.length || 0) > 0 && (
              <>
                <label>Class</label>
                <select value={form.className} onChange={e => setForm({...form, className: e.target.value})}>
                  <option value="">— Choose your class —</option>
                  {info.classes.map(c => (
                    <option key={c.name} value={c.name}>{c.name} (₹{(c.monthlyFee || 0).toLocaleString('en-IN')}/month)</option>
                  ))}
                </select>
              </>
            )}

            <label>Subjects you want to learn</label>
            <div className="checkbox-group">
              {fallback.map(s => (
                <label key={s} className="checkbox-label">
                  <input type="checkbox" checked={form.subjects.includes(s)} onChange={() => toggleSubject(s)} />
                  <span>{s}</span>
                </label>
              ))}
            </div>

            <label>Notes (optional)</label>
            <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} placeholder="Anything you want to tell us" rows={3} />

            {error && <div className="error-box">{error}</div>}

            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>
              {loading ? 'Submitting...' : 'Submit Registration'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ============================
// PHOTO CAPTURE (request #9) — camera or file upload, base64
// ============================
function PhotoCapture({ value, onChange }) {
  const [cameraOn, setCameraOn] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const fileRef = useRef(null);

  const startCamera = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      streamRef.current = stream;
      setCameraOn(true);
      // Wait for state to apply, then bind
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, 50);
    } catch (err) {
      setError("Couldn't open camera. Try uploading a photo instead.");
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraOn(false);
  };

  const snap = () => {
    const v = videoRef.current;
    if (!v) return;
    const canvas = document.createElement('canvas');
    // 400x400 square crop, centered
    const size = Math.min(v.videoWidth, v.videoHeight) || 400;
    canvas.width = 400; canvas.height = 400;
    const ctx = canvas.getContext('2d');
    const sx = (v.videoWidth - size) / 2;
    const sy = (v.videoHeight - size) / 2;
    ctx.drawImage(v, sx, sy, size, size, 0, 0, 400, 400);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    onChange(dataUrl);
    stopCamera();
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setError('Max 5MB'); return; }
    // Downscale to 400x400 to keep DB small
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = Math.min(img.width, img.height);
        canvas.width = 400; canvas.height = 400;
        const ctx = canvas.getContext('2d');
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, 400, 400);
        onChange(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => () => stopCamera(), []); // cleanup on unmount

  return (
    <div className="photo-capture">
      <label>Photo (optional)</label>
      {error && <div className="error-box small">{error}</div>}
      {value ? (
        <div className="photo-preview">
          <img src={value} alt="Student" />
          <button type="button" className="btn btn-outline btn-mini" onClick={() => onChange('')}>
            <Trash2 size={12} /> Remove
          </button>
        </div>
      ) : cameraOn ? (
        <div className="camera-view">
          <video ref={videoRef} autoPlay playsInline muted />
          <div className="row" style={{ justifyContent: 'center', marginTop: 8, gap: 8 }}>
            <button type="button" className="btn btn-outline" onClick={stopCamera}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={snap}><Camera size={14} /> Capture</button>
          </div>
        </div>
      ) : (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn btn-outline" onClick={startCamera}>
            <Camera size={14} /> Take Photo
          </button>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
          <button type="button" className="btn btn-outline" onClick={() => fileRef.current?.click()}>
            Upload
          </button>
        </div>
      )}
    </div>
  );
}

// ============================
// PICK STUDENT (now only used by 'student' role) — has "Back" if wrong tap (feature #1)
// ============================
function PickStudent({ students, role, onPick, onBack }) {
  const [search, setSearch] = useState('');
  const [confirming, setConfirming] = useState(null);

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.rollNumber || '').includes(search)
  );
  return (
    <div className="page-center">
      <div className="container-narrow">
        <button className="btn-back" onClick={onBack}><ArrowLeft size={16} /> Sign out</button>
        <h1 className="display">Who Are You?</h1>
        <p className="muted">Tap your name to continue. Tapped wrong? You'll get a chance to go back.</p>
        <div className="search-bar">
          <Search size={16} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or roll number" autoFocus />
        </div>
        <div className="list">
          {filtered.length === 0 && <p className="muted text-center">No students found.</p>}
          {filtered.map(s => (
            <button key={s._id} className="list-item" onClick={() => setConfirming(s)}>
              <div>
                <strong>{s.name}</strong>
                <p className="muted small">Roll #{s.rollNumber}</p>
              </div>
              <ChevronRight size={20} />
            </button>
          ))}
        </div>

        {confirming && (
          <Modal onClose={() => setConfirming(null)} title="Is this you?">
            <div className="text-center" style={{ padding: '12px 0' }}>
              <h2 className="display" style={{ marginBottom: 4 }}>{confirming.name}</h2>
              <p className="muted">Roll #{confirming.rollNumber}</p>
            </div>
            <div className="modal-buttons">
              <button className="btn btn-outline" onClick={() => setConfirming(null)}>
                <ArrowLeft size={14} /> No, go back
              </button>
              <button className="btn btn-primary" onClick={() => { const s = confirming; setConfirming(null); onPick(s); }}>
                Yes, that's me <ChevronRight size={14} />
              </button>
            </div>
          </Modal>
        )}
      </div>
    </div>
  );
}

// ============================
// TEACHER DASHBOARD
// ============================
function TeacherDashboard({ info, announcements, onSignOut, refreshInfo }) {
  const [tab, setTab] = useState('today');
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  const [unreadComplaints, setUnreadComplaints] = useState(0);

  // Poll unread counts every 30s for badges
  useEffect(() => {
    const tick = async () => {
      try {
        const [m, c] = await Promise.all([
          api.get('/parent-messages/unread-count'),
          api.get('/complaints/unread-count'),
        ]);
        setUnreadMsgs(m.data.unread || 0);
        setUnreadComplaints(c.data.unread || 0);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="page">
      <header className="dashboard-header">
        <div>
          <h1 className="display">Teacher Dashboard</h1>
          <p className="muted">Welcome back, {info.teacherName || 'Teacher'}</p>
        </div>
        <div className="row">
          <button className="btn btn-outline btn-mini" onClick={refreshInfo} title="Refresh"><RefreshCw size={14} /></button>
          <button className="btn btn-outline" onClick={onSignOut}><LogOut size={16} /> Sign out</button>
        </div>
      </header>

      <OffDayBanner announcements={announcements} />

      <nav className="tabs">
        <button className={tab === 'today' ? 'tab active' : 'tab'} onClick={() => setTab('today')}><Calendar size={16} /> Today</button>
        <button className={tab === 'students' ? 'tab active' : 'tab'} onClick={() => setTab('students')}><Users size={16} /> Students</button>
        <button className={tab === 'summary' ? 'tab active' : 'tab'} onClick={() => setTab('summary')}><BarChart3 size={16} /> Summary</button>
        <button className={tab === 'fees' ? 'tab active' : 'tab'} onClick={() => setTab('fees')}><Wallet size={16} /> Fees</button>
        <button className={tab === 'exams' ? 'tab active' : 'tab'} onClick={() => setTab('exams')}><BookOpen size={16} /> Exams</button>
        <button className={tab === 'holidays' ? 'tab active' : 'tab'} onClick={() => setTab('holidays')}><CalendarOff size={16} /> Holidays</button>
        <button className={tab === 'chat' ? 'tab active' : 'tab'} onClick={() => setTab('chat')}><MessageCircle size={16} /> Chat</button>
        <button className={tab === 'messages' ? 'tab active' : 'tab'} onClick={() => setTab('messages')}>
          <Inbox size={16} /> Parent Chats
          {unreadMsgs > 0 && <span className="tab-badge">{unreadMsgs}</span>}
        </button>
        <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}><Settings size={16} /> Settings</button>
      </nav>

      <main className="tab-content">
        {tab === 'today' && <TodayTab info={info} announcements={announcements} />}
        {tab === 'students' && <StudentsTab info={info} refreshInfo={refreshInfo} />}
        {tab === 'summary' && <SummaryTab info={info} />}
        {tab === 'fees' && <TeacherFeesTab info={info} />}
        {tab === 'exams' && <ExamsTab />}
        {tab === 'holidays' && <AnnouncementsTab info={info} />}
        {tab === 'chat' && <GroupChat role="teacher" currentName={info.teacherName || 'Teacher'} />}
        {tab === 'messages' && <ParentChatTab />}
        {tab === 'settings' && <SettingsTab info={info} refreshInfo={refreshInfo} />}
      </main>

      <AIAssistant chatMode={tab === 'chat' || tab === 'messages'} />
    </div>
  );
}

// ============================
// STUDENT MODE PICKER — student picks themselves on teacher's device
// ============================
function StudentModePicker({ students, todayAtt, onCancel, onMarked }) {
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const markedIds = new Set(todayAtt.map(a => String(a.studentId)));
  const available = students.filter(s => !markedIds.has(String(s._id)));
  const filtered = available.filter(s =>
    s.name.toLowerCase().includes(q.toLowerCase()) ||
    (s.rollNumber || '').includes(q)
  );

  const confirm = async () => {
    if (!picked) return;
    setSubmitting(true);
    try {
      await api.post('/attendance/self-mark', { studentId: picked._id, note: note.trim() || undefined });
      onMarked(picked.name);
    } catch (err) {
      alert('Could not mark: ' + (err.response?.data?.error || err.message));
      setSubmitting(false);
    }
  };

  if (picked) {
    return (
      <div className="student-mode">
        <h2 className="display">Is this you?</h2>
        <div className="picked-card">
          {picked.photo && <img src={picked.photo} alt={picked.name} className="picked-photo" />}
          <div className="picked-name">{picked.name}</div>
          <div className="muted">Roll #{picked.rollNumber}</div>
        </div>
        <label style={{ marginTop: 18 }}>Want to leave a note? (optional)</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value.slice(0, 300))}
          rows={2}
          placeholder="e.g. running late, came in for makeup, etc."
        />
        <div className="row" style={{ gap: 12, marginTop: 12 }}>
          <button className="btn btn-outline btn-lg" onClick={() => { setPicked(null); setNote(''); }} disabled={submitting}>Not me</button>
          <button className="btn btn-primary btn-lg" onClick={confirm} disabled={submitting}>
            {submitting ? 'Marking...' : 'Yes, mark me present'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="student-mode">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 className="display">Tap your name</h2>
        <button className="btn-link" onClick={onCancel}><ArrowLeft size={14} /> Hand back to teacher</button>
      </div>
      <input
        className="search-big"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Search by name or roll number..."
        autoFocus
      />
      {available.length === 0 ? (
        <p className="muted">Everyone has been marked today. ✨</p>
      ) : (
        <div className="student-mode-list">
          {filtered.map(s => (
            <button key={s._id} className="student-mode-tile" onClick={() => setPicked(s)}>
              {s.photo ? <img src={s.photo} alt="" className="tile-photo" /> : <div className="tile-photo placeholder"><User size={20} /></div>}
              <strong>{s.name}</strong>
              <span className="muted small">Roll #{s.rollNumber}</span>
            </button>
          ))}
          {filtered.length === 0 && <p className="muted">No matches.</p>}
        </div>
      )}
    </div>
  );
}

// ============================
// TODAY TAB — with "Unmark" undo (feature #9) + Student Mode (feature: hand-to-student)
// ============================
function TodayTab({ info, announcements }) {
  const [students, setStudents] = useState([]);
  const [todayAtt, setTodayAtt] = useState([]);
  const [loading, setLoading] = useState(true);
  const [markingStudent, setMarkingStudent] = useState(null);
  const [reason, setReason] = useState('');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [batchFilter, setBatchFilter] = useState('');
  const [studentMode, setStudentMode] = useState(false);
  const [studentModeDone, setStudentModeDone] = useState(null); // name of who just marked, for confirmation

  const load = async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([api.get('/students'), api.get('/attendance/today')]);
      setStudents(s.data);
      setTodayAtt(a.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const getAtt = (id) => todayAtt.find(a => String(a.studentId) === String(id));

  const markPresent = async (id) => {
    try {
      await api.post('/attendance/teacher-mark', { studentId: id, status: 'present' });
      load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  const markAbsent = async () => {
    try {
      await api.post('/attendance/teacher-mark', {
        studentId: markingStudent._id,
        status: 'absent',
        reason: reason || 'No reason given'
      });
      setMarkingStudent(null); setReason(''); load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  // Feature #9: undo a "marked present by mistake" record
  const unmark = async (studentId) => {
    if (!confirm('Roll back today\'s attendance for this student? It will go back to "not marked".')) return;
    try {
      await api.delete('/attendance/unmark', { data: { studentId } });
      load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  const markAllPresent = async () => {
    if (!confirm(batchFilter ? 'Mark everyone in this batch as present today?' : 'Mark all students as present today?')) return;
    setBulkLoading(true);
    try {
      const res = await api.post('/attendance/mark-all-present', batchFilter ? { batchId: batchFilter } : {});
      load();
      alert(`Marked ${res.data.marked} student(s) as present.`);
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setBulkLoading(false); }
  };

  if (loading) return <p className="muted">Loading...</p>;

  // STUDENT MODE — teacher hands the device over.
  if (studentModeDone) {
    return (
      <div className="student-mode-done">
        <div className="big-check">✓</div>
        <h2>Marked Present</h2>
        <p className="muted">{studentModeDone}, you're checked in for today.</p>
        <p className="small muted">Please hand the device back to the teacher.</p>
        <button className="btn btn-primary btn-lg" onClick={() => { setStudentModeDone(null); setStudentMode(false); load(); }}>
          Back to Teacher
        </button>
      </div>
    );
  }
  if (studentMode) {
    return (
      <StudentModePicker
        students={students}
        todayAtt={todayAtt}
        onCancel={() => setStudentMode(false)}
        onMarked={(name) => setStudentModeDone(name)}
      />
    );
  }

  const visible = batchFilter ? students.filter(s => s.batchId === batchFilter) : students;
  const birthdayStudents = visible.filter(s => isBirthdayToday(s.birthday));
  const upcomingBirthdays = visible
    .map(s => ({ s, d: daysUntilBirthday(s.birthday) }))
    .filter(x => x.d != null && x.d > 0 && x.d <= 7)
    .sort((a, b) => a.d - b.d);
  const offDay = isOffDayToday(announcements);

  if (students.length === 0) return (
    <div className="empty">
      <Users size={48} color="#999" />
      <h3>No students yet</h3>
      <p className="muted">Go to the Students tab to add your first student.</p>
    </div>
  );

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const visibleAtt = todayAtt.filter(a => visible.some(s => String(s._id) === String(a.studentId)));

  return (
    <div>
      {birthdayStudents.length > 0 && (
        <div className="birthday-banner">
          <Cake size={20} />
          <div>
            <strong>🎉 Today's Birthday{birthdayStudents.length > 1 ? 's' : ''}!</strong>
            <p>{birthdayStudents.map(s => s.name).join(', ')} — wish them a happy birthday!</p>
          </div>
        </div>
      )}

      {upcomingBirthdays.length > 0 && (
        <div className="upcoming-birthdays">
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <Cake size={16} color="#d97706" />
            <strong>Coming up this week</strong>
          </div>
          <div className="upcoming-list">
            {upcomingBirthdays.map(({ s, d }) => (
              <span key={s._id} className="upcoming-chip">
                <strong>{s.name}</strong>
                <span className="muted small">{d === 1 ? 'tomorrow' : `in ${d} days`}{s.parentPhone ? '' : ''}</span>
                {s.parentPhone && (
                  <a className="wa-link" href={whatsappLink(s.parentPhone, `Wishing ${s.name} a very happy birthday in advance from ${info.teacherName || info.classroomName || 'us'}! 🎂`)} target="_blank" rel="noreferrer">
                    <MessageCircle size={12} /> wish
                  </a>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="stat-row">
        <div className="stat"><strong>{today}</strong></div>
        <div className="stat green"><CheckCircle size={20} /> {visibleAtt.filter(a => a.status === 'present').length} Present</div>
        <div className="stat red"><XCircle size={20} /> {visibleAtt.filter(a => a.status === 'absent').length} Absent</div>
        <div className="stat muted"><Info size={20} /> {visible.length - visibleAtt.length} Not marked</div>
      </div>

      <div className="toolbar">
        {(info.batches?.length || 0) > 0 && (
          <select className="sort-select" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
            <option value="">All batches</option>
            {info.batches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        )}
        {!offDay && (
          <button className="btn btn-green" onClick={markAllPresent} disabled={bulkLoading}>
            <CheckCircle size={16} /> {bulkLoading ? 'Marking...' : (batchFilter ? 'Mark Batch Present' : 'Mark Everyone Present')}
          </button>
        )}
        <button className="btn btn-outline" onClick={() => setStudentMode(true)} title="Let a student mark themselves on this device">
          <User size={16} /> Hand to Student
        </button>
      </div>

      <div className="list">
        {visible.map(s => {
          const att = getAtt(s._id);
          const batch = findBatch(info, s.batchId);
          return (
            <div key={s._id} className="attendance-card">
              <div>
                <strong>{s.name}</strong>
                {isBirthdayToday(s.birthday) && <span className="bday-pill">🎂 Birthday!</span>}
                <p className="muted small">
                  Roll #{s.rollNumber}
                  {batch ? ` · ${batch.name} (${batch.startTime}-${batch.endTime})` : ''}
                  {s.subjects?.length ? ' · ' + s.subjects.join(', ') : ''}
                </p>
              </div>
              <div className="attendance-status">
                {att ? (
                  <>
                    {att.status === 'present' ? (
                      <span className="badge green">
                        <CheckCircle size={14} /> Present
                        {att.inTime && ` ${att.inTime}`}
                        {att.outTime && ` - ${att.outTime}`}
                      </span>
                    ) : (
                      <span className="badge red"><XCircle size={14} /> Absent {att.reason && `(${att.reason})`}</span>
                    )}
                    {att.markedBy === 'teacher' && (
                      <span className="badge gray small" title="Teacher marked"><Info size={12} /> Marked by you</span>
                    )}
                    {att.markedBy === 'self' && (
                      <span className="badge blue small" title="Self marked"><Info size={12} /> Self-marked</span>
                    )}
                    {/* Feature #9: undo / roll back today's mark */}
                    <button className="btn-mini btn-outline" onClick={() => unmark(s._id)} title="Roll back today's attendance">
                      <RotateCcw size={14} /> Undo
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn-mini btn-green" onClick={() => markPresent(s._id)}><CheckCircle size={14} /> Present</button>
                    <button className="btn-mini btn-red" onClick={() => setMarkingStudent(s)}><XCircle size={14} /> Absent</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {markingStudent && (
        <Modal onClose={() => setMarkingStudent(null)} title={`Mark ${markingStudent.name} Absent`}>
          <label>Reason for absence (optional)</label>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Sick, family event" autoFocus />
          <div className="modal-buttons">
            <button className="btn btn-outline" onClick={() => setMarkingStudent(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={markAbsent}>Mark Absent</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================
// STUDENTS TAB — with batch column and parent-code display (features #4, #13)
// ============================
function StudentsTab({ info, refreshInfo }) {
  const [students, setStudents] = useState([]);
  const [pending, setPending] = useState([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('name');
  const [batchFilter, setBatchFilter] = useState('');
  const [showCodeFor, setShowCodeFor] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [a, p] = await Promise.all([api.get('/students'), api.get('/students/pending')]);
      setStudents(a.data);
      setPending(p.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const del = async (id) => {
    if (!confirm('Delete this student? All their attendance records will be deleted too.')) return;
    await api.delete('/students/' + id);
    load();
  };

  const approve = async (id) => {
    await api.post('/students/' + id + '/approve');
    load();
  };

  const reject = async (id) => {
    if (!confirm('Reject this registration? The student will be deleted.')) return;
    await api.delete('/students/' + id);
    load();
  };

  let filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.rollNumber || '').includes(search) ||
    (s.phone || '').includes(search)
  );
  if (batchFilter) filtered = filtered.filter(s => s.batchId === batchFilter);
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    if (sortBy === 'roll') return (a.rollNumber || '').localeCompare(b.rollNumber || '');
    return 0;
  });

  if (loading) return <p className="muted">Loading...</p>;

  return (
    <div>
      {pending.length > 0 && (
        <div className="pending-section">
          <h3><AlertCircle size={16} /> {pending.length} registration{pending.length > 1 ? 's' : ''} awaiting your approval</h3>
          <div className="list">
            {pending.map(s => (
              <div key={s._id} className="student-card pending-card">
                <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                  {s.photo && <img src={s.photo} alt={s.name} className="student-avatar" />}
                  <div style={{ flex: 1 }}>
                    <strong>{s.name}</strong>
                    {ageFromDOB(s.birthday) != null && <span className="age-tag">Age {ageFromDOB(s.birthday)}</span>}
                    <p className="muted small">{s.phone || 'No phone'} · {s.className || 'No class'} · {s.subjects?.join(', ') || 'No subjects'}</p>
                    {s.parentName && <p className="small">Parent: {s.parentName} · {s.parentPhone}</p>}
                    {s.notes && <p className="small muted">"{s.notes}"</p>}
                  </div>
                </div>
                <div className="row-buttons">
                  <button className="btn btn-green btn-mini" onClick={() => approve(s._id)}><Check size={14} /> Approve</button>
                  <button className="btn btn-outline btn-mini" onClick={() => reject(s._id)}><X size={14} /> Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="search-bar">
          <Search size={16} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, roll, or phone" />
        </div>
        {(info.batches?.length || 0) > 0 && (
          <select className="sort-select" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
            <option value="">All batches</option>
            {info.batches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        )}
        <select value={sortBy} onChange={e => setSortBy(e.target.value)} className="sort-select">
          <option value="name">Sort by Name</option>
          <option value="roll">Sort by Roll #</option>
        </select>
        <button className="btn btn-outline btn-mini" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} /> Add Student
        </button>
      </div>

      {filtered.length === 0 && (
        <div className="empty">
          <Users size={48} color="#999" />
          <h3>{students.length === 0 ? 'No students yet' : 'No matching students'}</h3>
          <p className="muted">{students.length === 0 ? 'Click "Add Student" to add your first one.' : 'Try a different search.'}</p>
        </div>
      )}

      <div className="list">
        {filtered.map(s => {
          const batch = findBatch(info, s.batchId);
          const age = ageFromDOB(s.birthday);
          return (
            <div key={s._id} className="student-card">
              <div className="row" style={{ gap: 12, alignItems: 'flex-start', flex: 1, cursor: 'pointer' }} onClick={() => setViewing(s)}>
                {s.photo ? <img src={s.photo} alt={s.name} className="student-avatar" /> : <div className="student-avatar placeholder"><User size={20} /></div>}
                <div style={{ flex: 1 }}>
                  <strong>{s.name}</strong>
                  {isBirthdayToday(s.birthday) && <span className="bday-pill">🎂</span>}
                  {age != null && <span className="age-tag">Age {age}</span>}
                  <p className="muted small">Roll #{s.rollNumber} · {s.phone || 'No phone'}</p>
                  {s.className && <p className="small">Class: <strong>{s.className}</strong></p>}
                  {s.monthlyFee > 0 && <p className="small">Fee: <strong>₹{Number(s.monthlyFee).toLocaleString('en-IN')}/month</strong></p>}
                  {batch && <p className="small"><Layers size={12} /> Batch: <strong>{batch.name}</strong> ({batch.startTime}-{batch.endTime})</p>}
                  {s.subjects?.length > 0 && <p className="small">Subjects: {s.subjects.join(', ')}</p>}
                  {Number(s.monthlyFee) > 0 && <p className="small"><IndianRupee size={12} /> Fee: <strong>{formatRupee(s.monthlyFee)}</strong>/month</p>}
                  {s.parentCode && (
                    <p className="small">
                      Parent code: <code className="inline-code">{s.parentCode}</code>{' '}
                      <button className="btn-link" onClick={(e) => { e.stopPropagation(); setShowCodeFor(s); }}>Show / share</button>
                    </p>
                  )}
                  {s.parentPhone && (
                    <p className="small">
                      Parent: {s.parentName || ''} ·{' '}
                      <a onClick={(e) => e.stopPropagation()} href={whatsappLink(s.parentPhone, `Hello, this is ${info.teacherName || 'your teacher'} from ${info.classroomName || 'coaching center'} about ${s.name}.`)} target="_blank" rel="noreferrer" className="wa-link">
                        <MessageCircle size={12} /> WhatsApp
                      </a>
                    </p>
                  )}
                  {s.registeredVia === 'self' && <span className="badge blue small">Self-registered</span>}
                  <p className="small muted" style={{ marginTop: 6 }}><Eye size={12} /> Tap for full details &amp; attendance graph</p>
                </div>
              </div>
              <div className="row-buttons">
                <button className="icon-btn" onClick={() => setEditing(s)} title="Edit"><Edit2 size={16} /></button>
                <button className="icon-btn icon-btn-danger" onClick={() => del(s._id)} title="Delete"><Trash2 size={16} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {(adding || editing) && (
        <StudentForm
          info={info}
          student={editing}
          refreshInfo={refreshInfo}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); load(); }}
        />
      )}

      {viewing && (
        <StudentDetailModal student={viewing} info={info} onClose={() => setViewing(null)} onEdit={() => { setEditing(viewing); setViewing(null); }} />
      )}

      {showCodeFor && (
        <Modal onClose={() => setShowCodeFor(null)} title={`Parent code for ${showCodeFor.name}`}>
          <div className="code-display">
            <div className="muted small">The code is fixed (it won't change). It includes the last 4 digits of the parent's phone so it's easy to remember.</div>
            <div className="code-big">{showCodeFor.parentCode}</div>
            <div className="row-buttons" style={{ justifyContent: 'center', marginTop: 12 }}>
              <button className="btn btn-outline btn-mini" onClick={() => navigator.clipboard?.writeText(showCodeFor.parentCode)}>
                <Copy size={14} /> Copy code
              </button>
              {showCodeFor.parentPhone && (
                <a
                  className="btn btn-whatsapp btn-mini"
                  href={whatsappLink(
                    showCodeFor.parentPhone,
                    `Hello! This is ${info.teacherName || 'your teacher'} from ${info.classroomName || 'coaching center'}.\n\nUse this code to view ${showCodeFor.name}'s attendance and fees:\n\n*${showCodeFor.parentCode}*\n\nOpen the website, tap "Sign In", and enter this code.`
                  )}
                  target="_blank" rel="noreferrer"
                >
                  <MessageCircle size={14} /> Send via WhatsApp
                </a>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function StudentForm({ info, student, onClose, onSaved, refreshInfo }) {
  // Always see the latest classes/subjects/batches when this opens
  useEffect(() => { if (refreshInfo) refreshInfo(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [form, setForm] = useState(student || {
    name: '', phone: '', parentName: '', motherName: '', parentPhone: '',
    aadhar: '', birthday: '', subjects: [], notes: '', batchId: '', className: '', photo: '', monthlyFee: 0, feeDueDay: 5
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleSubject = (s) => {
    setForm(f => ({
      ...f,
      subjects: (f.subjects || []).includes(s) ? f.subjects.filter(x => x !== s) : [...(f.subjects || []), s]
    }));
  };

  const save = async () => {
    setError('');
    if (!form.name) { setError('Name is required'); return; }
    if (form.aadhar && !isValidAadhar(form.aadhar)) {
      setError('Aadhar number failed checksum — please double-check the 12 digits.'); return;
    }
    setSaving(true);
    try {
      if (student) await api.put('/students/' + student._id, form);
      else          await api.post('/students', form);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save');
    } finally { setSaving(false); }
  };

  const subjectOptions = ((info.subjects && info.subjects.length) ? info.subjects.map(getSubjectName) : ['Mathematics', 'Science', 'English']).filter(Boolean);
  const age = ageFromDOB(form.birthday);
  const aadharValid = form.aadhar ? isValidAadhar(form.aadhar) : null;

  return (
    <Modal onClose={onClose} title={student ? 'Edit Student' : 'Add New Student'}>
      <PhotoCapture value={form.photo || ''} onChange={(p) => setForm(f => ({ ...f, photo: p }))} />

      <label>Name *</label>
      <input value={form.name} onChange={e => setForm({...form, name: e.target.value})} autoFocus />
      <label>Phone</label>
      <input value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})} />
      <label>Date of Birth {age != null && <span className="age-tag">Age {age}</span>}</label>
      <input type="date" value={form.birthday || ''} onChange={e => setForm({...form, birthday: e.target.value})} />
      <label>Parent / Father Name</label>
      <input value={form.parentName || ''} onChange={e => setForm({...form, parentName: e.target.value})} />
      <label>Mother Name</label>
      <input value={form.motherName || ''} onChange={e => setForm({...form, motherName: e.target.value})} />
      <label>Parent Phone</label>
      <input value={form.parentPhone || ''} onChange={e => setForm({...form, parentPhone: e.target.value})} />
      <label>
        Aadhar (12 digits)
        {aadharValid === true && <span className="badge green small"><Check size={12} /> valid</span>}
        {aadharValid === false && <span className="badge red small">invalid</span>}
      </label>
      <input value={form.aadhar || ''} onChange={e => setForm({...form, aadhar: e.target.value.replace(/\D/g, '').slice(0, 12)})} maxLength={12} inputMode="numeric" />

      {/* Class (just a label - e.g. "8th Standard", no fee logic) */}
      <label>Class / Standard</label>
      <input value={form.className || ''} onChange={e => setForm({ ...form, className: e.target.value })} placeholder="e.g. 8th Standard, Class 10, etc." />

      {/* Monthly Fee (manual per student) */}
      <label>Monthly Fee (₹) <span className="small muted">— set whatever amount you want for this student</span></label>
      <input
        type="number"
        min="0"
        value={form.monthlyFee || 0}
        onChange={e => setForm({ ...form, monthlyFee: Number(e.target.value) || 0 })}
        placeholder="e.g. 5000"
      />

      <label>Fee Due Day <span className="small muted">— day of the month when fee is due</span></label>
      <select
        value={form.feeDueDay || 5}
        onChange={e => setForm({ ...form, feeDueDay: Number(e.target.value) })}
      >
        {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
          <option key={d} value={d}>{d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'} of every month</option>
        ))}
      </select>

      <label>Batch</label>
      {(info.batches?.length || 0) === 0 ? (
        <p className="small muted">No batches yet — add some in Settings → Batches.</p>
      ) : (
        <select value={form.batchId || ''} onChange={e => setForm({ ...form, batchId: e.target.value })}>
          <option value="">— No batch —</option>
          {info.batches.map(b => (
            <option key={b._id} value={b._id}>{b.name} ({b.startTime}-{b.endTime})</option>
          ))}
        </select>
      )}

      <label>Subjects</label>
      <div className="checkbox-group">
        {subjectOptions.length === 0 && <p className="small muted">No subjects yet — add some in Settings.</p>}
        {subjectOptions.map(s => (
          <label key={s} className="checkbox-label">
            <input type="checkbox" checked={(form.subjects || []).includes(s)} onChange={() => toggleSubject(s)} />
            <span>{s}</span>
          </label>
        ))}
      </div>

      <label>Notes</label>
      <textarea value={form.notes || ''} onChange={e => setForm({...form, notes: e.target.value})} rows={3} />
      {error && <div className="error-box">{error}</div>}
      <div className="modal-buttons">
        <button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          <Save size={14} /> {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

// ============================
// SUMMARY TAB — with batch chart (feature #10)
// ============================
function SummaryTab({ info }) {
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [studentFees, setStudentFees] = useState(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [monthFilter, setMonthFilter] = useState('');
  const [allSummaries, setAllSummaries] = useState({}); // {studentId: {present, absent, percentage}}

  useEffect(() => {
    api.get('/students').then(async r => {
      setStudents(r.data);
      setLoading(false);
      // pre-fetch summaries for chart
      const map = {};
      await Promise.all(r.data.map(async s => {
        try {
          const sr = await api.get('/attendance/summary/' + s._id);
          map[s._id] = sr.data;
        } catch {}
      }));
      setAllSummaries(map);
    });
  }, []);

  const loadStudent = async (s) => {
    setSelected(s);
    setSummary(null); setHistory([]); setStudentFees(null);
    const [summ, hist, fees] = await Promise.all([
      api.get('/attendance/summary/' + s._id),
      api.get('/attendance/student/' + s._id),
      api.get('/fees/student/' + s._id).catch(() => ({ data: null })),
    ]);
    setSummary(summ.data);
    setHistory(hist.data);
    setStudentFees(fees.data);
  };

  if (loading) return <p className="muted">Loading...</p>;
  if (students.length === 0) return (
    <div className="empty">
      <BarChart3 size={48} color="#999" />
      <h3>No students yet</h3>
      <p className="muted">Add students first to see summaries.</p>
    </div>
  );

  const filtered = students.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  const filteredHistory = monthFilter ? history.filter(h => h.date.startsWith(monthFilter)) : history;
  const monthOptions = Array.from(new Set(history.map(h => h.date.substring(0, 7)))).sort().reverse();

  // Feature #10: per-batch attendance chart
  const batchGroups = {};
  const noBatchGroup = { name: 'No batch', percentages: [], students: [] };
  students.forEach(s => {
    const summ = allSummaries[s._id];
    const pct = summ?.percentage ?? 0;
    if (s.batchId) {
      const b = findBatch(info, s.batchId);
      const key = s.batchId;
      if (!batchGroups[key]) batchGroups[key] = { name: b?.name || 'Batch', percentages: [], students: [] };
      batchGroups[key].percentages.push(pct);
      batchGroups[key].students.push(s);
    } else {
      noBatchGroup.percentages.push(pct);
      noBatchGroup.students.push(s);
    }
  });
  const chartGroups = [...Object.values(batchGroups)];
  if (noBatchGroup.percentages.length) chartGroups.push(noBatchGroup);

  const shareWithParent = () => {
    if (!selected || !summary) return;
    const msg = `Hi! Attendance update for ${selected.name} (Roll #${selected.rollNumber}) from ${info.classroomName || 'our coaching center'}:\n\n` +
      `✅ Days Present: ${summary.present}\n` +
      `❌ Days Absent: ${summary.absent}\n` +
      `📊 Attendance: ${summary.percentage}%\n\n` +
      (summary.absentDays.length ? `Recent absences:\n${summary.absentDays.slice(0, 3).map(a => `• ${a.date} - ${a.reason}`).join('\n')}\n\n` : '') +
      `- ${info.teacherName || 'Teacher'}`;
    window.open(whatsappLink(selected.parentPhone, msg), '_blank');
  };

  return (
    <div>
      {/* Chart at the top */}
      <div className="chart-card">
        <h3><BarChart3 size={18} /> Attendance by Batch (average)</h3>
        {chartGroups.length === 0 ? (
          <p className="muted small">Add students to batches to see this chart.</p>
        ) : (
          <BatchChart groups={chartGroups.map(g => ({
            name: g.name,
            value: g.percentages.length ? Math.round(g.percentages.reduce((a, b) => a + b, 0) / g.percentages.length) : 0,
            count: g.students.length
          }))} />
        )}
      </div>

      <div className="summary-grid">
        <div>
          <div className="search-bar">
            <Search size={16} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search students" />
          </div>
          <div className="list">
            {filtered.map(s => {
              const sm = allSummaries[s._id];
              return (
                <button key={s._id} className={'list-item' + (selected?._id === s._id ? ' active' : '')} onClick={() => loadStudent(s)}>
                  <div>
                    <strong>{s.name}</strong>
                    <p className="muted small">Roll #{s.rollNumber}{sm ? ` · ${sm.percentage}%` : ''}</p>
                  </div>
                  <ChevronRight size={16} />
                </button>
              );
            })}
          </div>
        </div>
        <div>
          {!selected ? (
            <div className="empty">
              <Search size={48} color="#999" />
              <h3>Select a student</h3>
              <p className="muted">Tap a student to see their attendance summary.</p>
            </div>
          ) : (
            <>
              <div className="row" style={{justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'flex-start'}}>
                <div className="row" style={{ gap: 14, alignItems: 'center' }}>
                  {selected.photo
                    ? <img src={selected.photo} alt={selected.name} className="detail-avatar" />
                    : <div className="detail-avatar placeholder"><User size={28} /></div>}
                  <div>
                    <h2 className="display" style={{ marginBottom: 4 }}>{selected.name}</h2>
                    <p className="muted small" style={{ margin: 0 }}>Roll #{selected.rollNumber}{ageFromDOB(selected.birthday) != null ? ` · Age ${ageFromDOB(selected.birthday)}` : ''}</p>
                  </div>
                </div>
                {selected.parentPhone && (
                  <button className="btn btn-whatsapp" onClick={shareWithParent}>
                    <Share2 size={14} /> Share with Parent
                  </button>
                )}
              </div>

              {/* Personal info card */}
              <div className="info-card">
                <h3>Personal info</h3>
                <dl className="info-dl">
                  {selected.phone && <><dt>Phone</dt><dd>{selected.phone}</dd></>}
                  {selected.birthday && <><dt>Date of Birth</dt><dd>{selected.birthday}{ageFromDOB(selected.birthday) != null ? ` (Age ${ageFromDOB(selected.birthday)})` : ''}</dd></>}
                  {selected.aadhar && <><dt>Aadhar</dt><dd>{selected.aadhar}</dd></>}
                  {selected.parentName && <><dt>Parent</dt><dd>{selected.parentName}</dd></>}
                  {selected.parentPhone && <><dt>Parent phone</dt><dd>{selected.parentPhone}</dd></>}
                  {selected.parentCode && <><dt>Parent code</dt><dd><code className="inline-code">{selected.parentCode}</code></dd></>}
                  {selected.className && <><dt>Class</dt><dd>{selected.className}</dd></>}
                  {Number(selected.monthlyFee) > 0 && <><dt>Monthly Fee</dt><dd>{formatRupee(selected.monthlyFee)}</dd></>}
                  {selected.batchId && findBatch(info, selected.batchId) && <><dt>Batch</dt><dd>{findBatch(info, selected.batchId).name} ({findBatch(info, selected.batchId).startTime}-{findBatch(info, selected.batchId).endTime})</dd></>}
                  {selected.subjects?.length > 0 && <><dt>Subjects</dt><dd>{selected.subjects.join(', ')}</dd></>}
                  {selected.enrollmentDate && <><dt>Enrolled</dt><dd>{selected.enrollmentDate}</dd></>}
                  {selected.notes && <><dt>Notes</dt><dd>{selected.notes}</dd></>}
                </dl>
              </div>

              {summary && (
                <div className="summary-stats">
                  <div className="stat-big green"><strong>{summary.present}</strong><span>Present</span></div>
                  <div className="stat-big red"><strong>{summary.absent}</strong><span>Absent</span></div>
                  <div className="stat-big blue"><strong>{summary.percentage}%</strong><span>Attendance</span></div>
                </div>
              )}

              {studentFees?.fees && (
                <div className="info-card">
                  <h3><IndianRupee size={14} /> Fees ({studentFees.fees.year}-{String(studentFees.fees.month).padStart(2, '0')})</h3>
                  <dl className="info-dl">
                    <dt>Class</dt><dd>{studentFees.fees.className || '—'}</dd>
                    <dt>Monthly fee</dt><dd>{formatRupee(studentFees.fees.monthlyFee || 0)}</dd>
                    <dt>Working days</dt><dd>{studentFees.fees.workingDays} / {studentFees.fees.totalDays}</dd>
                    <dt>Per working day</dt><dd>{formatRupee(Math.round(studentFees.fees.perDay || 0))}</dd>
                  </dl>
                </div>
              )}

              <div className="row" style={{justifyContent: 'space-between'}}>
                <h3><BarChart3 size={16} /> Attendance — {monthFilter || new Date().toISOString().substring(0, 7)}</h3>
                {monthOptions.length > 0 && (
                  <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="sort-select">
                    <option value="">Current month</option>
                    {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                )}
              </div>
              <AttendanceGraph history={history} month={monthFilter || new Date().toISOString().substring(0, 7)} />

              <h3 style={{ marginTop: 20 }}>Attendance History</h3>
              <div className="list">
                {filteredHistory.length === 0 && <p className="muted">No records for this period.</p>}
                {filteredHistory.map(h => (
                  <div key={h._id} className="history-row">
                    <div>
                      <strong>{formatDate(h.date)}</strong>
                      {h.status === 'present' ? (
                        <span className="badge green small">
                          <CheckCircle size={12} /> Present {h.inTime && `· ${h.inTime} - ${h.outTime || '?'}`}
                        </span>
                      ) : (
                        <span className="badge red small"><XCircle size={12} /> Absent {h.reason && `· ${h.reason}`}</span>
                      )}
                      {h.note && <p className="small muted" style={{ marginTop: 4 }}>"{h.note}"</p>}
                    </div>
                    {h.markedBy === 'teacher' && <span className="small muted">Marked by you</span>}
                    {h.markedBy === 'self' && <span className="small muted">Self-marked</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple SVG bar chart used by SummaryTab and FeesTab
// Attendance graph — calendar-style view of one month showing present/absent/unmarked days
function AttendanceGraph({ history, month }) {
  // month is YYYY-MM string; default to current
  const [yStr, mStr] = (month || new Date().toISOString().substring(0, 7)).split('-');
  const year = Number(yStr);
  const m = Number(mStr); // 1..12
  const daysInMonth = new Date(year, m, 0).getDate();
  const firstWeekday = new Date(year, m - 1, 1).getDay(); // 0=Sun
  const todayISO = new Date().toISOString().substring(0, 10);

  // Build lookup of date -> status
  const byDate = {};
  (history || []).forEach(h => { byDate[h.date] = h; });

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  let present = 0, absent = 0, unmarked = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const rec = byDate[iso];
    if (iso <= todayISO) {
      if (rec?.status === 'present') present++;
      else if (rec?.status === 'absent') absent++;
      else unmarked++;
    }
    cells.push({ day: d, iso, rec });
  }
  const total = present + absent;
  const pct = total ? Math.round((present / total) * 100) : 0;

  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="att-graph-card">
      <div className="att-graph-summary">
        <div className="att-stat green"><strong>{present}</strong><span>Present</span></div>
        <div className="att-stat red"><strong>{absent}</strong><span>Absent</span></div>
        <div className="att-stat blue"><strong>{pct}%</strong><span>Rate</span></div>
      </div>
      <div className="att-cal">
        {dayLabels.map((d, i) => <div key={'dl' + i} className="att-cal-label">{d}</div>)}
        {cells.map((c, i) => {
          if (!c) return <div key={'e' + i} className="att-cal-cell empty" />;
          const future = c.iso > todayISO;
          let cls = 'att-cal-cell';
          if (future) cls += ' future';
          else if (c.rec?.status === 'present') cls += ' present';
          else if (c.rec?.status === 'absent') cls += ' absent';
          else cls += ' unmarked';
          if (c.iso === todayISO) cls += ' today';
          return (
            <div key={c.iso} className={cls} title={`${c.iso}${c.rec ? ': ' + c.rec.status : ''}`}>
              {c.day}
            </div>
          );
        })}
      </div>
      <div className="att-cal-legend">
        <span><span className="dot green" /> Present</span>
        <span><span className="dot red" /> Absent</span>
        <span><span className="dot gray" /> Not marked</span>
      </div>
    </div>
  );
}

function BatchChart({ groups }) {
  if (!groups.length) return null;
  const maxV = Math.max(100, ...groups.map(g => g.value));
  const barH = 28;
  const gap = 12;
  const labelW = 140;
  const chartW = 460;
  const h = groups.length * (barH + gap) + gap;
  return (
    <svg viewBox={`0 0 ${labelW + chartW + 60} ${h}`} style={{ width: '100%', maxWidth: 720 }} role="img">
      {groups.map((g, i) => {
        const y = gap + i * (barH + gap);
        const w = (g.value / maxV) * chartW;
        return (
          <g key={i}>
            <text x={0} y={y + barH / 2 + 5} fontSize="13" fill="#444">{g.name}</text>
            <rect x={labelW} y={y} width={chartW} height={barH} fill="#f5f0e9" rx={4} />
            <rect x={labelW} y={y} width={Math.max(2, w)} height={barH} fill="#c2410c" rx={4} />
            <text x={labelW + Math.max(4, w) + 6} y={y + barH / 2 + 5} fontSize="13" fill="#1f1f1f" fontWeight="600">
              {g.value}% {g.count != null ? `(${g.count})` : ''}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ============================
// FEES TAB — features #6, #7, #8, #11
// ============================
function FeesTab({ info }) {
  const [month, setMonth] = useState(thisMonth());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [batchFilter, setBatchFilter] = useState('');
  const [classFilter, setClassFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/fees/summary', { params: { month } });
      setData(r.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month]);

  if (loading) return <p className="muted">Loading fees…</p>;
  if (!data) return <p className="muted">No data.</p>;

  let rows = data.students;
  if (batchFilter) rows = rows.filter(s => s.batchId === batchFilter);
  if (classFilter) rows = rows.filter(s => s.className === classFilter);

  const monthlyTotal = rows.reduce((a, r) => a + (r.fees?.monthlyFee || 0), 0);
  const dailyTotal   = rows.reduce((a, r) => a + (r.fees?.perDay     || 0), 0);

  // Group by class for the chart (cleaner than by batch now that fees attach to class).
  const groups = {};
  rows.forEach(r => {
    const key = r.className || '__none__';
    if (!groups[key]) groups[key] = { name: r.className || 'No class', value: 0, count: 0 };
    groups[key].value += r.fees?.monthlyFee || 0;
    groups[key].count += 1;
  });

  return (
    <div>
      <div className="toolbar">
        <div className="row">
          <label style={{ margin: 0 }}>Month:</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="sort-select" />
        </div>
        {(info.classes?.length || 0) > 0 && (
          <select className="sort-select" value={classFilter} onChange={e => setClassFilter(e.target.value)}>
            <option value="">All classes</option>
            {info.classes.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
          </select>
        )}
        {(info.batches?.length || 0) > 0 && (
          <select className="sort-select" value={batchFilter} onChange={e => setBatchFilter(e.target.value)}>
            <option value="">All batches</option>
            {info.batches.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
        )}
      </div>

      <div className="summary-stats">
        <div className="stat-big green"><strong>{formatRupee(monthlyTotal)}</strong><span>Total / month</span></div>
        <div className="stat-big blue"><strong>{formatRupee(Math.round(dailyTotal))}</strong><span>Total / working day</span></div>
        <div className="stat-big"><strong>{rows.length}</strong><span>Students</span></div>
      </div>

      {Object.keys(groups).length > 0 && (
        <div className="chart-card">
          <h3><BarChart3 size={18} /> Monthly fees by class</h3>
          <BatchChart groups={Object.values(groups).map(g => ({ name: g.name, value: Math.round(g.value), count: g.count }))} />
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>Per-student breakdown</h3>
      <div className="list">
        {rows.length === 0 && <p className="muted">No students for this filter.</p>}
        {rows.map(r => {
          const batch = findBatch(info, r.batchId);
          const f = r.fees || {};
          return (
            <div key={r._id} className="fee-row">
              <div className="fee-row-left">
                <div className="fee-row-name">{r.name}</div>
                <div className="fee-row-meta">
                  <span className="fee-pill">Roll #{r.rollNumber}</span>
                  {r.className && <span className="fee-pill fee-pill-class">{r.className}</span>}
                  {batch && <span className="fee-pill">{batch.name}</span>}
                  <span className="fee-pill">{f.workingDays || 0}/{f.totalDays || 0} working days</span>
                </div>
              </div>
              <div className="fee-row-amount">
                <div className="fee-row-month">{formatRupee(f.monthlyFee || 0)}</div>
                <div className="fee-row-day">{formatRupee(Math.round(f.perDay || 0))}/day</div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="small muted" style={{ marginTop: 12 }}>
        <Info size={12} /> Per-day = monthly fee ÷ working days. Working days = total days minus weekly off (Sunday by default). Announced holidays do <strong>not</strong> reduce the working-day count.
      </p>
    </div>
  );
}

// ============================
// ANNOUNCEMENTS TAB — calendar picker + per-batch (feature #3)
// ============================
function AnnouncementsTab({ info }) {
  const [list, setList] = useState([]);
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('general');
  const [message, setMessage] = useState('');
  const [datePick, setDatePick] = useState('');
  const [dates, setDates] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const r = await api.get('/announcements');
    setList(r.data);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const addDate = () => {
    if (!datePick) return;
    if (dates.includes(datePick)) return;
    setDates(d => [...d, datePick].sort());
    setDatePick('');
  };

  const removeDate = (d) => setDates(arr => arr.filter(x => x !== d));

  const reset = () => {
    setType('general'); setMessage(''); setDatePick(''); setDates([]); setBatchId('');
  };

  const send = async () => {
    if (!message) return;
    await api.post('/announcements', {
      message, type,
      dates: type === 'off-day' ? dates : [],
      batchId: batchId || ''
    });
    reset();
    setAdding(false);
    load();
  };

  const del = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    await api.delete('/announcements/' + id);
    load();
  };

  const shareViaWhatsApp = (a) => {
    const batch = findBatch(info, a.batchId);
    let text = `📢 *${info.classroomName || 'Coaching Center'}*\n\n`;
    if (a.type === 'off-day') {
      text += `🏖️ *Holiday Notice*${batch ? ` (Batch: ${batch.name})` : ''}\n${a.message}\n\nDates: ${a.dates.join(', ')}\n\n`;
    } else {
      text += `${batch ? `*Batch: ${batch.name}*\n` : ''}${a.message}\n\n`;
    }
    text += `- ${info.teacherName || 'Teacher'}`;
    window.open(whatsappLink(null, text), '_blank');
  };

  if (loading) return <p className="muted">Loading...</p>;

  return (
    <div>
      <div className="toolbar">
        <h2 className="display">Announcements</h2>
        <button className="btn btn-primary" onClick={() => setAdding(true)}><Plus size={16} /> New Announcement</button>
      </div>

      {list.length === 0 && (
        <div className="empty">
          <Megaphone size={48} color="#999" />
          <h3>No announcements yet</h3>
          <p className="muted">Send updates to all your students and parents.</p>
        </div>
      )}

      <div className="list">
        {list.map(a => {
          const batch = findBatch(info, a.batchId);
          return (
            <div key={a._id} className="announcement-card">
              <div style={{flex: 1}}>
                {a.type === 'off-day' ? (
                  <span className="badge red"><CalendarOff size={12} /> Off Day</span>
                ) : (
                  <span className="badge blue"><MessageSquare size={12} /> General</span>
                )}
                {batch && <span className="badge gray small" style={{ marginLeft: 6 }}><Layers size={12} /> {batch.name}</span>}
                {!batch && a.batchId === '' && <span className="badge gray small" style={{ marginLeft: 6 }}>All batches</span>}
                <p>{a.message}</p>
                {a.dates?.length > 0 && <p className="small muted">Dates: {a.dates.map(formatDate).join(', ')}</p>}
                <p className="small muted">{new Date(a.createdAt).toLocaleString()}</p>
              </div>
              <div className="row-buttons">
                <button className="btn btn-whatsapp btn-mini" onClick={() => shareViaWhatsApp(a)} title="Share via WhatsApp">
                  <Share2 size={14} /> Share
                </button>
                <button className="icon-btn icon-btn-danger" onClick={() => del(a._id)}><Trash2 size={16} /></button>
              </div>
            </div>
          );
        })}
      </div>

      {adding && (
        <Modal onClose={() => { setAdding(false); reset(); }} title="Send Announcement">
          <label>Type</label>
          <div className="radio-group">
            <label className="radio-label">
              <input type="radio" value="general" checked={type === 'general'} onChange={e => setType(e.target.value)} />
              <span>General Message</span>
            </label>
            <label className="radio-label">
              <input type="radio" value="off-day" checked={type === 'off-day'} onChange={e => setType(e.target.value)} />
              <span>Off-day (Holiday)</span>
            </label>
          </div>

          <label>For which batch?</label>
          <select value={batchId} onChange={e => setBatchId(e.target.value)}>
            <option value="">All batches (everyone)</option>
            {(info.batches || []).map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>

          <label>Message</label>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={3} placeholder="Your message to students and parents" />

          {type === 'off-day' && (
            <>
              <label><CalendarDays size={14} /> Pick holiday dates</label>
              <div className="row">
                <input type="date" value={datePick} onChange={e => setDatePick(e.target.value)} />
                <button type="button" className="btn btn-outline" onClick={addDate}><Plus size={14} /> Add</button>
              </div>
              {dates.length > 0 ? (
                <div className="chip-group" style={{ marginTop: 8 }}>
                  {dates.map(d => (
                    <span key={d} className="chip">
                      {formatDate(d)} <button onClick={() => removeDate(d)}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="small muted">Pick a date above and tap Add. You can add as many as you like.</p>
              )}
              <p className="small muted">When today matches any of these dates, a "Holiday" banner will show for the selected batch.</p>
            </>
          )}

          <div className="modal-buttons">
            <button className="btn btn-outline" onClick={() => { setAdding(false); reset(); }}>Cancel</button>
            <button className="btn btn-primary" onClick={send} disabled={!message || (type === 'off-day' && dates.length === 0)}>
              <Send size={14} /> Save & Send
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ============================
// SETTINGS TAB — subjects (names only), classes (with fees), batches, teacher password, storage
// ============================
function SettingsTab({ info, refreshInfo }) {
  const [form, setForm] = useState(info);
  const [subjectName, setSubjectName] = useState('');
  const [className, setClassName] = useState('');
  const [classFee, setClassFee] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [newPassword, setNewPassword] = useState('');

  // Normalize anything coming from the server into the shapes the UI expects.
  useEffect(() => {
    setForm({
      ...info,
      subjects: (info.subjects || []).map(s => ({ name: typeof s === 'string' ? s : s.name })),
      classes:  (info.classes  || []).map(c => ({ ...c, monthlyFee: Number(c.monthlyFee) || 0 })),
      batches:  (info.batches  || []).map(b => ({ ...b })),
    });
  }, [info]);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        ...form,
        subjects: (form.subjects || []).map(s => ({ name: (s.name || '').trim() })).filter(s => s.name),
        classes:  (form.classes  || []).map(c => ({
          _id: c._id, name: (c.name || '').trim(), monthlyFee: Number(c.monthlyFee) || 0,
        })).filter(c => c.name),
        batches:  (form.batches  || []).map(b => ({
          _id: b._id, name: (b.name || '').trim(),
          startTime: b.startTime || '09:00', endTime: b.endTime || '11:00',
          weeklyOffDays: (b.weeklyOffDays && b.weeklyOffDays.length) ? b.weeklyOffDays : [0]
        })).filter(b => b.name),
      };
      if (showPwd && newPassword) body.teacherPassword = newPassword;
      await api.put('/config', body);
      if (refreshInfo) await refreshInfo();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      setNewPassword('');
      setShowPwd(false);
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    } finally { setSaving(false); }
  };

  // -- Subjects (names only, no fees) ----------------------------------------
  const addSubject = () => {
    const name = subjectName.trim();
    if (!name) return;
    setForm(f => {
      if ((f.subjects || []).some(s => s.name.toLowerCase() === name.toLowerCase())) return f;
      return { ...f, subjects: [...(f.subjects || []), { name }] };
    });
    setSubjectName('');
  };
  const removeSubject = (name) => {
    setForm(f => ({ ...f, subjects: (f.subjects || []).filter(s => s.name !== name) }));
  };

  // -- Classes (with monthly fee) --------------------------------------------
  const addClass = () => {
    const name = className.trim();
    if (!name) return;
    const fee = Number(classFee) || 0;
    setForm(f => {
      if ((f.classes || []).some(c => c.name.toLowerCase() === name.toLowerCase())) return f;
      return { ...f, classes: [...(f.classes || []), { name, monthlyFee: fee }] };
    });
    setClassName(''); setClassFee('');
  };
  const updateClassFee = (name, fee) => {
    setForm(f => ({
      ...f,
      classes: (f.classes || []).map(c => c.name === name ? { ...c, monthlyFee: Number(fee) || 0 } : c)
    }));
  };
  const removeClass = (name) => {
    setForm(f => ({ ...f, classes: (f.classes || []).filter(c => c.name !== name) }));
  };

  // -- Batches ---------------------------------------------------------------
  const addBatch = () => {
    setForm(f => ({
      ...f,
      batches: [...(f.batches || []), { name: 'New Batch', startTime: '09:00', endTime: '11:00', weeklyOffDays: [0] }]
    }));
  };
  const updateBatch = (idx, patch) => {
    setForm(f => ({
      ...f,
      batches: (f.batches || []).map((b, i) => i === idx ? { ...b, ...patch } : b)
    }));
  };
  const toggleBatchOffDay = (idx, dow) => {
    setForm(f => ({
      ...f,
      batches: (f.batches || []).map((b, i) => {
        if (i !== idx) return b;
        const cur = b.weeklyOffDays || [0];
        return { ...b, weeklyOffDays: cur.includes(dow) ? cur.filter(d => d !== dow) : [...cur, dow].sort() };
      })
    }));
  };
  const removeBatch = (idx) => {
    if (!confirm('Remove this batch? Students assigned to it will become unassigned.')) return;
    setForm(f => ({ ...f, batches: (f.batches || []).filter((_, i) => i !== idx) }));
  };

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="container-narrow">
      <h2 className="display">Coaching Center Settings</h2>
      <label>Coaching Name</label>
      <input value={form.classroomName || ''} onChange={e => setForm({...form, classroomName: e.target.value})} />
      <label>Teacher Name</label>
      <input value={form.teacherName || ''} onChange={e => setForm({...form, teacherName: e.target.value})} />
      <label>Phone</label>
      <input value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})} />
      <label>Email</label>
      <input value={form.email || ''} onChange={e => setForm({...form, email: e.target.value})} />
      <label>Map URL (Google Maps link)</label>
      <input value={form.mapUrl || ''} onChange={e => setForm({...form, mapUrl: e.target.value})} />
      <label>Default Class Start Time</label>
      <input type="time" value={form.classStart || ''} onChange={e => setForm({...form, classStart: e.target.value})} />
      <label>Default Class End Time</label>
      <input type="time" value={form.classEnd || ''} onChange={e => setForm({...form, classEnd: e.target.value})} />

      <hr />
      <h3><Layers size={16} /> Batches (each can have its own timing & off-days)</h3>
      <p className="small muted">Default off-day is Sunday only.</p>
      <div className="batch-list">
        {(form.batches || []).map((b, i) => (
          <div key={b._id || i} className="batch-card">
            <div className="row">
              <label style={{ margin: 0, minWidth: 60 }}>Name</label>
              <input value={b.name || ''} onChange={e => updateBatch(i, { name: e.target.value })} placeholder="e.g. Morning 6th Grade" />
            </div>
            <div className="row">
              <label style={{ margin: 0, minWidth: 60 }}>Start</label>
              <input type="time" value={b.startTime || ''} onChange={e => updateBatch(i, { startTime: e.target.value })} />
              <label style={{ margin: 0, minWidth: 40 }}>End</label>
              <input type="time" value={b.endTime || ''} onChange={e => updateBatch(i, { endTime: e.target.value })} />
            </div>
            <div>
              <label style={{ marginTop: 8 }}>Weekly off days</label>
              <div className="chip-group">
                {dayNames.map((d, dow) => (
                  <button
                    key={dow}
                    type="button"
                    className={'chip-toggle' + ((b.weeklyOffDays || []).includes(dow) ? ' on' : '')}
                    onClick={() => toggleBatchOffDay(i, dow)}
                  >{d}</button>
                ))}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-outline btn-mini" onClick={() => removeBatch(i)}>
                <Trash2 size={14} /> Remove batch
              </button>
            </div>
          </div>
        ))}
      </div>
      <button className="btn btn-outline" onClick={addBatch}><Plus size={14} /> Add batch</button>

      <hr />
      <h3><BookOpen size={16} /> Subjects</h3>
      <p className="small muted">Just for organization — subjects don't carry fees.</p>
      <div className="chip-group" style={{ marginBottom: 10 }}>
        {(form.subjects || []).map(s => (
          <span key={s.name} className="chip-static">
            {s.name}
            <button className="chip-x" onClick={() => removeSubject(s.name)} aria-label={`Remove ${s.name}`}>×</button>
          </span>
        ))}
        {(form.subjects || []).length === 0 && <span className="small muted">No subjects yet.</span>}
      </div>
      <div className="row">
        <input value={subjectName} onChange={e => setSubjectName(e.target.value)} placeholder="New subject name" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubject(); } }} />
        <button className="btn btn-outline" onClick={addSubject}><Plus size={14} /> Add</button>
      </div>

      <hr />
      <div className="row">
        <h3>Teacher Password</h3>
        <button className="btn-link" onClick={() => setShowPwd(!showPwd)}>{showPwd ? 'Cancel' : 'Change'}</button>
      </div>
      <p className="small muted">Parents log in with their unique 6-character code (from the Students tab). Students mark themselves on your device — no password needed.</p>
      {showPwd && (
        <>
          <label>New Teacher Password</label>
          <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Leave blank to keep current" />
        </>
      )}

      <button className="btn btn-primary btn-block" onClick={save} disabled={saving}>
        <Save size={14} /> {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
      </button>

      <hr />
      <StorageCard />
    </div>
  );
}

// ============================
// STORAGE CARD — iOS-style MongoDB Atlas usage bar
// ============================
function StorageCard() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/storage').then(r => setData(r.data)).catch(e => setErr(e.response?.data?.error || e.message));
  }, []);

  if (err) return <div className="card small muted">Storage info unavailable: {err}</div>;
  if (!data) return <div className="card small muted">Loading storage…</div>;

  const formatBytes = (b) => {
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
    return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const cap = data.cap || (512 * 1024 * 1024);
  const used = data.totalUsed || (data.dataSize + data.indexSize);
  const free = Math.max(0, cap - used);
  const pct = (n) => Math.max(0, Math.min(100, (n / cap) * 100));

  // Colours match the iOS-storage screen vibe.
  const palette = ['#0a84ff', '#30d158', '#ff9f0a', '#bf5af2', '#ff453a', '#5e5ce6', '#64d2ff'];

  // Build segments per collection (data portion), then a single indexes segment.
  const segments = [];
  (data.perCollection || []).forEach((c, i) => {
    if (c.size > 0) segments.push({ label: c.name, size: c.size, color: palette[i % palette.length] });
  });
  if (data.indexSize > 0) segments.push({ label: 'Indexes', size: data.indexSize, color: '#8e8e93' });

  return (
    <div className="storage-card">
      <div className="storage-header">
        <h3 style={{ margin: 0 }}>Database Storage</h3>
        <div className="small muted">{formatBytes(used)} of {formatBytes(cap)} used</div>
      </div>

      <div className="storage-bar" role="img" aria-label={`${formatBytes(used)} of ${formatBytes(cap)} used`}>
        {segments.map((s, i) => (
          <div key={i} className="storage-seg" style={{ width: `${pct(s.size)}%`, background: s.color }} title={`${s.label}: ${formatBytes(s.size)}`} />
        ))}
      </div>

      <div className="storage-legend">
        {segments.map((s, i) => (
          <div key={i} className="storage-legend-row">
            <span className="storage-dot" style={{ background: s.color }} />
            <span className="storage-label">{s.label}</span>
            <span className="storage-size">{formatBytes(s.size)}</span>
          </div>
        ))}
        <div className="storage-legend-row storage-free">
          <span className="storage-dot" style={{ background: '#e5e5ea', border: '1px solid #d1d1d6' }} />
          <span className="storage-label">Free</span>
          <span className="storage-size">{formatBytes(free)}</span>
        </div>
      </div>

      <div className="storage-meta small muted">
        {data.objects.toLocaleString()} documents across {data.collections} collections
      </div>
    </div>
  );
}

// ============================
// STUDENT DASHBOARD — with Undo Check-In (feature #1, #2)
// ============================
function StudentDashboard({ student, info, announcements, onSignOut }) {
  const [tab, setTab] = useState('today');
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);

  const load = async () => {
    if (!student) return;
    try {
      const [hist, summ] = await Promise.all([
        api.get('/attendance/student/' + student._id),
        api.get('/attendance/summary/' + student._id),
      ]);
      setHistory(hist.data);
      setSummary(summ.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, [student]);

  const todayAtt = history.find(h => h.date === todayISO());

  const checkIn = async () => {
    try {
      await api.post('/attendance/check', { studentId: student._id, action: 'in' });
      load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  const checkOut = async () => {
    try {
      await api.post('/attendance/check', { studentId: student._id, action: 'out' });
      load();
    } catch (err) { alert('Failed: ' + err.message); }
  };

  // Feature #1: undo today's check-in if the student tapped someone else's name by mistake
  const undoToday = async () => {
    if (!confirm("Undo today's check-in? You'll be back to 'not marked'.")) return;
    try {
      await api.post('/attendance/undo-self', { studentId: student._id });
      load();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed: ' + err.message);
    }
  };

  // Feature #1 (extra): "This isn't me" - sign out and go back to picker
  const wrongPerson = () => {
    if (!confirm('Sign out and pick the right name?')) return;
    onSignOut();
  };

  const offDay = isOffDayToday(announcements, student?.batchId);

  return (
    <div className="page">
      <header className="dashboard-header">
        <div>
          <h1 className="display">Hi, {student?.name}</h1>
          <p className="muted">Roll #{student?.rollNumber}</p>
        </div>
        <div className="row-buttons">
          <button className="btn btn-outline" onClick={wrongPerson} title="Not you?"><ArrowLeft size={14} /> Not you?</button>
          <button className="btn btn-outline" onClick={onSignOut}><LogOut size={16} /> Sign out</button>
        </div>
      </header>

      <OffDayBanner announcements={announcements} batchId={student?.batchId} />

      <nav className="tabs">
        <button className={tab === 'today' ? 'tab active' : 'tab'} onClick={() => setTab('today')}><Calendar size={16} /> Today</button>
        <button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}><BarChart3 size={16} /> My Attendance</button>
        <button className={tab === 'announcements' ? 'tab active' : 'tab'} onClick={() => setTab('announcements')}><Megaphone size={16} /> Updates</button>
        <button className={tab === 'info' ? 'tab active' : 'tab'} onClick={() => setTab('info')}><Info size={16} /> Class Info</button>
      </nav>

      <main className="tab-content">
        {tab === 'today' && (
          <div className="center-content">
            <h2 className="display">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })}
            </h2>
            {offDay ? (
              <div className="big-card muted-card">
                <CalendarOff size={48} />
                <h3>Today is a holiday</h3>
                <p>{offDay.message}</p>
                <p className="muted small">No check-in needed today</p>
              </div>
            ) : todayAtt ? (
              <div className="big-card green">
                <CheckCircle size={48} />
                <h3>You're marked Present!</h3>
                {todayAtt.inTime && <p>Checked in at: <strong>{todayAtt.inTime}</strong></p>}
                {todayAtt.outTime && <p>Checked out at: <strong>{todayAtt.outTime}</strong></p>}
                {todayAtt.markedBy === 'teacher' && <p className="small">Marked by your teacher</p>}
                <div className="row-center">
                  {!todayAtt.outTime && (
                    <button className="btn btn-primary btn-lg" onClick={checkOut}>
                      <Clock size={18} /> Check Out
                    </button>
                  )}
                  {todayAtt.markedBy === 'self' && (
                    <button className="btn btn-outline btn-lg" onClick={undoToday}>
                      <RotateCcw size={18} /> Undo (wrong tap?)
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="big-card">
                <Clock size={48} />
                <h3>Ready to mark your attendance?</h3>
                <p className="muted">Tap below when you arrive at class</p>
                <button className="btn btn-primary btn-lg" onClick={checkIn}>
                  <CheckCircle size={18} /> Check In Now
                </button>
              </div>
            )}

            {summary && (
              <div className="summary-stats" style={{marginTop: 24}}>
                <div className="stat-big green"><strong>{summary.present}</strong><span>Days Present</span></div>
                <div className="stat-big red"><strong>{summary.absent}</strong><span>Days Absent</span></div>
                <div className="stat-big blue"><strong>{summary.percentage}%</strong><span>Attendance</span></div>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && summary && (
          <div>
            <div className="summary-stats">
              <div className="stat-big green"><strong>{summary.present}</strong><span>Days Present</span></div>
              <div className="stat-big red"><strong>{summary.absent}</strong><span>Days Absent</span></div>
              <div className="stat-big blue"><strong>{summary.percentage}%</strong><span>Attendance</span></div>
            </div>
            <h3>Recent History</h3>
            <div className="list">
              {history.length === 0 && <p className="muted">No records yet.</p>}
              {history.map(h => (
                <div key={h._id} className="history-row">
                  <strong>{formatDate(h.date)}</strong>
                  {h.status === 'present' ? (
                    <span className="badge green small">
                      <CheckCircle size={12} /> Present {h.inTime && `· ${h.inTime} - ${h.outTime || '?'}`}
                    </span>
                  ) : (
                    <span className="badge red small"><XCircle size={12} /> Absent {h.reason && `· ${h.reason}`}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'announcements' && <AnnouncementList announcements={announcements} info={info} />}
        {tab === 'info' && <ClassInfo info={info} student={student} />}
      </main>
    </div>
  );
}

// ============================
// PARENT DASHBOARD — sees only their own child (feature #13), with fees
// ============================
function ParentDashboard({ student, info, announcements, onSignOut }) {
  const [tab, setTab] = useState('summary');
  const [history, setHistory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [monthFilter, setMonthFilter] = useState('');
  const [fees, setFees] = useState(null);
  const [feesMonth, setFeesMonth] = useState(thisMonth());

  const load = async () => {
    if (!student) return;
    try {
      const [hist, summ] = await Promise.all([
        api.get('/attendance/student/' + student._id),
        api.get('/attendance/summary/' + student._id),
      ]);
      setHistory(hist.data);
      setSummary(summ.data);
    } catch (err) { console.error(err); }
  };

  const loadFees = async () => {
    try {
      const r = await api.get('/fees/student/' + student._id, { params: { month: feesMonth } });
      setFees(r.data);
    } catch (err) { console.error(err); }
  };

  useEffect(() => { load(); }, [student]);
  useEffect(() => { if (tab === 'fees') loadFees(); }, [tab, feesMonth]);

  const today = todayISO();
  const todayAtt = history.find(h => h.date === today);
  const offDay = isOffDayToday(announcements, student?.batchId);

  const filteredHistory = monthFilter ? history.filter(h => h.date.startsWith(monthFilter)) : history;
  const monthOptions = Array.from(new Set(history.map(h => h.date.substring(0, 7)))).sort().reverse();

  return (
    <div className="page">
      <header className="dashboard-header">
        <div>
          <h1 className="display">Welcome{student?.parentName ? ', ' + student.parentName : ''}{student?.motherName ? ' & ' + student.motherName : ''}!</h1>
          <p className="muted">{student?.name} · Roll #{student?.rollNumber}{student?.className ? ' · ' + student.className : ''}</p>
        </div>
        <div className="row">
          <button className="btn btn-outline btn-mini" onClick={load} title="Refresh"><RefreshCw size={14} /></button>
          <button className="btn btn-outline" onClick={onSignOut}><LogOut size={16} /> Sign out</button>
        </div>
      </header>

      <FeesReminderBanner />

      <OffDayBanner announcements={announcements} batchId={student?.batchId} />

      <nav className="tabs">
        <button className={tab === 'summary' ? 'tab active' : 'tab'} onClick={() => setTab('summary')}><BarChart3 size={16} /> Summary</button>
        <button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}><Calendar size={16} /> History</button>
        <button className={tab === 'fees' ? 'tab active' : 'tab'} onClick={() => setTab('fees')}><Wallet size={16} /> Fees</button>
        <button className={tab === 'exams' ? 'tab active' : 'tab'} onClick={() => setTab('exams')}><BookOpen size={16} /> Exams</button>
        <button className={tab === 'holidays' ? 'tab active' : 'tab'} onClick={() => setTab('holidays')}><CalendarOff size={16} /> Holidays</button>
        <button className={tab === 'chat' ? 'tab active' : 'tab'} onClick={() => setTab('chat')}><MessageCircle size={16} /> Chat with Teacher</button>
        <button className={tab === 'info' ? 'tab active' : 'tab'} onClick={() => setTab('info')}><Info size={16} /> Class Info</button>
      </nav>

      <main className="tab-content">
        {tab === 'summary' && summary && (
          <div>
            <div className="today-status">
              {offDay ? (
                <div className="big-card muted-card">
                  <CalendarOff size={48} />
                  <h3>Today is a holiday</h3>
                  <p>{offDay.message}</p>
                </div>
              ) : todayAtt ? (
                <div className={'big-card ' + (todayAtt.status === 'present' ? 'green' : 'red')}>
                  {todayAtt.status === 'present' ? <CheckCircle size={48} /> : <XCircle size={48} />}
                  <h3>Today: {todayAtt.status === 'present' ? 'Present' : 'Absent'}</h3>
                  {todayAtt.inTime && <p>Checked in at: <strong>{todayAtt.inTime}</strong></p>}
                  {todayAtt.outTime && <p>Checked out at: <strong>{todayAtt.outTime}</strong></p>}
                  {todayAtt.reason && <p>Reason: <strong>{todayAtt.reason}</strong></p>}
                  {todayAtt.markedBy === 'teacher' && <p className="small">Marked by teacher</p>}
                  {todayAtt.markedBy === 'self' && <p className="small">Marked by student</p>}
                </div>
              ) : (
                <div className="big-card muted-card">
                  <Clock size={48} />
                  <h3>Not marked yet today</h3>
                  <p className="muted">{student?.name} hasn't checked in yet.</p>
                </div>
              )}
            </div>

            <div className="summary-stats">
              <div className="stat-big green"><strong>{summary.present}</strong><span>Days Present</span></div>
              <div className="stat-big red"><strong>{summary.absent}</strong><span>Days Absent</span></div>
              <div className="stat-big blue"><strong>{summary.percentage}%</strong><span>Attendance</span></div>
            </div>

            {summary.absentDays?.length > 0 && (
              <>
                <h3>Recent Absences</h3>
                <div className="list">
                  {summary.absentDays.slice(0, 5).map((a, i) => (
                    <div key={i} className="history-row">
                      <strong>{formatDate(a.date)}</strong>
                      <span className="small muted">{a.reason}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div>
            <div className="row" style={{justifyContent: 'space-between'}}>
              <h3>Full Attendance Record</h3>
              {monthOptions.length > 0 && (
                <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)} className="sort-select">
                  <option value="">All months</option>
                  {monthOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </div>
            <div className="list">
              {filteredHistory.length === 0 && <p className="muted">No records for this period.</p>}
              {filteredHistory.map(h => (
                <div key={h._id} className="history-row">
                  <div>
                    <strong>{formatDate(h.date)}</strong>
                    {h.status === 'present' ? (
                      <span className="badge green small">
                        <CheckCircle size={12} /> Present {h.inTime && `· ${h.inTime} - ${h.outTime || '?'}`}
                      </span>
                    ) : (
                      <span className="badge red small"><XCircle size={12} /> Absent {h.reason && `· ${h.reason}`}</span>
                    )}
                  </div>
                  {h.markedBy === 'teacher' && <span className="small muted">Marked by teacher</span>}
                  {h.markedBy === 'self' && <span className="small muted">Self-marked</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'fees' && (
          <div>
            <div className="row" style={{justifyContent: 'space-between'}}>
              <h3><IndianRupee size={16} /> Fees</h3>
              <input type="month" value={feesMonth} onChange={e => setFeesMonth(e.target.value)} className="sort-select" />
            </div>
            {!fees ? <p className="muted">Loading…</p> : (
              <>
                <div className="summary-stats">
                  <div className="stat-big green"><strong>{formatRupee(fees.fees?.monthlyFee || 0)}</strong><span>This month</span></div>
                  <div className="stat-big blue"><strong>{formatRupee(Math.round(fees.fees?.perDay || 0))}</strong><span>Per working day</span></div>
                  <div className="stat-big"><strong>{fees.fees?.workingDays}/{fees.fees?.totalDays}</strong><span>Working days</span></div>
                </div>
                <div className="fee-row">
                  <div className="fee-row-left">
                    <div className="fee-row-name">{student?.name}</div>
                    <div className="fee-row-meta">
                      {fees.fees?.className && <span className="fee-pill fee-pill-class">{fees.fees.className}</span>}
                      <span className="fee-pill">{fees.fees?.workingDays || 0}/{fees.fees?.totalDays || 0} working days</span>
                    </div>
                  </div>
                  <div className="fee-row-amount">
                    <div className="fee-row-month">{formatRupee(fees.fees?.monthlyFee || 0)}</div>
                    <div className="fee-row-day">{formatRupee(Math.round(fees.fees?.perDay || 0))}/day</div>
                  </div>
                </div>
                <p className="small muted" style={{ marginTop: 12 }}>
                  Per-day fee = monthly fee ÷ working days. Holidays don't reduce the working-day count.
                </p>
              </>
            )}
          </div>
        )}

        {tab === 'announcements' && <AnnouncementList announcements={announcements} info={info} />}
        {tab === 'holidays' && <AnnouncementList announcements={announcements} info={info} />}
        {tab === 'exams' && <div><h3><BookOpen size={16} /> Exams & Tests</h3><ExamList /></div>}
        {tab === 'chat' && <ParentTeacherChat studentId={student._id} role="parent" currentName={student?.parentName || 'Parent'} />}
        {tab === 'info' && <ClassInfo info={info} student={student} />}
      </main>

      <AIAssistant chatMode={tab === 'chat'} />
    </div>
  );
}

// ============================
// SHARED: Announcement List (used by student & parent)
// ============================
function AnnouncementList({ announcements, info }) {
  return (
    <div>
      <h2 className="display">Updates from the teacher</h2>
      {announcements.length === 0 && (
        <div className="empty">
          <Megaphone size={48} color="#999" />
          <p className="muted">No announcements yet.</p>
        </div>
      )}
      <div className="list">
        {announcements.map(a => {
          const batch = findBatch(info, a.batchId);
          return (
            <div key={a._id} className="announcement-card">
              <div>
                {a.type === 'off-day' ? (
                  <span className="badge red"><CalendarOff size={12} /> Holiday</span>
                ) : (
                  <span className="badge blue"><MessageSquare size={12} /> Update</span>
                )}
                {batch && <span className="badge gray small" style={{ marginLeft: 6 }}>{batch.name}</span>}
                <p>{a.message}</p>
                {a.dates?.length > 0 && <p className="small muted">Dates: {a.dates.map(formatDate).join(', ')}</p>}
                <p className="small muted">{new Date(a.createdAt).toLocaleString()}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================
// CLASS INFO
// ============================
function ClassInfo({ info, student }) {
  const batch = student ? findBatch(info, student.batchId) : null;
  return (
    <div className="container-narrow">
      <h2 className="display">{info.classroomName || 'Coaching Center'}</h2>
      <div className="info-grid">
        {info.teacherName && <div className="info-row"><User size={18} /><span>Teacher: {info.teacherName}</span></div>}
        {info.phone && (
          <div className="info-row">
            <Phone size={18} />
            <a href={`tel:${info.phone}`}>{info.phone}</a>
            {' · '}
            <a href={whatsappLink(info.phone, 'Hello, I have a query about the coaching center.')} target="_blank" rel="noreferrer" className="wa-link">
              <MessageCircle size={14} /> WhatsApp
            </a>
          </div>
        )}
        {info.email && <div className="info-row"><Mail size={18} /><a href={`mailto:${info.email}`}>{info.email}</a></div>}
        {info.mapUrl && <div className="info-row"><MapPin size={18} /><a href={info.mapUrl} target="_blank" rel="noreferrer">View Location on Map</a></div>}
        {batch ? (
          <div className="info-row"><Layers size={18} /><span>Your batch: <strong>{batch.name}</strong> ({batch.startTime} - {batch.endTime})</span></div>
        ) : info.classStart && info.classEnd && (
          <div className="info-row"><Clock size={18} /><span>Class: {info.classStart} - {info.classEnd}</span></div>
        )}
        {info.subjects?.length > 0 && <div className="info-row"><BookOpen size={18} /><span>Subjects: {info.subjects.map(getSubjectName).filter(Boolean).join(', ')}</span></div>}
      </div>
    </div>
  );
}

// ============================
// MODAL
// ============================
function Modal({ title, children, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// AI Bot avatar — sparkle gradient circle with "AI" text
function AIAvatar({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, borderRadius: '50%' }}>
      <defs>
        <linearGradient id="aiGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0a84ff"/>
          <stop offset="1" stopColor="#bf5af2"/>
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill="url(#aiGrad)"/>
      <text x="50%" y="55%" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="700" fontFamily="system-ui,sans-serif" dominantBaseline="middle">AI</text>
      <circle cx="32" cy="10" r="3" fill="#ffd60a" opacity="0.9"/>
      <circle cx="35" cy="18" r="2" fill="#ffd60a" opacity="0.6"/>
      <circle cx="28" cy="6" r="2" fill="#ffffff" opacity="0.5"/>
    </svg>
  );
}

// ============================
// AI ASSISTANT (request #15)
// ============================
function AIAssistant({ chatMode }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notConfigured, setNotConfigured] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, open]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError('');
    const newMsgs = [...messages, { role: 'user', content: text }];
    setMessages(newMsgs);
    setInput('');
    setBusy(true);
    try {
      const r = await api.post('/ai/chat', { messages: newMsgs });
      setMessages([...newMsgs, { role: 'assistant', content: r.data.reply }]);
    } catch (err) {
      if (err.response?.data?.error === 'AI_NOT_CONFIGURED') {
        setNotConfigured(true);
      } else {
        setError(err.response?.data?.error || 'AI request failed');
      }
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button className={'ai-fab' + (chatMode ? ' chat-mode' : '')} onClick={() => setOpen(true)} title="AI Assistant" aria-label="Open AI Assistant">
        <AIAvatar size={38} />
      </button>
    );
  }

  return (
    <div className="ai-panel">
      <div className="ai-header">
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <AIAvatar size={28} />
          <strong>AI Assistant</strong>
        </div>
        <button className="icon-btn" onClick={() => setOpen(false)} style={{ color: '#fff' }}><X size={16} /></button>
      </div>
      <div className="ai-body" ref={scrollRef}>
        {notConfigured ? (
          <div className="ai-setup-card">
            <AIAvatar size={48} />
            <h3>AI not set up yet</h3>
            <p>To enable the AI assistant, add this to your hosting dashboard (e.g. Render):</p>
            <div className="setup-step"><span className="step-num">1</span> Go to your service on <strong>render.com</strong></div>
            <div className="setup-step"><span className="step-num">2</span> Click <strong>Environment</strong> in the left sidebar</div>
            <div className="setup-step"><span className="step-num">3</span> Click <strong>Add Environment Variable</strong></div>
            <div className="setup-step"><span className="step-num">4</span> Key: <code>GEMINI_API_KEY</code></div>
            <div className="setup-step"><span className="step-num">5</span> Value: your key from <a href="https://aistudio.google.com" target="_blank" rel="noreferrer">aistudio.google.com</a> (free!)</div>
            <div className="setup-step"><span className="step-num">6</span> Click <strong>Save Changes</strong> — app redeploys automatically</div>
          </div>
        ) : (
          <>
            {messages.length === 0 && (
              <div className="ai-welcome">
                <AIAvatar size={44} />
                <p>Hello! I can help with attendance, fees, schedules, or any questions. I speak Hindi, Punjabi, English — whatever you prefer.</p>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={'ai-msg-row ' + (m.role === 'user' ? 'me' : 'bot')}>
                {m.role === 'assistant' && <AIAvatar size={26} />}
                <div className={'ai-bubble ' + (m.role === 'user' ? 'me' : 'bot')}>
                  {m.content}
                </div>
              </div>
            ))}
            {busy && (
              <div className="ai-msg-row bot">
                <AIAvatar size={26} />
                <div className="ai-bubble bot ai-typing">● ● ●</div>
              </div>
            )}
            {error && <div className="error-box small">{error}</div>}
          </>
        )}
      </div>
      {!notConfigured && (
        <div className="ai-input-row">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Ask anything…"
            rows={1}
          />
          <button className="btn btn-primary" onClick={send} disabled={busy || !input.trim()}><Send size={14} /></button>
        </div>
      )}
    </div>
  );
}

function GroupChat({ role, currentName }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [profileFor, setProfileFor] = useState(null);
  const scrollRef = useRef(null);
  const lastTsRef = useRef(null);

  const fetchInitial = async () => {
    try {
      const r = await api.get('/chat/messages');
      setMessages(r.data.messages || []);
      if (r.data.messages?.length) lastTsRef.current = r.data.messages[r.data.messages.length - 1].createdAt;
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load chat');
    }
  };

  const poll = async () => {
    if (!lastTsRef.current) return;
    try {
      const r = await api.get('/chat/messages', { params: { since: lastTsRef.current } });
      if (r.data.messages?.length) {
        setMessages(m => [...m, ...r.data.messages]);
        lastTsRef.current = r.data.messages[r.data.messages.length - 1].createdAt;
      }
    } catch {}
  };

  useEffect(() => { fetchInitial(); }, []);
  useEffect(() => {
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const r = await api.post('/chat/messages', { text });
      setMessages(m => [...m, r.data.message]);
      lastTsRef.current = r.data.message.createdAt;
      setInput('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send');
    } finally { setSending(false); }
  };

  const deleteMsg = async (id) => {
    if (!confirm('Delete this message for everyone?')) return;
    try {
      await api.delete('/chat/messages/' + id);
      setMessages(m => m.filter(x => x._id !== id));
    } catch (err) {
      alert('Failed: ' + (err.response?.data?.error || err.message));
    }
  };

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <h3 style={{ margin: 0 }}><MessageCircle size={16} /> Group Chat</h3>
        <p className="small muted" style={{ margin: 0 }}>Everyone can see this. Teacher reads everything.</p>
      </div>
      <div className="chat-body" ref={scrollRef}>
        {messages.length === 0 && <p className="muted small">No messages yet. Be the first to say hi.</p>}
        {messages.map(m => {
          const mine = (role === 'teacher' && m.role === 'teacher') || (role !== 'teacher' && m.name === currentName);
          const isTeacher = m.role === 'teacher';
          const handleProfile = () => { if (!isTeacher && m.studentId) setProfileFor(m.studentId); };
          return (
            <div key={m._id} className={'chat-row ' + (mine ? 'me' : 'them')}>
              {!mine && (
                <div className="chat-avatar" onClick={handleProfile}>
                  {isTeacher
                    ? <div className="chat-avatar-teacher"><GraduationCap size={16} /></div>
                    : m.photo
                      ? <img src={m.photo} alt={m.name} />
                      : <div className="chat-avatar-default"><User size={16} /></div>}
                </div>
              )}
              <div className={'chat-msg ' + (mine ? 'me' : isTeacher ? 'teacher' : '')}>
                <div className="chat-meta">
                  <strong onClick={handleProfile}>{m.name}</strong>
                  {isTeacher && <span className="chat-tag">Teacher</span>}
                  {m.rollNumber && !mine && <span className="muted small"> #{m.rollNumber}</span>}
                  <span className="muted small chat-time">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {role === 'teacher' && (
                    <button className="btn-link small" onClick={() => deleteMsg(m._id)} style={{ marginLeft: 8, opacity: 0.5, color: '#ef4444' }} title="Delete message">
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
                <div className="chat-text">{m.text}</div>
              </div>
              {mine && (
                <div className="chat-avatar">
                  {isTeacher
                    ? <div className="chat-avatar-teacher"><GraduationCap size={16} /></div>
                    : m.photo
                      ? <img src={m.photo} alt={m.name} />
                      : <div className="chat-avatar-default"><User size={16} /></div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {error && <div className="error-box small">{error}</div>}
      <div className="chat-input-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message…"
          maxLength={1000}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending || !input.trim()}><Send size={14} /></button>
      </div>
      {profileFor && <ProfileModal studentId={profileFor} onClose={() => setProfileFor(null)} />}
    </div>
  );
}

// ----- PARENT MESSAGES (teacher inbox, request #12) -----
function ParentMessagesInbox({ onUpdate }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/parent-messages');
      setMessages(r.data.messages);
      if (onUpdate) onUpdate(r.data.unread || 0);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id) => {
    await api.post('/parent-messages/' + id + '/read');
    load();
  };

  if (loading) return <p className="muted">Loading…</p>;
  if (messages.length === 0) return <div className="empty"><Inbox size={48} color="#999" /><h3>No messages yet</h3><p className="muted">Parents will send messages here.</p></div>;

  return (
    <div className="list">
      {messages.map(m => (
        <div key={m._id} className={'msg-row' + (m.read ? '' : ' unread')}>
          <div style={{ flex: 1 }}>
            <strong>{m.studentName}'s parent</strong>
            <span className="muted small"> · {new Date(m.createdAt).toLocaleString()}</span>
            <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{m.text}</p>
          </div>
          {!m.read && <button className="btn btn-outline btn-mini" onClick={() => markRead(m._id)}>Mark read</button>}
        </div>
      ))}
    </div>
  );
}

// ----- PARENT: SEND MESSAGE TO TEACHER -----
function ParentMessageCompose() {
  const [history, setHistory] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    try {
      const r = await api.get('/parent-messages');
      setHistory(r.data.messages || []);
    } catch (err) { setError(err.response?.data?.error || 'Could not load'); }
  };

  useEffect(() => { load(); }, []);

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setError('');
    try {
      await api.post('/parent-messages', { text: t });
      setText('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send');
    } finally { setSending(false); }
  };

  return (
    <div>
      <h3><MessageSquare size={16} /> Message the Teacher</h3>
      <p className="small muted">Your message goes directly to the teacher. They'll see it on their dashboard.</p>
      <textarea
        rows={4}
        value={text}
        onChange={e => setText(e.target.value.slice(0, 2000))}
        placeholder="What would you like to tell the teacher?"
      />
      {error && <div className="error-box small">{error}</div>}
      <button className="btn btn-primary" onClick={send} disabled={!text.trim() || sending}>
        <Send size={14} /> {sending ? 'Sending…' : 'Send'}
      </button>
      <hr />
      <h3>Your sent messages</h3>
      {history.length === 0 ? <p className="muted small">You haven't sent any messages yet.</p> : (
        <div className="list">
          {history.map(m => (
            <div key={m._id} className="msg-row">
              <div style={{ flex: 1 }}>
                <span className="muted small">{new Date(m.createdAt).toLocaleString()}</span>
                <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{m.text}</p>
              </div>
              {m.read ? <span className="badge green small"><CheckCircle size={12} /> Read</span> : <span className="badge small">Unread</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- COMPLAINTS INBOX (teacher, request #16) -----
function ComplaintsInbox({ onUpdate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/complaints');
      setItems(r.data.complaints);
      if (onUpdate) onUpdate(r.data.unread || 0);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const markRead = async (id) => {
    await api.post('/complaints/' + id + '/read');
    load();
  };

  if (loading) return <p className="muted">Loading…</p>;
  if (items.length === 0) return <div className="empty"><AlertCircle size={48} color="#999" /><h3>No complaints</h3><p className="muted">Students can send private complaints here.</p></div>;

  return (
    <div className="list">
      {items.map(c => (
        <div key={c._id} className={'msg-row complaint-row' + (c.read ? '' : ' unread')}>
          <div style={{ flex: 1 }}>
            <strong>{c.studentName}</strong> <span className="muted small">(Roll {c.rollNumber}) · {new Date(c.createdAt).toLocaleString()}</span>
            <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{c.text}</p>
          </div>
          {!c.read && <button className="btn btn-outline btn-mini" onClick={() => markRead(c._id)}>Mark read</button>}
        </div>
      ))}
    </div>
  );
}

// ----- STUDENT: SEND COMPLAINT -----
function ComplaintCompose() {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true); setError('');
    try {
      await api.post('/complaints', { text: t });
      setText('');
      setSent(true);
      setTimeout(() => setSent(false), 4000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not send');
    } finally { setSending(false); }
  };

  return (
    <div>
      <h3><AlertCircle size={16} /> Talk to the Teacher (private)</h3>
      <p className="small muted">This is private — only the teacher sees what you write here. If anyone is bullying you or something feels wrong, write it down. We'll help.</p>
      <textarea
        rows={5}
        value={text}
        onChange={e => setText(e.target.value.slice(0, 5000))}
        placeholder="Tell the teacher what's going on…"
      />
      {error && <div className="error-box small">{error}</div>}
      {sent && <div className="success-box small" style={{ padding: 10 }}><CheckCircle size={16} /> Sent to the teacher.</div>}
      <button className="btn btn-primary" onClick={send} disabled={!text.trim() || sending}>
        <Send size={14} /> {sending ? 'Sending…' : 'Send privately to teacher'}
      </button>
    </div>
  );
}

// ============================
// STUDENT CHAT DASHBOARD (request #14, #16)
// ============================
function StudentChatDashboard({ student, info, announcements, onSignOut }) {
  const [tab, setTab] = useState('mark');

  return (
    <div className="page dashboard">
      <header className="dash-header">
        <div className="logo">
          <GraduationCap size={24} />
          <div>
            <h1>{info.classroomName || 'Coaching Center'}</h1>
            <p className="muted small">Signed in as {student?.name} (Roll #{student?.rollNumber})</p>
          </div>
        </div>
        <button className="btn btn-outline" onClick={onSignOut}><LogOut size={14} /> Sign out</button>
      </header>

      <OffDayBanner announcements={announcements} batchId={student?.batchId} />

      <nav className="dash-nav">
        <button className={tab === 'mark' ? 'active' : ''} onClick={() => setTab('mark')}><CheckCircle size={14} /> Mark Present</button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}><MessageCircle size={14} /> Group Chat</button>
        <button className={tab === 'exams' ? 'active' : ''} onClick={() => setTab('exams')}><BookOpen size={14} /> Exams</button>
        <button className={tab === 'holidays' ? 'active' : ''} onClick={() => setTab('holidays')}><CalendarOff size={14} /> Holidays</button>
        <button className={tab === 'ai' ? 'active' : ''} onClick={() => setTab('ai')}><Sparkles size={14} /> AI Help</button>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}><User size={14} /> My Profile</button>
      </nav>

      <main className="dash-main">
        {tab === 'mark' && <StudentMarkPresent student={student} />}
        {tab === 'chat' && <GroupChat role="student" currentName={student?.name} />}
        {tab === 'exams' && <div className="container-narrow"><h3><BookOpen size={16} /> Exams & Tests</h3><ExamList /></div>}
        {tab === 'holidays' && <div className="container-narrow"><h3><CalendarOff size={16} /> Holidays & Announcements</h3><AnnouncementList announcements={announcements || []} info={info} /></div>}
        {tab === 'ai' && (
          <div className="container-narrow">
            <h3><Sparkles size={16} /> AI Help</h3>
            <p className="small muted">Ask anything. The assistant knows about your attendance, fees, and class — but not about other students.</p>
            <AIAssistantInline />
          </div>
        )}
        {tab === 'profile' && (
          <div>
            <StudentProfilePhoto student={student} />
            <hr />
            <StudentBioEditor student={student} />
          </div>
        )}
      </main>
    </div>
  );
}

// Student marks themselves present (after roll-number login on teacher's phone)
function StudentMarkPresent({ student }) {
  const [note, setNote] = useState('');
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [todayStatus, setTodayStatus] = useState(null); // {status, inTime}

  const checkToday = async () => {
    try {
      const r = await api.get('/attendance/student/' + student._id);
      const today = new Date().toISOString().substring(0, 10);
      const todayRec = (r.data || []).find(a => a.date === today);
      if (todayRec) setTodayStatus(todayRec);
    } catch {}
  };

  useEffect(() => { checkToday(); }, []);

  const mark = async () => {
    setBusy(true); setError('');
    try {
      const r = await api.post('/attendance/self-mark', { note: note.trim() || undefined });
      setDone({ attendance: r.data });
    } catch (err) {
      setError(err.response?.data?.error || 'Could not mark present');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="container-narrow text-center" style={{ padding: '40px 20px' }}>
        <div className="big-check">✓</div>
        <h2 className="display">Marked Present!</h2>
        <p className="muted">
          {student.name}, you're checked in at {done.attendance.inTime}.
        </p>
        <p className="small muted" style={{ marginTop: 16 }}>Please hand the phone back to your teacher.</p>
      </div>
    );
  }

  if (todayStatus && todayStatus.status === 'present') {
    return (
      <div className="container-narrow text-center" style={{ padding: '40px 20px' }}>
        <div className="big-check" style={{ background: '#16a34a' }}>✓</div>
        <h2 className="display">Already Marked Today</h2>
        <p className="muted">You were checked in at {todayStatus.inTime}.</p>
      </div>
    );
  }

  return (
    <div className="container-narrow">
      <h3><CheckCircle size={18} color="#16a34a" /> Mark Yourself Present</h3>
      <p className="muted small">Tap the button below to mark your attendance for today. This is for use on the teacher's phone when you arrive at class.</p>

      {student.photo && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <img src={student.photo} alt={student.name} style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: '3px solid #0a84ff' }} />
          <h3 style={{ marginTop: 8 }}>{student.name}</h3>
          <p className="muted small">Roll #{student.rollNumber}</p>
        </div>
      )}

      <label style={{ marginTop: 20 }}>Note (optional)</label>
      <textarea
        value={note}
        onChange={e => setNote(e.target.value.slice(0, 300))}
        rows={2}
        placeholder="e.g. running late, came for makeup..."
      />

      {error && <div className="error-box">{error}</div>}

      <button className="btn btn-primary btn-block btn-lg" onClick={mark} disabled={busy} style={{ marginTop: 16 }}>
        {busy ? 'Marking...' : '✓ Mark Me Present'}
      </button>
    </div>
  );
}

// Student manages their own profile photo
function StudentProfilePhoto({ student }) {
  const [photo, setPhoto] = useState(student.photo || '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/students/me/photo', { photo });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save photo');
    } finally { setSaving(false); }
  };

  return (
    <div className="container-narrow">
      <h3><Camera size={18} /> My Photo</h3>
      <p className="small muted">Add a photo so your friends can recognize you in group chat.</p>
      <PhotoCapture value={photo} onChange={setPhoto} />
      {error && <div className="error-box">{error}</div>}
      {saved && <div className="success-box small" style={{ padding: 8 }}><CheckCircle size={14} /> Saved!</div>}
      <button className="btn btn-primary" onClick={save} disabled={saving || photo === student.photo}>
        <Save size={14} /> {saving ? 'Saving...' : 'Save Photo'}
      </button>
    </div>
  );
}

// Inline (full-page) variant of the AI assistant
function AIAssistantInline() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    const newMsgs = [...messages, { role: 'user', content: text }];
    setMessages(newMsgs);
    setInput('');
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/ai/chat', { messages: newMsgs });
      setMessages([...newMsgs, { role: 'assistant', content: r.data.reply }]);
    } catch (err) {
      setError(err.response?.data?.error || 'AI request failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="ai-inline">
      <div className="ai-body" ref={scrollRef} style={{ minHeight: 320, maxHeight: 480 }}>
        {messages.length === 0 && (
          <div className="ai-welcome">
            <AIAvatar size={40} />
            <p>Hi! Ask me anything — attendance, fees, schedule, or general help. I understand Hindi, Punjabi, and English.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'ai-msg-row ' + (m.role === 'user' ? 'me' : 'bot')}>
            {m.role === 'assistant' && <AIAvatar size={26} />}
            <div className={'ai-bubble ' + (m.role === 'user' ? 'me' : 'bot')}>{m.content}</div>
          </div>
        ))}
        {busy && (
          <div className="ai-msg-row bot">
            <AIAvatar size={26} />
            <div className="ai-bubble bot ai-typing">● ● ●</div>
          </div>
        )}
      </div>
      {error && <div className="error-box small">{error}</div>}
      <div className="ai-input-row">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type your question…"
          rows={1}
        />
        <button className="btn btn-primary" onClick={send} disabled={busy || !input.trim()}><Send size={14} /></button>
      </div>
    </div>
  );
}

// ============================
// STUDENT DETAIL MODAL (with attendance bar graph)
// ============================
function StudentDetailModal({ student, info, onClose, onEdit }) {
  const [summary, setSummary] = useState(null);
  const [history, setHistory] = useState([]);
  const [fees, setFees] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, h, f] = await Promise.all([
          api.get('/attendance/summary/' + student._id),
          api.get('/attendance/student/' + student._id),
          api.get('/fees/student/' + student._id).catch(() => ({ data: null })),
        ]);
        setSummary(s.data);
        setHistory(h.data);
        setFees(f.data);
      } finally { setLoading(false); }
    })();
  }, [student._id]);

  const batch = findBatch(info, student.batchId);
  const age = ageFromDOB(student.birthday);

  // Build last-30-days bar chart data
  const today = new Date();
  const last30 = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const iso = d.toISOString().substring(0, 10);
    const rec = history.find(h => h.date === iso);
    last30.push({
      date: iso,
      day: d.getDate(),
      status: rec ? rec.status : 'none',
      isSunday: d.getDay() === 0,
    });
  }

  return (
    <Modal onClose={onClose} title="Student Details">
      <div className="detail-modal">
        <div className="detail-top">
          {student.photo
            ? <img src={student.photo} alt={student.name} className="detail-avatar" />
            : <div className="detail-avatar placeholder"><User size={32} /></div>}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: '0 0 4px' }}>{student.name}</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Roll #{student.rollNumber}{age != null ? ` · Age ${age}` : ''}
            </p>
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn btn-outline btn-mini" onClick={onEdit}><Edit2 size={12} /> Edit</button>
              {student.parentPhone && (
                <a className="btn btn-whatsapp btn-mini" target="_blank" rel="noreferrer"
                   href={whatsappLink(student.parentPhone, `Hello, this is ${info.teacherName || 'your teacher'} about ${student.name}.`)}>
                  <MessageCircle size={12} /> WhatsApp Parent
                </a>
              )}
            </div>
          </div>
        </div>

        {loading ? <p className="muted">Loading details…</p> : (
          <>
            {/* Attendance graph (last 30 days) */}
            <div className="info-card">
              <h3><BarChart3 size={14} /> Attendance — Last 30 Days</h3>
              {summary && (
                <div className="row" style={{ gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div><strong style={{ color: '#16a34a', fontSize: 22 }}>{summary.present}</strong> <span className="muted small">days present</span></div>
                  <div><strong style={{ color: '#ef4444', fontSize: 22 }}>{summary.absent}</strong> <span className="muted small">days absent</span></div>
                  <div><strong style={{ color: '#0a84ff', fontSize: 22 }}>{summary.percentage}%</strong> <span className="muted small">attendance</span></div>
                </div>
              )}
              <div className="att-bar-chart">
                {last30.map((d, i) => (
                  <div key={i} className="att-bar-wrap" title={`${d.date}: ${d.status}`}>
                    <div className={'att-bar att-bar-' + d.status + (d.isSunday ? ' sunday' : '')}>
                      <span className="att-bar-day">{d.day}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="att-legend">
                <span className="att-legend-item"><span className="att-dot att-bar-present" /> Present</span>
                <span className="att-legend-item"><span className="att-dot att-bar-absent" /> Absent</span>
                <span className="att-legend-item"><span className="att-dot att-bar-none" /> Not marked</span>
                <span className="att-legend-item"><span className="att-dot att-bar-none sunday" /> Sunday (off)</span>
              </div>
            </div>

            {/* Personal info */}
            <div className="info-card">
              <h3>Personal Info</h3>
              <dl className="info-dl">
                {student.phone && <><dt>Phone</dt><dd>{student.phone}</dd></>}
                {student.birthday && <><dt>Date of Birth</dt><dd>{student.birthday}{age != null ? ` (Age ${age})` : ''}</dd></>}
                {student.aadhar && <><dt>Aadhar</dt><dd>{student.aadhar}</dd></>}
                {student.parentName && <><dt>Parent Name</dt><dd>{student.parentName}</dd></>}
                {student.parentPhone && <><dt>Parent Phone</dt><dd>{student.parentPhone}</dd></>}
                {student.parentCode && <><dt>Parent Code</dt><dd><code className="inline-code">{student.parentCode}</code></dd></>}
                {student.className && <><dt>Class</dt><dd>{student.className}</dd></>}
                {batch && <><dt>Batch</dt><dd>{batch.name} ({batch.startTime}-{batch.endTime})</dd></>}
                {student.subjects?.length > 0 && <><dt>Subjects</dt><dd>{student.subjects.join(', ')}</dd></>}
                {student.enrollmentDate && <><dt>Enrolled</dt><dd>{student.enrollmentDate}</dd></>}
                {student.notes && <><dt>Notes</dt><dd>{student.notes}</dd></>}
              </dl>
            </div>

            {/* Fees */}
            {fees?.fees && (
              <div className="info-card">
                <h3><IndianRupee size={14} /> Fees ({fees.fees.year}-{String(fees.fees.month).padStart(2, '0')})</h3>
                <dl className="info-dl">
                  <dt>Monthly Fee</dt><dd>{formatRupee(fees.fees.monthlyFee || 0)}</dd>
                  <dt>Working Days</dt><dd>{fees.fees.workingDays} of {fees.fees.totalDays}</dd>
                  <dt>Per Working Day</dt><dd>{formatRupee(Math.round(fees.fees.perDay || 0))}</dd>
                </dl>
                {(!fees.fees.monthlyFee) && <p className="small muted">No fee set — edit the student to add one.</p>}
              </div>
            )}

            {/* Attendance history */}
            <div className="info-card">
              <h3>Recent Attendance ({history.length})</h3>
              {history.length === 0 ? <p className="muted small">No records yet.</p> : (
                <div className="list" style={{ maxHeight: 280, overflowY: 'auto' }}>
                  {history.slice(0, 50).map(h => (
                    <div key={h._id} className="history-row">
                      <div>
                        <strong>{formatDate(h.date)}</strong>
                        {h.status === 'present' ? (
                          <span className="badge green small"><CheckCircle size={12} /> Present {h.inTime && `· ${h.inTime}`}</span>
                        ) : (
                          <span className="badge red small"><XCircle size={12} /> Absent {h.reason && `· ${h.reason}`}</span>
                        )}
                        {h.note && <p className="small muted" style={{ marginTop: 4 }}>"{h.note}"</p>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ============================
// v6: PROFILE MODAL, FEES, EXAMS, PARENT CHAT
// ============================

// Fullscreen photo viewer
function PhotoViewer({ src, onClose }) {
  if (!src) return null;
  return (
    <div className="photo-viewer" onClick={onClose}>
      <img src={src} alt="" />
    </div>
  );
}

// Profile modal - shown when tapping student name/avatar in chat or anywhere
function ProfileModal({ studentId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [err, setErr] = useState('');
  const [showPhoto, setShowPhoto] = useState(false);

  useEffect(() => {
    api.get('/students/' + studentId + '/profile')
      .then(r => setProfile(r.data))
      .catch(e => setErr(e.response?.data?.error || 'Could not load profile'));
  }, [studentId]);

  if (!studentId) return null;

  return (
    <Modal onClose={onClose} title="">
      {err && <div className="error-box">{err}</div>}
      {!profile && !err && <p className="muted">Loading…</p>}
      {profile && (
        <div className="profile-modal-content">
          {profile.photo ? (
            <img
              src={profile.photo}
              alt={profile.name}
              className="profile-modal-photo"
              onClick={() => setShowPhoto(true)}
            />
          ) : (
            <div className="profile-modal-photo placeholder"><User size={48} /></div>
          )}
          <h2 className="display" style={{ margin: 0 }}>{profile.name}</h2>
          <p className="muted small">Roll #{profile.rollNumber}{profile.className ? ' · ' + profile.className : ''}</p>
          {profile.batch && (
            <p className="profile-meta">
              <Clock size={14} /> Batch <strong>{profile.batch.name}</strong> · {profile.batch.startTime}–{profile.batch.endTime}
            </p>
          )}
          {profile.bio && <div className="profile-modal-bio">{profile.bio}</div>}
          {profile.instagram && (
            <a
              href={profile.instagram.startsWith('http') ? profile.instagram : ('https://instagram.com/' + profile.instagram.replace('@', ''))}
              target="_blank" rel="noreferrer"
              className="profile-insta"
            >
              📸 Instagram
            </a>
          )}
        </div>
      )}
      {showPhoto && profile?.photo && <PhotoViewer src={profile.photo} onClose={() => setShowPhoto(false)} />}
    </Modal>
  );
}

// Student edits their own bio/Instagram
function StudentBioEditor({ student }) {
  const [bio, setBio] = useState(student.bio || '');
  const [insta, setInsta] = useState(student.instagram || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  const save = async () => {
    setSaving(true); setErr('');
    try {
      await api.put('/students/me', { bio, instagram: insta });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setErr(e.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  return (
    <div className="container-narrow">
      <h3>My Bio</h3>
      <p className="small muted">This shows on your profile when classmates tap your name in chat.</p>
      <label>About me</label>
      <textarea
        rows={4}
        value={bio}
        onChange={e => setBio(e.target.value.slice(0, 500))}
        placeholder="Tell everyone about yourself…"
      />
      <p className="small muted text-right">{bio.length}/500</p>

      <label>Instagram (optional)</label>
      <input
        value={insta}
        onChange={e => setInsta(e.target.value)}
        placeholder="@yourhandle or full URL"
      />

      {err && <div className="error-box">{err}</div>}
      {saved && <div className="success-box small" style={{ padding: 8 }}><CheckCircle size={14} /> Saved!</div>}
      <button className="btn btn-primary" onClick={save} disabled={saving}>
        <Save size={14} /> {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

// Pending fees tab for teacher
function PendingFeesTab() {
  const [month, setMonth] = useState(new Date().toISOString().substring(0, 7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [marking, setMarking] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/fees/pending', { params: { month } });
      setData(r.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month]);

  const markPaid = async (s) => {
    setMarking(s._id);
    try {
      await api.post('/fees/mark-paid', { studentId: s._id, month, amount: s.monthlyFee });
      await load();
    } catch (e) {
      alert('Failed: ' + (e.response?.data?.error || e.message));
    } finally { setMarking(null); }
  };

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="row">
        <label style={{ margin: 0 }}>Month:</label>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="sort-select" />
        <button className="btn btn-outline btn-mini" onClick={load}><RefreshCw size={12} /></button>
      </div>

      <div className="summary-stats">
        <div className="stat-big green"><strong>{data?.totalPaid || 0}</strong><span>Paid</span></div>
        <div className="stat-big red"><strong>{data?.totalPending || 0}</strong><span>Pending</span></div>
      </div>

      {data?.pending?.length === 0 ? (
        <div className="empty"><CheckCircle size={48} color="#16a34a" /><h3>All fees collected!</h3><p className="muted">Everyone has paid this month.</p></div>
      ) : (
        <div className="pending-fees-list">
          {data?.pending?.map(s => (
            <div key={s._id} className={'pending-fee-row' + (s.overdue ? ' overdue' : '')}>
              <div className="row" style={{ gap: 12, alignItems: 'center', flex: 1 }}>
                {s.photo ? <img src={s.photo} alt="" className="student-avatar" /> : <div className="student-avatar placeholder"><User size={20} /></div>}
                <div>
                  <strong>{s.name}</strong>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    Roll #{s.rollNumber} · {formatRupee(s.monthlyFee)} · Due day {s.dueDay}
                    {s.overdue && <span className="badge red small" style={{ marginLeft: 8 }}>OVERDUE</span>}
                  </p>
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                {s.parentPhone && (
                  <a className="btn btn-whatsapp btn-mini" target="_blank" rel="noreferrer"
                    href={whatsappLink(s.parentPhone, `Hi, this is a reminder that ${s.name}'s fee of ${formatRupee(s.monthlyFee)} for ${month} is pending. Please pay at your earliest convenience.`)}>
                    <MessageCircle size={12} /> Remind
                  </a>
                )}
                <button className="btn btn-green btn-mini" onClick={() => markPaid(s)} disabled={marking === s._id}>
                  <Check size={12} /> {marking === s._id ? '…' : 'Mark Paid'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Exams tab — teacher creates, sends to selected students
function ExamsTab() {
  const [exams, setExams] = useState([]);
  const [students, setStudents] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', examDate: '', studentIds: [] });
  const [allSelected, setAllSelected] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    const [e, s] = await Promise.all([api.get('/exams'), api.get('/students')]);
    setExams(e.data.exams || []);
    setStudents(s.data || []);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setErr(''); setSaving(true);
    try {
      await api.post('/exams', {
        ...form,
        studentIds: allSelected ? [] : form.studentIds, // empty = all
      });
      setShowForm(false);
      setForm({ title: '', description: '', examDate: '', studentIds: [] });
      setAllSelected(true);
      load();
    } catch (e) { setErr(e.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  const del = async (id) => {
    if (!confirm('Delete this exam?')) return;
    await api.delete('/exams/' + id);
    load();
  };

  const toggleStudent = (id) => {
    setForm(f => ({
      ...f,
      studentIds: f.studentIds.includes(id) ? f.studentIds.filter(x => x !== id) : [...f.studentIds, id]
    }));
  };

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3><BookOpen size={16} /> Exams & Tests</h3>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}><Plus size={14} /> New Exam</button>
      </div>

      {exams.length === 0 ? (
        <p className="muted small">No exams yet. Create one to notify students.</p>
      ) : (
        <div className="list">
          {exams.map(e => (
            <div key={e._id} className="student-card">
              <div style={{ flex: 1 }}>
                <strong>{e.title}</strong>
                {e.examDate && <span className="badge small" style={{ marginLeft: 8 }}>{e.examDate}</span>}
                {e.description && <p className="small" style={{ marginTop: 4 }}>{e.description}</p>}
                <p className="small muted">
                  Sent to {e.studentIds?.length ? `${e.studentIds.length} selected student(s)` : 'all students'} ·{' '}
                  {new Date(e.createdAt).toLocaleString()}
                </p>
              </div>
              <button className="icon-btn icon-btn-danger" onClick={() => del(e._id)}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal onClose={() => setShowForm(false)} title="New Exam / Test">
          <label>Title *</label>
          <input value={form.title} onChange={ev => setForm({ ...form, title: ev.target.value })} placeholder="e.g. Math Class Test" />
          <label>Date</label>
          <input type="date" value={form.examDate} onChange={ev => setForm({ ...form, examDate: ev.target.value })} />
          <label>Description</label>
          <textarea rows={3} value={form.description} onChange={ev => setForm({ ...form, description: ev.target.value })} placeholder="Syllabus, topics, instructions…" />

          <label>Send to</label>
          <div className="row">
            <label className="checkbox-label">
              <input type="checkbox" checked={allSelected} onChange={ev => setAllSelected(ev.target.checked)} />
              <span>All students</span>
            </label>
          </div>
          {!allSelected && (
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #e5e7eb', borderRadius: 8, padding: 8 }}>
              {students.map(s => (
                <label key={s._id} className="checkbox-label" style={{ display: 'block' }}>
                  <input type="checkbox" checked={form.studentIds.includes(s._id)} onChange={() => toggleStudent(s._id)} />
                  <span>{s.name} (Roll #{s.rollNumber})</span>
                </label>
              ))}
            </div>
          )}

          {err && <div className="error-box">{err}</div>}
          <button className="btn btn-primary btn-block" onClick={save} disabled={saving || !form.title}>
            <Send size={14} /> {saving ? 'Sending…' : 'Send to Students'}
          </button>
        </Modal>
      )}
    </div>
  );
}

// Student/parent: see their exam list
function ExamList() {
  const [exams, setExams] = useState([]);
  useEffect(() => { api.get('/exams').then(r => setExams(r.data.exams || [])).catch(() => {}); }, []);
  if (exams.length === 0) return <p className="muted small">No upcoming exams.</p>;
  return (
    <div className="list">
      {exams.map(e => (
        <div key={e._id} className="student-card">
          <div style={{ flex: 1 }}>
            <strong>{e.title}</strong>
            {e.examDate && <span className="badge small" style={{ marginLeft: 8 }}>{e.examDate}</span>}
            {e.description && <p className="small" style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{e.description}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Parent ↔ Teacher chat (WhatsApp-style two-way)
function ParentTeacherChat({ studentId, role, currentName }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);

  const load = async () => {
    try {
      const r = await api.get('/parent-chat/' + studentId);
      setMessages(r.data.messages || []);
    } catch (e) {}
  };

  useEffect(() => { load(); }, [studentId]);
  useEffect(() => {
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [studentId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // teacher: mark all as read on open
  useEffect(() => {
    if (role === 'teacher') {
      api.post('/parent-chat/' + studentId + '/mark-read').catch(() => {});
    }
  }, [studentId, role]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const body = role === 'teacher' ? { text, studentId } : { text };
      const r = await api.post('/parent-chat/send', body);
      setMessages(m => [...m, r.data.message]);
      setInput('');
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to send');
    } finally { setSending(false); }
  };

  const deleteMsg = async (id) => {
    const isTeacher = role === 'teacher';
    if (!confirm(isTeacher ? 'Delete this message for everyone?' : 'Delete this message for yourself? (The other person will still see it.)')) return;
    if (isTeacher) {
      await api.delete('/parent-chat/' + id + '/hard-delete');
      setMessages(m => m.filter(x => x._id !== id));
    } else {
      await api.post('/parent-chat/' + id + '/delete');
      setMessages(m => m.filter(x => x._id !== id));
    }
  };

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <h3 style={{ margin: 0 }}><MessageCircle size={16} /> Chat with {role === 'teacher' ? 'Parent' : 'Teacher'}</h3>
        <p className="small muted" style={{ margin: 0 }}>Private 1-on-1 conversation. Delete only removes from your side.</p>
      </div>
      <div className="chat-body" ref={scrollRef}>
        {messages.length === 0 && <p className="muted small">No messages yet. Say hi.</p>}
        {messages.map(m => {
          const mine = (role === 'teacher' && m.from === 'teacher') || (role === 'parent' && m.from === 'parent');
          return (
            <div key={m._id} className={'chat-row ' + (mine ? 'me' : 'them')}>
              <div className={'chat-msg ' + (mine ? 'me' : '')}>
                <div className="chat-meta">
                  <strong>{m.from === 'teacher' ? 'Teacher' : (m.studentName + "'s parent")}</strong>
                  <span className="muted small chat-time">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="chat-text">{m.text}</div>
                {(mine || role === 'teacher') && (
                  <button className="btn-link small" onClick={() => deleteMsg(m._id)} style={{ marginTop: 2, opacity: 0.6 }}>
                    <Trash2 size={10} /> {role === 'teacher' && !mine ? 'delete' : 'delete'}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message…"
          maxLength={2000}
        />
        <button className="btn btn-primary" onClick={send} disabled={sending || !input.trim()}><Send size={14} /></button>
      </div>
    </div>
  );
}

// Teacher: list of parent conversations
function ParentConversationsList({ onSelect }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/parent-chat-list');
      setList(r.data.conversations || []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, []);

  if (loading) return <p className="muted">Loading…</p>;
  if (list.length === 0) return <div className="empty"><Inbox size={48} color="#999" /><h3>No conversations yet</h3><p className="muted">When a parent messages you, it'll appear here.</p></div>;

  return (
    <div className="parent-conv-list">
      {list.map(c => (
        <div key={c._id} className="parent-conv" onClick={() => onSelect(c.student)}>
          {c.student?.photo ? <img src={c.student.photo} className="parent-conv-avatar" alt="" /> : <div className="parent-conv-avatar" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>{c.student?.name}</strong>{c.student?.rollNumber ? <span className="muted small"> · Roll {c.student.rollNumber}</span> : null}
            <p className="parent-conv-preview">{c.lastFrom === 'teacher' ? 'You: ' : ''}{c.lastMessage}</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <p className="muted small" style={{ margin: 0 }}>{new Date(c.lastAt).toLocaleDateString()}</p>
            {c.unread > 0 && <span className="parent-conv-badge">{c.unread}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Wrapper for teacher's parent-chat tab
function ParentChatTab() {
  const [selected, setSelected] = useState(null);
  if (selected) {
    return (
      <div>
        <button className="btn btn-outline btn-mini" onClick={() => setSelected(null)}><ArrowLeft size={12} /> Back to list</button>
        <ParentTeacherChat studentId={selected._id} role="teacher" currentName="Teacher" />
      </div>
    );
  }
  return <ParentConversationsList onSelect={setSelected} />;
}

// Teacher Fees tab: switches between "Overview", "Pending", and "Paid"
function TeacherFeesTab({ info }) {
  const [sub, setSub] = useState('overview');
  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 12 }}>
        <button className={'btn btn-mini ' + (sub === 'overview' ? 'btn-primary' : 'btn-outline')} onClick={() => setSub('overview')}>Overview</button>
        <button className={'btn btn-mini ' + (sub === 'pending' ? 'btn-primary' : 'btn-outline')} onClick={() => setSub('pending')}><AlertCircle size={12} /> Pending</button>
        <button className={'btn btn-mini ' + (sub === 'paid' ? 'btn-primary' : 'btn-outline')} onClick={() => setSub('paid')}><CheckCircle size={12} /> Paid</button>
      </div>
      {sub === 'overview' && <FeesTab info={info} />}
      {sub === 'pending' && <PendingFeesTab />}
      {sub === 'paid' && <PaidFeesTab />}
    </div>
  );
}

// Shows who has paid fees this month
function PaidFeesTab() {
  const [month, setMonth] = useState(new Date().toISOString().substring(0, 7));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/fees/paid', { params: { month } });
      setData(r.data);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [month]);

  if (loading) return <p className="muted">Loading…</p>;

  const totalCollected = (data?.paid || []).reduce((a, s) => a + (s.paidAmount || s.monthlyFee || 0), 0);

  return (
    <div>
      <div className="row">
        <label style={{ margin: 0 }}>Month:</label>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="sort-select" />
        <button className="btn btn-outline btn-mini" onClick={load}><RefreshCw size={12} /></button>
      </div>

      <div className="summary-stats">
        <div className="stat-big green"><strong>{data?.totalPaid || 0}</strong><span>Paid</span></div>
        <div className="stat-big blue"><strong>{formatRupee(totalCollected)}</strong><span>Collected</span></div>
      </div>

      {(!data?.paid?.length) ? (
        <div className="empty"><IndianRupee size={48} color="#999" /><h3>No payments yet</h3><p className="muted">No one has been marked as paid for {month}.</p></div>
      ) : (
        <div className="pending-fees-list">
          {data.paid.map(s => (
            <div key={s._id} className="pending-fee-row" style={{ borderLeft: '4px solid #16a34a' }}>
              <div className="row" style={{ gap: 12, alignItems: 'center', flex: 1 }}>
                {s.photo ? <img src={s.photo} alt="" className="student-avatar" /> : <div className="student-avatar placeholder"><User size={20} /></div>}
                <div>
                  <strong>{s.name}</strong>
                  <p className="small muted" style={{ margin: '2px 0 0' }}>
                    Roll #{s.rollNumber} · {formatRupee(s.paidAmount || s.monthlyFee || 0)}
                    {s.paidOn && <span> · Paid {new Date(s.paidOn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                    {s.note && <span> · "{s.note}"</span>}
                  </p>
                </div>
              </div>
              <span className="badge green"><CheckCircle size={12} /> Paid</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Parent-side fees reminder shown 5 days before due / when overdue
function FeesReminderBanner() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    api.get('/fees/my-status').then(r => setStatus(r.data)).catch(() => {});
  }, []);
  if (!status || !status.hasFee || status.paid || !status.showReminder) return null;
  return (
    <div className={'fees-pending-banner' + (status.overdue ? ' fees-overdue-banner' : '')}>
      <Wallet size={20} />
      <div style={{ flex: 1 }}>
        <strong>
          {status.overdue
            ? `Fee payment is overdue!`
            : (status.daysUntilDue <= 0
                ? `Fee is due today`
                : `Fee due in ${status.daysUntilDue} day${status.daysUntilDue === 1 ? '' : 's'}`)}
        </strong>
        <p className="small" style={{ margin: '2px 0 0' }}>
          {formatRupee(status.amount)} for {status.month} · due on day {status.dueDay} of the month
        </p>
      </div>
    </div>
  );
}
