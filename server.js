import express from 'express';
import compression from 'compression';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Kolkata';
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-env';

app.use(compression()); // gzip all responses — big speed win on slow connections
app.use(cors());
app.use(express.json({ limit: '8mb' })); // base64 voice notes (~1MB) + images need more than the 100KB default

// ===========================
// TIMEZONE HELPERS (fix wrong check-in/out times)
// ===========================
const istDateISO = () => {
  // Returns YYYY-MM-DD in the configured timezone
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
};

const istTimeHM = () => {
  // Returns HH:MM in the configured timezone (24h)
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date());
};

// ===========================
// MongoDB
// ===========================
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/coaching')
  .then(() => console.log('✓ MongoDB connected'))
  .catch(err => console.error('MongoDB error:', err));

// ===========================
// SCHEMAS
// ===========================

// Subjects are just names now. Fees live on the class.
const SubjectSchema = new mongoose.Schema({
  name: { type: String, required: true },
}, { _id: false });

// A class (8th, 10th, etc) carries the monthly fee.
const ClassSchema = new mongoose.Schema({
  name: { type: String, required: true },
  monthlyFee: { type: Number, default: 0 },
});

// A batch is a group of students that meets at a specific time.
// weeklyOffDays is an array of weekday numbers (0=Sun, 1=Mon, ... 6=Sat).
const BatchSchema = new mongoose.Schema({
  name: { type: String, required: true },
  startTime: { type: String, default: '09:00' },
  endTime:   { type: String, default: '11:00' },
  weeklyOffDays: { type: [Number], default: [0] }, // Sunday only by default
});

const ConfigSchema = new mongoose.Schema({
  teacherPassword: String,
  teacherName: String,
  teacherPhoto: String,  // base64 profile photo for teacher
  teacherBio: { type: String, default: '' },
  teacherBioVisibility: { type: String, enum: ['everyone', 'landing', 'chat', 'none'], default: 'everyone' },
  phone: String,
  email: String,
  classroomName: String,
  mapUrl: String,
  classStart: String,
  classEnd: String,
  // Subjects are just names; fees attach to classes.
  subjects: { type: [SubjectSchema], default: [] },
  classes:  { type: [ClassSchema],   default: [] },
  batches:  { type: [BatchSchema],   default: [] },
});

const StudentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rollNumber: { type: String, index: true },
  phone: String,
  email: String,
  parentName: String,    // father / primary guardian
  motherName: String,    // mother / second guardian
  parentPhone: String,
  aadhar: String,
  birthday: String,
  photo: String, // base64 data URL
  subjects: { type: [String], default: [] },
  className: { type: String, default: '' },
  monthlyFee: { type: Number, default: 0 },
  feeDueDay: { type: Number, default: 5 },    // day of month when fee is due (1-28)
  batchId: { type: String, default: '' },
  parentCode: { type: String, index: true },
  bio: { type: String, default: '' },         // student's own bio (visible on profile)
  instagram: { type: String, default: '' },   // optional Instagram URL/handle
  notes: String,
  joinDate: { type: Date, default: Date.now },
  enrollmentDate: { type: String, default: () => istDateISO() },
  registeredVia: { type: String, enum: ['teacher', 'self'], default: 'teacher' },
  pendingApproval: { type: Boolean, default: false },
});

// Fee payments tracker (one record per student per month)
const FeePaymentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  month: { type: String, required: true }, // YYYY-MM
  paidOn: { type: Date, default: Date.now },
  amount: Number,
  note: String,
});
FeePaymentSchema.index({ studentId: 1, month: 1 }, { unique: true });

// Exam / Test announcements (sent to selected students)
// sentVia / readBy are additive — old exams without these fields stay valid.
const ExamSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  examDate: String, // YYYY-MM-DD
  studentIds: [{ type: mongoose.Schema.Types.ObjectId }], // empty = all students
  // Tracks WhatsApp / channel deliveries the teacher has confirmed for each student.
  sentVia: {
    type: [{
      studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
      channel:   { type: String, default: 'whatsapp' },
      sentAt:    { type: Date, default: Date.now },
    }],
    default: [],
  },
  // Tracks students/parents who have opened this exam in the app.
  readBy: {
    type: [{
      studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
      readAt:    { type: Date, default: Date.now },
    }],
    default: [],
  },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
});

const AttendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  date: { type: String, required: true },
  status: { type: String, enum: ['present', 'absent'], default: 'present' },
  inTime: String,
  outTime: String,
  markedBy: { type: String, enum: ['self', 'teacher'], default: 'self' },
  reason: String,
  note: String, // optional note left by the student when self-marking
});
AttendanceSchema.index({ studentId: 1, date: 1 }, { unique: true });

const AnnouncementSchema = new mongoose.Schema({
  message: String,
  type: { type: String, enum: ['general', 'off-day'], default: 'general' },
  dates: { type: [String], default: [] },
  batchId: { type: String, default: '' }, // '' = applies to all batches
  createdAt: { type: Date, default: Date.now },
});

// v4: parent → teacher inbox (now two-way chat)
const ParentMessageSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  studentName: String,
  text: { type: String, required: true },
  from: { type: String, enum: ['parent', 'teacher'], default: 'parent' },
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
  deletedBy: {
    teacher: { type: Boolean, default: false },
    parent: { type: Boolean, default: false },
  },
});

// v4: student → teacher complaint (private)
const ComplaintSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, required: true },
  studentName: String,
  rollNumber: String,
  text: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false },
});

// v4: group chat (all students + teacher)
const ChatMessageSchema = new mongoose.Schema({
  role: { type: String, enum: ['student', 'teacher'], required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId },
  name: { type: String, required: true },
  rollNumber: String,
  photo: String,
  text: { type: String, default: '' },
  messageType: { type: String, enum: ['text', 'image', 'location', 'audio', 'contact'], default: 'text' },
  image: String,
  audio: String, // base64 webm audio (max ~30s)
  locationData: { lat: Number, lng: Number, address: String, isLive: Boolean },
  contactData: { name: String, phone: String },
  createdAt: { type: Date, default: Date.now, index: true },
});

const Config = mongoose.model('Config', ConfigSchema);
const Student = mongoose.model('Student', StudentSchema);
const Attendance = mongoose.model('Attendance', AttendanceSchema);
const Announcement = mongoose.model('Announcement', AnnouncementSchema);
const ParentMessage = mongoose.model('ParentMessage', ParentMessageSchema);
const Complaint = mongoose.model('Complaint', ComplaintSchema);
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);
const FeePayment = mongoose.model('FeePayment', FeePaymentSchema);
const Exam = mongoose.model('Exam', ExamSchema);

// ===========================
// ID + CODE HELPERS
// ===========================
// Friendlier code: 3 letters from student name + 3 digits from parent phone
// e.g. "Ankit" + "9876543210" => "ANK210"
// Falls back gracefully when name is too short or phone is missing.
const generateParentCode = (studentName, parentPhone) => {
  const lettersRaw = (studentName || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  let letters = lettersRaw.slice(0, 3);
  while (letters.length < 3) {
    letters += String.fromCharCode(65 + crypto.randomInt(0, 26));
  }
  const digitsRaw = (parentPhone || '').replace(/\D/g, '');
  let digits = digitsRaw.slice(-3);
  while (digits.length < 3) {
    digits += String(crypto.randomInt(0, 10));
  }
  return letters + digits;
};

const ensureUniqueParentCode = async (studentName, parentPhone) => {
  for (let i = 0; i < 30; i++) {
    const code = generateParentCode(studentName, parentPhone);
    const exists = await Student.findOne({ parentCode: code });
    if (!exists) return code;
  }
  // very unlikely fallback
  return generateParentCode(studentName, parentPhone) + crypto.randomInt(10, 99);
};

// Verhoeff checksum (UIDAI's algorithm) — catches typos and fake Aadhar numbers.
const VERHOEFF_D = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,2,3,4,0,6,7,8,9,5],
  [2,3,4,0,1,7,8,9,5,6],
  [3,4,0,1,2,8,9,5,6,7],
  [4,0,1,2,3,9,5,6,7,8],
  [5,9,8,7,6,0,4,3,2,1],
  [6,5,9,8,7,1,0,4,3,2],
  [7,6,5,9,8,2,1,0,4,3],
  [8,7,6,5,9,3,2,1,0,4],
  [9,8,7,6,5,4,3,2,1,0],
];
const VERHOEFF_P = [
  [0,1,2,3,4,5,6,7,8,9],
  [1,5,7,6,2,8,3,0,9,4],
  [5,8,0,3,7,9,6,1,4,2],
  [8,9,1,6,0,4,3,5,2,7],
  [9,4,5,3,1,2,6,8,7,0],
  [4,2,8,6,5,7,3,9,0,1],
  [2,7,9,3,8,0,6,4,1,5],
  [7,0,4,6,9,1,3,2,5,8],
];
const isValidAadhar = (s) => {
  const d = (s || '').replace(/\s/g, '');
  if (!/^\d{12}$/.test(d)) return false;
  let c = 0;
  const rev = d.split('').reverse();
  for (let i = 0; i < rev.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][parseInt(rev[i], 10)]];
  }
  return c === 0;
};

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

// ===========================
// MIDDLEWARE
// ===========================
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const teacherOnly = (req, res, next) => {
  if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  next();
};

// A "parent" or "student" token is scoped to a single studentId.
const parentScopeCheck = (req, studentId) => {
  if (req.user.role === 'parent' || req.user.role === 'student') {
    if (!req.user.studentId || String(req.user.studentId) !== String(studentId)) {
      return false;
    }
  }
  return true;
};

// ===========================
// AUTH ROUTES
// ===========================

app.get('/api/auth/check-setup', async (req, res) => {
  try {
    const config = await Config.findOne();
    res.json({ setupDone: !!config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/setup', async (req, res) => {
  try {
    const existing = await Config.findOne();
    if (existing) return res.status(400).json({ error: 'Already set up' });
    const { teacherPassword, subjects, classes, ...rest } = req.body;
    const normSubjects = (subjects || []).map(s => typeof s === 'string' ? { name: s } : { name: s.name });
    const normClasses = (classes || []).map(c =>
      typeof c === 'string' ? { name: c, monthlyFee: 0 } : { name: c.name, monthlyFee: Number(c.monthlyFee) || 0 }
    );
    const config = new Config({
      teacherPassword: await bcrypt.hash(teacherPassword, 10),
      subjects: normSubjects,
      classes: normClasses,
      ...rest,
    });
    await config.save();
    const token = jwt.sign({ role: 'teacher' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, role: 'teacher' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unified login: teacher password → parent code → student roll number.
// One field, the server figures out which it is.
app.post('/api/auth/login', async (req, res) => {
  try {
    const raw = (req.body.password || '').trim();
    if (!raw) return res.status(401).json({ error: 'Enter your password, parent code, or roll number' });
    const config = await Config.findOne();
    if (!config) return res.status(401).json({ error: 'System not set up' });

    // 1) Try as teacher password
    if (config.teacherPassword) {
      const isT = await bcrypt.compare(raw, config.teacherPassword);
      if (isT) {
        const token = jwt.sign({ role: 'teacher' }, JWT_SECRET, { expiresIn: '30d' });
        return res.json({ token, role: 'teacher' });
      }
    }

    // 2) Try as parent code (e.g. K7842M — letter+4digits+letter)
    const code = raw.toUpperCase();
    const parentStudent = await Student.findOne({ parentCode: code, pendingApproval: { $ne: true } });
    if (parentStudent) {
      const token = jwt.sign({ role: 'parent', studentId: String(parentStudent._id) }, JWT_SECRET, { expiresIn: '365d' });
      return res.json({ token, role: 'parent', student: parentStudent });
    }

    // 3) Try as student roll number (just digits, e.g. "003" or "3")
    if (/^\d+$/.test(raw)) {
      const padded = raw.padStart(3, '0');
      const rollStudent = await Student.findOne({
        $or: [{ rollNumber: raw }, { rollNumber: padded }],
        pendingApproval: { $ne: true }
      });
      if (rollStudent) {
        const token = jwt.sign({ role: 'student', studentId: String(rollStudent._id) }, JWT_SECRET, { expiresIn: '30d' });
        return res.json({
          token, role: 'student',
          student: { _id: rollStudent._id, name: rollStudent.name, rollNumber: rollStudent.rollNumber, className: rollStudent.className, photo: rollStudent.photo }
        });
      }
    }

    return res.status(401).json({ error: 'Wrong password, parent code, or roll number' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy/standalone parent-login kept for backwards compat
app.post('/api/auth/parent-login', async (req, res) => {
  try {
    const code = (req.body.code || '').trim().toUpperCase();
    if (!code) return res.status(401).json({ error: 'Code required' });
    const student = await Student.findOne({ parentCode: code, pendingApproval: { $ne: true } });
    if (!student) return res.status(401).json({ error: 'Invalid code' });
    const token = jwt.sign({ role: 'parent', studentId: String(student._id) }, JWT_SECRET, { expiresIn: '365d' });
    res.json({ token, role: 'parent', student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student chat login: roll number only (for chat + complaint access, request #14, #16)
app.post('/api/auth/student-login', async (req, res) => {
  try {
    const roll = (req.body.rollNumber || '').trim();
    if (!roll) return res.status(401).json({ error: 'Roll number required' });
    const student = await Student.findOne({ rollNumber: roll, pendingApproval: { $ne: true } });
    if (!student) return res.status(401).json({ error: 'Roll number not found (or not yet approved)' });
    const token = jwt.sign({ role: 'student', studentId: String(student._id) }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, role: 'student', student: { _id: student._id, name: student.name, rollNumber: student.rollNumber, className: student.className } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// PUBLIC ROUTES
// ===========================

app.get('/api/public/info', async (req, res) => {
  try {
    const config = await Config.findOne().select('-teacherPassword');
    res.json(config || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/public/register', async (req, res) => {
  try {
    const { name, phone, parentName, parentPhone, aadhar, birthday, subjects, className, batchId, notes, photo } = req.body;
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });

    // Reject duplicate phone numbers (request #6)
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (cleanPhone) {
      const dupe = await Student.findOne({ phone: { $regex: cleanPhone + '$' } });
      if (dupe) return res.status(409).json({ error: 'A student with this phone number is already registered.' });
    }

    // Validate Aadhar if provided (request #4)
    if (aadhar && !isValidAadhar(aadhar)) {
      return res.status(400).json({ error: 'Aadhar number is invalid. Please check the 12 digits.' });
    }

    // Generate a unique roll number
    let rollNumber = '';
    {
      const count = await Student.countDocuments();
      let n = count + 1;
      while (true) {
        const candidate = String(n).padStart(3, '0');
        const exists = await Student.findOne({ rollNumber: candidate });
        if (!exists) { rollNumber = candidate; break; }
        n++;
      }
    }
    const parentCode = await ensureUniqueParentCode(name, parentPhone);
    const student = new Student({
      name, phone, parentName, parentPhone, aadhar, birthday, photo,
      subjects: subjects || [],
      className: className || '',
      batchId: batchId || '',
      notes,
      rollNumber,
      parentCode,
      enrollmentDate: istDateISO(),
      joinDate: new Date(),
      registeredVia: 'self',
      pendingApproval: true, // teacher must approve (request #3)
    });
    await student.save();
    res.json({ ok: true, message: 'Registration submitted. Your teacher will review and approve. Your parent code is ' + parentCode + ' — keep it safe.', student });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// STUDENT ROUTES
// ===========================

app.get('/api/students', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'parent' || req.user.role === 'student') {
      const s = await Student.findById(req.user.studentId);
      return res.json(s ? [s] : []);
    }
    // Teacher: only approved students in the main list.
    // ?light=1 skips the heavy base64 photo field for faster, smaller responses.
    const query = Student.find({ pendingApproval: { $ne: true } }).sort({ name: 1 });
    if (req.query.light === '1') query.select('-photo');
    const students = await query;
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pending self-registrations awaiting teacher approval
app.get('/api/students/pending', authenticate, teacherOnly, async (req, res) => {
  try {
    const students = await Student.find({ pendingApproval: true }).sort({ joinDate: -1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/students/:id', authenticate, async (req, res) => {
  try {
    if (!parentScopeCheck(req, req.params.id)) return res.status(403).json({ error: 'Forbidden' });
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/students', authenticate, teacherOnly, async (req, res) => {
  try {
    const cleanPhone = (req.body.phone || '').replace(/\D/g, '');
    if (cleanPhone) {
      const dupe = await Student.findOne({ phone: { $regex: cleanPhone + '$' } });
      if (dupe) return res.status(409).json({ error: 'A student with this phone number already exists.' });
    }
    if (req.body.aadhar && !isValidAadhar(req.body.aadhar)) {
      return res.status(400).json({ error: 'Aadhar number is invalid (failed checksum).' });
    }
    // Generate a unique roll number (or use the one provided if free)
    let rollNumber = (req.body.rollNumber || '').trim();
    if (rollNumber) {
      const exists = await Student.findOne({ rollNumber });
      if (exists) return res.status(409).json({ error: 'Roll number already in use by another student.' });
    } else {
      const count = await Student.countDocuments();
      let n = count + 1;
      while (true) {
        const candidate = String(n).padStart(3, '0');
        const exists = await Student.findOne({ rollNumber: candidate });
        if (!exists) { rollNumber = candidate; break; }
        n++;
      }
    }
    const parentCode = req.body.parentCode || await ensureUniqueParentCode(req.body.name, req.body.parentPhone);
    const student = new Student({
      ...req.body,
      rollNumber,
      parentCode,
      enrollmentDate: req.body.enrollmentDate || istDateISO(),
      joinDate: new Date(),
      registeredVia: 'teacher',
      pendingApproval: false,
    });
    await student.save();
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student self-edit (bio, instagram, photo) — MUST be before /:id route
app.put('/api/students/me', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Student only' });
    const allowed = {};
    if (typeof req.body.bio === 'string') allowed.bio = req.body.bio.slice(0, 500);
    if (typeof req.body.instagram === 'string') allowed.instagram = req.body.instagram.slice(0, 200);
    if (typeof req.body.photo === 'string') {
      if (req.body.photo.length > 600000) return res.status(413).json({ error: 'Photo too large' });
      allowed.photo = req.body.photo;
    }
    await Student.findByIdAndUpdate(req.user.studentId, allowed);
    const s = await Student.findById(req.user.studentId);
    res.json({ ok: true, student: s });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/students/:id', authenticate, teacherOnly, async (req, res) => {
  try {
    const update = { ...req.body };
    delete update.parentCode; // Don't allow changing parentCode here

    // Re-check Aadhar on edit if it changed
    if (update.aadhar) {
      const existing = await Student.findById(req.params.id).select('aadhar');
      if (existing && update.aadhar !== existing.aadhar && !isValidAadhar(update.aadhar)) {
        return res.status(400).json({ error: 'Aadhar number is invalid (failed checksum).' });
      }
    }
    // Phone dup check (only if phone changed)
    if (update.phone) {
      const cleanPhone = update.phone.replace(/\D/g, '');
      if (cleanPhone) {
        const dupe = await Student.findOne({ phone: { $regex: cleanPhone + '$' }, _id: { $ne: req.params.id } });
        if (dupe) return res.status(409).json({ error: 'Another student already has this phone number.' });
      }
    }
    const student = await Student.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve a self-registered student (request #3)
app.post('/api/students/:id/approve', authenticate, teacherOnly, async (req, res) => {
  try {
    const student = await Student.findByIdAndUpdate(req.params.id, { pendingApproval: false }, { new: true });
    if (!student) return res.status(404).json({ error: 'Not found' });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Regenerate a student's parent code
app.post('/api/students/:id/regenerate-code', authenticate, teacherOnly, async (req, res) => {
  try {
    const s = await Student.findById(req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const code = await ensureUniqueParentCode(s.name, s.parentPhone);
    const student = await Student.findByIdAndUpdate(req.params.id, { parentCode: code }, { new: true });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/students/:id', authenticate, teacherOnly, async (req, res) => {
  try {
    await Student.findByIdAndDelete(req.params.id);
    await Attendance.deleteMany({ studentId: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// ATTENDANCE ROUTES
// ===========================

app.get('/api/attendance/today', authenticate, teacherOnly, async (req, res) => {
  try {
    const today = istDateISO();
    const attendance = await Attendance.find({ date: today });
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/attendance/student/:studentId', authenticate, async (req, res) => {
  try {
    if (!parentScopeCheck(req, req.params.studentId)) return res.status(403).json({ error: 'Forbidden' });
    const attendance = await Attendance.find({ studentId: req.params.studentId }).sort({ date: -1 });
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/attendance/summary/:studentId', authenticate, async (req, res) => {
  try {
    if (!parentScopeCheck(req, req.params.studentId)) return res.status(403).json({ error: 'Forbidden' });
    const student = await Student.findById(req.params.studentId);
    if (!student) return res.status(404).json({ error: 'Not found' });
    const records = await Attendance.find({ studentId: req.params.studentId });
    const present = records.filter(r => r.status === 'present').length;
    const absent = records.filter(r => r.status === 'absent').length;

    // Work out off-days from the student's batch (Sunday-only default).
    const config = await Config.findOne();
    let offDays = [0];
    if (student.batchId && config?.batches?.length) {
      const batch = config.batches.find(b => String(b._id) === String(student.batchId));
      if (batch?.weeklyOffDays?.length) offDays = batch.weeklyOffDays;
    }

    // Establish enrollment date (fall back to joinDate, then today as safety).
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);
    let enrolled;
    if (student.enrollmentDate && /^\d{4}-\d{2}-\d{2}/.test(student.enrollmentDate)) {
      enrolled = new Date(student.enrollmentDate + 'T00:00:00');
    } else if (student.joinDate) {
      enrolled = new Date(student.joinDate); enrolled.setHours(0, 0, 0, 0);
    } else {
      enrolled = new Date(todayD);
    }

    // Count working days from enrollment → today. Days a student "should have"
    // shown up. Unmarked days now count against the percentage, which is what
    // the teacher actually wants to see (a student present 7/31 days is 22 %,
    // not 100 % just because the teacher didn't mark the missed days).
    let workingDays = 0;
    const cursor = new Date(enrolled);
    while (cursor <= todayD) {
      if (!offDays.includes(cursor.getDay())) workingDays++;
      cursor.setDate(cursor.getDate() + 1);
    }
    const percentage = workingDays ? Math.min(100, Math.round((present / workingDays) * 100)) : 0;

    // Same calculation but restricted to the last 30 days — what the
    // "Attendance — Last 30 Days" panel needs.
    const isoOf = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const thirtyAgo = new Date(todayD); thirtyAgo.setDate(todayD.getDate() - 29);
    const last30Start = enrolled > thirtyAgo ? enrolled : thirtyAgo;
    const last30StartISO = isoOf(last30Start);
    const last30Records = records.filter(r => r.date >= last30StartISO);
    const last30Present = last30Records.filter(r => r.status === 'present').length;
    const last30Absent  = last30Records.filter(r => r.status === 'absent').length;
    let last30Working = 0;
    const cur2 = new Date(last30Start);
    while (cur2 <= todayD) {
      if (!offDays.includes(cur2.getDay())) last30Working++;
      cur2.setDate(cur2.getDate() + 1);
    }
    const last30Pct = last30Working ? Math.min(100, Math.round((last30Present / last30Working) * 100)) : 0;

    const absentDays = records
      .filter(r => r.status === 'absent')
      .map(r => ({ date: r.date, reason: r.reason || 'No reason given' }))
      .sort((a, b) => b.date.localeCompare(a.date));

    res.json({
      present, absent, total: present + absent, percentage, workingDays,
      last30: { present: last30Present, absent: last30Absent, percentage: last30Pct, workingDays: last30Working },
      absentDays,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batched summary for ALL students in ONE query (used by the Summary tab).
// Replaces firing one request per student, which was very slow on free tiers.
app.get('/api/attendance/summary-all', authenticate, teacherOnly, async (req, res) => {
  try {
    const grouped = await Attendance.aggregate([
      { $group: {
        _id: '$studentId',
        present: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
        absent:  { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
      }},
    ]);
    // Pull all students (need enrollment dates + batch for proper percentage).
    const students = await Student.find({ pendingApproval: { $ne: true } }).select('_id batchId enrollmentDate joinDate');
    const config = await Config.findOne();
    const batchOffMap = new Map();
    (config?.batches || []).forEach(b => batchOffMap.set(String(b._id), b.weeklyOffDays?.length ? b.weeklyOffDays : [0]));
    const todayD = new Date(); todayD.setHours(0, 0, 0, 0);

    const countsByStudent = new Map(grouped.map(g => [String(g._id), { present: g.present, absent: g.absent }]));
    const summaries = {};
    for (const s of students) {
      const c = countsByStudent.get(String(s._id)) || { present: 0, absent: 0 };
      const offDays = batchOffMap.get(String(s.batchId)) || [0];
      let enrolled;
      if (s.enrollmentDate && /^\d{4}-\d{2}-\d{2}/.test(s.enrollmentDate)) {
        enrolled = new Date(s.enrollmentDate + 'T00:00:00');
      } else if (s.joinDate) {
        enrolled = new Date(s.joinDate); enrolled.setHours(0, 0, 0, 0);
      } else {
        enrolled = new Date(todayD);
      }
      let workingDays = 0;
      const cursor = new Date(enrolled);
      while (cursor <= todayD) {
        if (!offDays.includes(cursor.getDay())) workingDays++;
        cursor.setDate(cursor.getDate() + 1);
      }
      summaries[String(s._id)] = {
        present: c.present,
        absent: c.absent,
        total: c.present + c.absent,
        workingDays,
        percentage: workingDays ? Math.min(100, Math.round((c.present / workingDays) * 100)) : 0,
      };
    }
    res.json({ summaries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Attendance for ANY single date (teacher) — powers the "edit past date" feature.
app.get('/api/attendance/by-date', authenticate, teacherOnly, async (req, res) => {
  try {
    const day = req.query.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return res.status(400).json({ error: 'Invalid date (use YYYY-MM-DD)' });
    const attendance = await Attendance.find({ date: day });
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student or teacher check-in/check-out.
app.post('/api/attendance/check', authenticate, async (req, res) => {
  try {
    const { studentId, action } = req.body;
    const today = istDateISO();
    const timeStr = istTimeHM();
    let attendance = await Attendance.findOne({ studentId, date: today });
    if (!attendance) {
      attendance = new Attendance({
        studentId, date: today, status: 'present',
        markedBy: req.user.role === 'teacher' ? 'teacher' : 'self',
      });
    }
    if (action === 'in')  attendance.inTime  = timeStr;
    if (action === 'out') attendance.outTime = timeStr;
    attendance.status = 'present';
    await attendance.save();
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student-mode mark: teacher's session, but markedBy='self' because the student
// physically tapped their own name on the teacher's device.
// Self-mark: student marks themselves present (or teacher does it for them).
// When called by a student, they can only mark their own studentId.
app.post('/api/attendance/self-mark', authenticate, async (req, res) => {
  try {
    let { studentId, note } = req.body;
    if (req.user.role === 'student') {
      studentId = req.user.studentId; // students can only mark themselves
    } else if (req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const today = istDateISO();
    const timeStr = istTimeHM();
    let attendance = await Attendance.findOne({ studentId, date: today });
    if (!attendance) {
      attendance = new Attendance({
        studentId, date: today, status: 'present', markedBy: 'self', inTime: timeStr,
        note: note || undefined,
      });
    } else {
      attendance.status = 'present';
      attendance.markedBy = 'self';
      if (!attendance.inTime) attendance.inTime = timeStr;
      if (note) attendance.note = note;
    }
    await attendance.save();
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student marks themselves present from THEIR OWN login (roll number).
// Used when student opens the app on teacher's phone after physically arriving.
app.post('/api/attendance/student-mark', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Student only' });
    const today = istDateISO();
    const timeStr = istTimeHM();
    let attendance = await Attendance.findOne({ studentId: req.user.studentId, date: today });
    if (!attendance) {
      attendance = new Attendance({
        studentId: req.user.studentId, date: today, status: 'present', markedBy: 'self', inTime: timeStr,
        note: (req.body.note || '').trim() || undefined,
      });
    } else if (attendance.status === 'absent') {
      attendance.status = 'present';
      attendance.markedBy = 'self';
      attendance.inTime = timeStr;
      if (req.body.note) attendance.note = req.body.note;
    } else {
      return res.status(200).json({ already: true, attendance });
    }
    await attendance.save();
    res.json({ ok: true, attendance });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student updates their own photo
app.post('/api/students/me/photo', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'student') return res.status(403).json({ error: 'Student only' });
    const { photo } = req.body;
    if (typeof photo !== 'string') return res.status(400).json({ error: 'photo required' });
    if (photo.length > 600000) return res.status(413).json({ error: 'Photo too large (max ~400KB)' });
    await Student.findByIdAndUpdate(req.user.studentId, { photo });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance/teacher-mark', authenticate, teacherOnly, async (req, res) => {
  try {
    const { studentId, status, reason, date } = req.body;
    const day = date || istDateISO();
    const config = await Config.findOne();
    const student = await Student.findById(studentId);
    let attendance = await Attendance.findOne({ studentId, date: day });
    if (!attendance) {
      attendance = new Attendance({ studentId, date: day });
    }
    attendance.status = status;
    attendance.markedBy = 'teacher';
    attendance.reason = reason || '';
    if (status === 'present') {
      // Prefer batch-specific timings; fall back to classroom default.
      let inT = config?.classStart || '09:00';
      let outT = config?.classEnd || '17:00';
      if (student?.batchId && config?.batches?.length) {
        const batch = config.batches.id(student.batchId);
        if (batch) {
          inT = batch.startTime || inT;
          outT = batch.endTime || outT;
        }
      }
      attendance.inTime = inT;
      attendance.outTime = outT;
    } else {
      attendance.inTime = '';
      attendance.outTime = '';
    }
    await attendance.save();
    res.json(attendance);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance/mark-all-present', authenticate, teacherOnly, async (req, res) => {
  try {
    const { batchId, className, date } = req.body || {};
    const day = date || istDateISO();
    const config = await Config.findOne();
    // Only approved students, respecting whichever filters are active.
    const filter = { pendingApproval: { $ne: true } };
    if (batchId) filter.batchId = batchId;
    if (className) filter.className = className;
    const students = await Student.find(filter);
    let marked = 0, skipped = 0;
    for (const s of students) {
      // Don't create attendance for days before a student enrolled.
      if (s.enrollmentDate && /^\d{4}-\d{2}-\d{2}$/.test(s.enrollmentDate) && s.enrollmentDate > day) { skipped++; continue; }
      let att = await Attendance.findOne({ studentId: s._id, date: day });
      if (att && att.status === 'present') continue;
      if (!att) {
        att = new Attendance({ studentId: s._id, date: day });
      }
      let inT = config?.classStart || '09:00';
      let outT = config?.classEnd || '17:00';
      if (s.batchId && config?.batches?.length) {
        const batch = config.batches.id(s.batchId);
        if (batch) { inT = batch.startTime || inT; outT = batch.endTime || outT; }
      }
      att.status = 'present';
      att.markedBy = 'teacher';
      att.inTime = inT;
      att.outTime = outT;
      att.reason = '';
      await att.save();
      marked++;
    }
    res.json({ ok: true, marked, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark everyone who is NOT yet marked for a day as absent (one-tap "fill the rest").
// Only touches students with no record yet — never overwrites present/absent.
// Respects batch/class filters, excludes pending students, skips pre-enrollment days.
app.post('/api/attendance/mark-rest-absent', authenticate, teacherOnly, async (req, res) => {
  try {
    const { batchId, className, date, reason } = req.body || {};
    const day = date || istDateISO();
    const filter = { pendingApproval: { $ne: true } };
    if (batchId) filter.batchId = batchId;
    if (className) filter.className = className;
    const students = await Student.find(filter);
    const existing = await Attendance.find({ date: day }).select('studentId').lean();
    const haveRecord = new Set(existing.map(a => String(a.studentId)));
    let marked = 0, skipped = 0;
    for (const s of students) {
      if (haveRecord.has(String(s._id))) { skipped++; continue; } // already present or absent
      if (s.enrollmentDate && /^\d{4}-\d{2}-\d{2}$/.test(s.enrollmentDate) && s.enrollmentDate > day) { skipped++; continue; }
      const att = new Attendance({
        studentId: s._id, date: day, status: 'absent',
        markedBy: 'teacher', reason: (reason || '').trim() || 'Not marked present',
      });
      await att.save();
      marked++;
    }
    res.json({ ok: true, marked, skipped });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Student can undo their own self check-in for today (rule: only same day, only self-marked).
app.post('/api/attendance/undo-self', authenticate, async (req, res) => {
  try {
    const { studentId } = req.body;
    if (req.user.role !== 'student' && req.user.role !== 'teacher') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const today = istDateISO();
    const att = await Attendance.findOne({ studentId, date: today });
    if (!att) return res.json({ ok: true, message: 'Nothing to undo' });
    // Students may only undo their own self-marked records
    if (req.user.role === 'student' && att.markedBy !== 'self') {
      return res.status(403).json({ error: 'This was marked by your teacher; ask them to fix it.' });
    }
    await Attendance.deleteOne({ _id: att._id });
    res.json({ ok: true, deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher can unmark any attendance record for any date (rolls it back to "not marked").
app.delete('/api/attendance/unmark', authenticate, teacherOnly, async (req, res) => {
  try {
    const { studentId, date } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const day = date || istDateISO();
    await Attendance.deleteOne({ studentId, date: day });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/attendance/:id', authenticate, teacherOnly, async (req, res) => {
  try {
    const att = await Attendance.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(att);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// ANNOUNCEMENT ROUTES
// ===========================

app.get('/api/announcements', authenticate, async (req, res) => {
  try {
    let filter = {};
    if (req.user.role === 'parent') {
      const student = await Student.findById(req.user.studentId);
      if (student) {
        filter = { $or: [{ batchId: '' }, { batchId: student.batchId || '' }] };
      }
    }
    const announcements = await Announcement.find(filter).sort({ createdAt: -1 });
    res.json(announcements);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/announcements', authenticate, teacherOnly, async (req, res) => {
  try {
    const { message, type, dates, batchId } = req.body;
    const announcement = new Announcement({
      message,
      type,
      dates: type === 'off-day' ? (dates || []) : [],
      batchId: batchId || '',
    });
    await announcement.save();
    res.json(announcement);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/announcements/:id', authenticate, teacherOnly, async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// FEES ROUTES
// ===========================

// Working days in a month = total days - count of weekly off days (Sunday by default).
// Per requirement 11: announced holidays do NOT reduce working days.
const workingDaysInMonth = (year, month1to12, weeklyOffDays = [0]) => {
  const daysInMonth = new Date(year, month1to12, 0).getDate(); // month1to12 here is 1-based
  let working = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month1to12 - 1, d).getDay();
    if (!weeklyOffDays.includes(dow)) working++;
  }
  return { working, total: daysInMonth };
};

// Count of days from 1..maxDay (inclusive) that are weekly-off days.
const countOffDaysUpTo = (year, month1to12, upToDay, weeklyOffDays = [0]) => {
  let off = 0;
  for (let d = 1; d <= upToDay; d++) {
    const dow = new Date(year, month1to12 - 1, d).getDay();
    if (weeklyOffDays.includes(dow)) off++;
  }
  return off;
};

const computeStudentFees = (student, config, yyyymm) => {
  const [yStr, mStr] = yyyymm.split('-');
  const year = Number(yStr);
  const month = Number(mStr); // 1..12
  if (!year || !month) return null;

  // Off days come from the student's batch, else Sunday only.
  let offDays = [0];
  if (student.batchId && config?.batches?.length) {
    const batch = config.batches.id ? config.batches.id(student.batchId) :
                  config.batches.find(b => String(b._id) === String(student.batchId));
    if (batch?.weeklyOffDays?.length) offDays = batch.weeklyOffDays;
  }

  const { working, total } = workingDaysInMonth(year, month, offDays);

  // Monthly fee: prefer per-student override, fall back to the class's monthly fee
  // (so a teacher who only set fees in Settings → Classes still sees real totals).
  let monthlyFee = Number(student.monthlyFee) || 0;
  if (!monthlyFee && student.className && config?.classes?.length) {
    const cls = config.classes.find(c => c.name === student.className);
    if (cls?.monthlyFee) monthlyFee = Number(cls.monthlyFee) || 0;
  }
  const perDay = working ? monthlyFee / working : 0;

  return {
    year, month,
    workingDays: working, totalDays: total, offWeekday: offDays,
    className: student.className || '',
    monthlyFee, perDay,
  };
};

app.get('/api/fees/student/:id', authenticate, async (req, res) => {
  try {
    if (!parentScopeCheck(req, req.params.id)) return res.status(403).json({ error: 'Forbidden' });
    const yyyymm = req.query.month || istDateISO().substring(0, 7);
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Not found' });
    const config = await Config.findOne();
    const fees = computeStudentFees(student, config, yyyymm);
    res.json({ student: { _id: student._id, name: student.name, rollNumber: student.rollNumber, batchId: student.batchId }, fees });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All unpaid months for a student (enrollment month → current), with running total.
// Powers the "carry-over pending fees" reminder.
app.get('/api/fees/dues/:id', authenticate, async (req, res) => {
  try {
    if (!parentScopeCheck(req, req.params.id)) return res.status(403).json({ error: 'Forbidden' });
    const student = await Student.findById(req.params.id);
    if (!student) return res.status(404).json({ error: 'Not found' });
    const config = await Config.findOne();
    // Match the same fallback rule as computeStudentFees: per-student fee first,
    // then class fee from settings, then 0.
    let monthlyFee = Number(student.monthlyFee) || 0;
    if (!monthlyFee && student.className && config?.classes?.length) {
      const cls = config.classes.find(c => c.name === student.className);
      if (cls?.monthlyFee) monthlyFee = Number(cls.monthlyFee) || 0;
    }

    // Range: from enrollment month to current month (inclusive).
    const nowYM = istDateISO().substring(0, 7);
    let startYM = (student.enrollmentDate || '').substring(0, 7);
    if (!/^\d{4}-\d{2}$/.test(startYM)) {
      const j = student.joinDate ? new Date(student.joinDate) : new Date();
      startYM = `${j.getFullYear()}-${String(j.getMonth() + 1).padStart(2, '0')}`;
    }
    // Build month list start..now
    const months = [];
    let [sy, sm] = startYM.split('-').map(Number);
    const [ny, nm] = nowYM.split('-').map(Number);
    // Safety cap of 60 months to avoid runaway loops on bad data.
    let guard = 0;
    while ((sy < ny || (sy === ny && sm <= nm)) && guard < 60) {
      months.push(`${sy}-${String(sm).padStart(2, '0')}`);
      sm++; if (sm > 12) { sm = 1; sy++; }
      guard++;
    }

    const payments = await FeePayment.find({ studentId: student._id });
    const paidSet = new Set(payments.map(p => p.month));

    const pending = [];
    let total = 0;
    if (monthlyFee > 0) {
      for (const m of months) {
        if (!paidSet.has(m)) {
          pending.push({ month: m, amount: monthlyFee });
          total += monthlyFee;
        }
      }
    }

    res.json({
      student: { _id: student._id, name: student.name, rollNumber: student.rollNumber, parentName: student.parentName, parentPhone: student.parentPhone, className: student.className },
      monthlyFee,
      dueDay: student.feeDueDay || 5,
      pending,           // [{month, amount}] oldest→newest
      total,             // sum of all pending
      pendingCount: pending.length,
      paidMonths: [...paidSet].sort(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/fees/summary', authenticate, teacherOnly, async (req, res) => {
  try {    const yyyymm = req.query.month || istDateISO().substring(0, 7);
    const students = await Student.find({ pendingApproval: { $ne: true } }).sort({ name: 1 });
    const config = await Config.findOne();
    const rows = students.map(s => {
      const fees = computeStudentFees(s, config, yyyymm);
      return {
        _id: s._id, name: s.name, rollNumber: s.rollNumber,
        batchId: s.batchId || '',
        className: s.className || '',
        subjects: s.subjects || [],
        fees,
      };
    });
    const grandMonthly = rows.reduce((a, r) => a + (r.fees?.monthlyFee || 0), 0);
    const grandDaily   = rows.reduce((a, r) => a + (r.fees?.perDay     || 0), 0);
    res.json({ month: yyyymm, students: rows, grandMonthly, grandDaily });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// CONFIG ROUTES
// ===========================

app.get('/api/config', authenticate, async (req, res) => {
  try {
    const config = await Config.findOne().select('-teacherPassword');
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change teacher password (requires old password)
app.post('/api/auth/change-password', authenticate, teacherOnly, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Both old and new password required' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
    const config = await Config.findOne();
    if (!config?.teacherPassword) return res.status(404).json({ error: 'Not set up' });
    const ok = await bcrypt.compare(oldPassword, config.teacherPassword);
    if (!ok) return res.status(401).json({ error: 'Current password is wrong' });
    config.teacherPassword = await bcrypt.hash(newPassword, 10);
    await config.save();
    res.json({ ok: true, message: 'Password changed successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Full backup — downloads ALL data as a JSON file
app.get('/api/backup/full', authenticate, teacherOnly, async (req, res) => {
  try {
    const [config, students, attendance, announcements, parentMsg, complaints, chat, fees, exams] = await Promise.all([
      Config.findOne().select('-teacherPassword').lean(),
      Student.find().lean(),
      Attendance.find().lean(),
      Announcement.find().lean(),
      ParentMessage.find().lean(),
      Complaint.find().lean(),
      ChatMessage.find().select('-image -audio').lean(), // exclude binary
      FeePayment.find().lean(),
      Exam.find().lean(),
    ]);
    res.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      counts: {
        students: students.length,
        attendance: attendance.length,
        announcements: announcements.length,
        parentMessages: parentMsg.length,
        complaints: complaints.length,
        chatMessages: chat.length,
        feePayments: fees.length,
        exams: exams.length,
      },
      data: { config, students, attendance, announcements, parentMessages: parentMsg, complaints, chatMessages: chat, feePayments: fees, exams },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/config', authenticate, teacherOnly, async (req, res) => {
  try {
    const config = await Config.findOne();
    if (!config) return res.status(404).json({ error: 'Not found' });
    const { teacherPassword, subjects, classes, batches, ...rest } = req.body;

    // Subjects are just names now.
    if (subjects !== undefined) {
      const names = (subjects || []).map(s => (typeof s === 'string' ? s : s.name)?.trim().toLowerCase());
      const dupes = names.filter((n, i) => n && names.indexOf(n) !== i);
      if (dupes.length) return res.status(400).json({ error: 'Duplicate subject name: ' + dupes[0] });
      config.subjects = (subjects || []).map(s =>
        typeof s === 'string' ? { name: s } : { name: s.name }
      );
    }
    // Classes carry the monthly fee.
    if (classes !== undefined) {
      const names = (classes || []).map(c => (c.name || '').trim().toLowerCase());
      const dupes = names.filter((n, i) => n && names.indexOf(n) !== i);
      if (dupes.length) return res.status(400).json({ error: 'Duplicate class name: ' + dupes[0] });
      config.classes = (classes || []).map(c => ({
        _id: c._id,
        name: c.name,
        monthlyFee: Number(c.monthlyFee) || 0,
      }));
    }
    if (batches !== undefined) {
      const names = (batches || []).map(b => (b.name || '').trim().toLowerCase());
      const dupes = names.filter((n, i) => n && names.indexOf(n) !== i);
      if (dupes.length) return res.status(400).json({ error: 'Duplicate batch name: ' + dupes[0] + '. Please use unique names like "Evening A" and "Evening B".' });
      config.batches = (batches || []).map(b => ({
        _id: b._id,
        name: b.name,
        startTime: b.startTime || '09:00',
        endTime:   b.endTime   || '11:00',
        weeklyOffDays: Array.isArray(b.weeklyOffDays) && b.weeklyOffDays.length ? b.weeklyOffDays : [0],
      }));
    }

    Object.assign(config, rest);
    if (teacherPassword) config.teacherPassword = await bcrypt.hash(teacherPassword, 10);
    await config.save();
    const safe = await Config.findById(config._id).select('-teacherPassword');
    res.json({ ok: true, config: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// PARENT → TEACHER MESSAGES (request #12)
// ===========================
const parentOnly = (req, res, next) => {
  if (req.user.role !== 'parent') return res.status(403).json({ error: 'Parent only' });
  next();
};

app.post('/api/parent-messages', authenticate, parentOnly, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Message required' });
    if (text.length > 2000) return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
    const student = await Student.findById(req.user.studentId).select('name');
    const msg = new ParentMessage({
      studentId: req.user.studentId,
      studentName: student?.name || 'Parent',
      text,
    });
    await msg.save();
    res.json({ ok: true, message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/parent-messages', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'teacher') {
      const messages = await ParentMessage.find().sort({ createdAt: -1 }).limit(200);
      const unread = await ParentMessage.countDocuments({ read: false });
      return res.json({ messages, unread });
    }
    if (req.user.role === 'parent') {
      const messages = await ParentMessage.find({ studentId: req.user.studentId }).sort({ createdAt: -1 }).limit(100);
      return res.json({ messages, unread: 0 });
    }
    res.status(403).json({ error: 'Forbidden' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/parent-messages/:id/read', authenticate, teacherOnly, async (req, res) => {
  try {
    await ParentMessage.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Unread count only (for badge polling)
app.get('/api/parent-messages/unread-count', authenticate, teacherOnly, async (req, res) => {
  try {
    const unread = await ParentMessage.countDocuments({ read: false });
    res.json({ unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// STUDENT COMPLAINTS (request #16)
// ===========================
const studentOnly = (req, res, next) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student only' });
  next();
};

app.post('/api/complaints', authenticate, studentOnly, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Complaint text required' });
    if (text.length > 5000) return res.status(400).json({ error: 'Too long' });
    const student = await Student.findById(req.user.studentId).select('name rollNumber');
    const c = new Complaint({
      studentId: req.user.studentId,
      studentName: student?.name || 'Student',
      rollNumber: student?.rollNumber || '',
      text,
    });
    await c.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/complaints', authenticate, teacherOnly, async (req, res) => {
  try {
    const complaints = await Complaint.find().sort({ createdAt: -1 }).limit(200);
    const unread = await Complaint.countDocuments({ read: false });
    res.json({ complaints, unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/complaints/:id/read', authenticate, teacherOnly, async (req, res) => {
  try {
    await Complaint.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/complaints/unread-count', authenticate, teacherOnly, async (req, res) => {
  try {
    const unread = await Complaint.countDocuments({ read: false });
    res.json({ unread });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// GROUP CHAT (request #14) — students + teacher, polled
// ===========================
app.get('/api/chat/messages', authenticate, async (req, res) => {
  try {
    if (!['teacher', 'student'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const since = req.query.since;
    const filter = since ? { createdAt: { $gt: new Date(since) } } : {};
    const messages = await ChatMessage.find(filter).sort({ createdAt: 1 }).limit(200).lean();

    // Enrich: for student messages missing a photo, look up the current photo.
    const studentIds = [...new Set(messages.filter(m => m.role === 'student' && !m.photo && m.studentId).map(m => String(m.studentId)))];
    if (studentIds.length) {
      const students = await Student.find({ _id: { $in: studentIds } }).select('_id photo').lean();
      const photoMap = {};
      students.forEach(s => { if (s.photo) photoMap[String(s._id)] = s.photo; });
      messages.forEach(m => {
        if (m.role === 'student' && !m.photo && m.studentId && photoMap[String(m.studentId)]) {
          m.photo = photoMap[String(m.studentId)];
        }
      });
    }

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/chat/messages', authenticate, async (req, res) => {
  try {
    if (!['teacher', 'student'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const { text, messageType, image, locationData, audio, contactData } = req.body;
    const mType = messageType || 'text';

    if (mType === 'text' && !(text || '').trim()) return res.status(400).json({ error: 'Empty message' });
    if (mType === 'image' && !image) return res.status(400).json({ error: 'Image required' });
    if (mType === 'audio' && !audio) return res.status(400).json({ error: 'Audio required' });
    if (mType === 'location' && !locationData) return res.status(400).json({ error: 'Location required' });
    if (mType === 'contact' && !contactData) return res.status(400).json({ error: 'Contact required' });
    if ((text || '').length > 1000) return res.status(400).json({ error: 'Too long (max 1000 chars)' });
    if (image && image.length > 400000) return res.status(413).json({ error: 'Image too large. Max ~300KB.' });
    if (audio && audio.length > 800000) return res.status(413).json({ error: 'Voice note too large. Keep under 30 seconds.' });

    let name = 'Teacher', rollNumber = '', studentId = null, senderPhoto = '';
    if (req.user.role === 'student') {
      const s = await Student.findById(req.user.studentId).select('name rollNumber photo');
      if (!s) return res.status(404).json({ error: 'Student not found' });
      name = s.name; rollNumber = s.rollNumber; studentId = req.user.studentId; senderPhoto = s.photo || '';
    } else {
      const cfg = await Config.findOne().select('teacherName teacherPhoto');
      name = cfg?.teacherName || 'Teacher'; senderPhoto = cfg?.teacherPhoto || '';
    }
    const msg = new ChatMessage({
      role: req.user.role, studentId, name, rollNumber, photo: senderPhoto,
      text: (text || '').trim(), messageType: mType,
      image: mType === 'image' ? image : undefined,
      audio: mType === 'audio' ? audio : undefined,
      locationData: mType === 'location' ? locationData : undefined,
      contactData: mType === 'contact' ? contactData : undefined,
    });
    await msg.save();
    res.json({ ok: true, message: msg });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete all attendance records for a specific month (teacher only)
app.delete('/api/attendance/month/:month', authenticate, teacherOnly, async (req, res) => {
  try {
    const month = req.params.month; // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format (use YYYY-MM)' });
    const result = await Attendance.deleteMany({ date: { $regex: '^' + month } });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all fee payment records for a specific month (teacher only)
app.delete('/api/fees/month/:month', authenticate, teacherOnly, async (req, res) => {
  try {
    const month = req.params.month; // YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ error: 'Invalid month format (use YYYY-MM)' });
    const result = await FeePayment.deleteMany({ month });
    res.json({ ok: true, deleted: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// All attendance for a specific month (for export)
app.get('/api/attendance/export', authenticate, teacherOnly, async (req, res) => {
  try {
    const month = req.query.month || istDateISO().substring(0, 7);
    const records = await Attendance.find({ date: { $regex: '^' + month } }).lean();
    const students = await Student.find({ pendingApproval: { $ne: true } }).select('name rollNumber className').lean();
    const studentMap = {};
    students.forEach(s => { studentMap[String(s._id)] = s; });
    const enriched = records.map(r => ({
      ...r,
      studentName: studentMap[String(r.studentId)]?.name || 'Unknown',
      rollNumber: studentMap[String(r.studentId)]?.rollNumber || '',
      className: studentMap[String(r.studentId)]?.className || '',
    }));
    res.json({ month, records: enriched, students });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get list of months that have attendance data
app.get('/api/attendance/months', authenticate, teacherOnly, async (req, res) => {
  try {
    const records = await Attendance.find().select('date').lean();
    const months = [...new Set(records.map(r => r.date.substring(0, 7)))].sort().reverse();
    res.json({ months });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// PROFESSIONAL EXCEL EXPORT (styled, colored, easy to read)
// Streams a real .xlsx built with ExcelJS. Loaded on demand.
// ===========================
app.get('/api/export/excel', authenticate, teacherOnly, async (req, res) => {
  try {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : istDateISO().substring(0, 7);
    const ExcelJS = (await import('exceljs')).default;

    const [students, records, payments, config] = await Promise.all([
      Student.find({ pendingApproval: { $ne: true } }).sort({ rollNumber: 1 }).lean(),
      Attendance.find({ date: { $regex: '^' + month } }).lean(),
      FeePayment.find({ month }).lean(),
      Config.findOne().lean(),
    ]);
    const studentMap = {};
    students.forEach(s => { studentMap[String(s._id)] = s; });
    const batchName = (id) => (config?.batches || []).find(b => String(b._id) === String(id))?.name || '';
    const payMap = {};
    payments.forEach(p => { payMap[String(p.studentId)] = p; });

    // Pretty month label e.g. "May 2026"
    const [yy, mm] = month.split('-').map(Number);
    const monthLabel = new Date(yy, mm - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const wb = new ExcelJS.Workbook();
    wb.creator = config?.classroomName || 'Coaching';
    wb.created = new Date();

    // ---- shared styles ----
    const BRAND = 'FF1D4ED8';      // blue
    const BRAND_DARK = 'FF1E3A8A';
    const GREEN = 'FF16A34A';
    const RED = 'FFDC2626';
    const AMBER = 'FFD97706';
    const LIGHT = 'FFF1F5F9';
    const thin = { style: 'thin', color: { argb: 'FFCBD5E1' } };
    const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

    const styleHeader = (row) => {
      row.eachCell(c => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND } };
        c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        c.border = allBorders;
      });
      row.height = 22;
    };
    const zebra = (ws, startRow, cols) => {
      for (let r = startRow; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        if ((r - startRow) % 2 === 1) {
          for (let cI = 1; cI <= cols; cI++) {
            const cell = row.getCell(cI);
            if (!cell.fill || cell.fill.type !== 'pattern' || cell.fill.fgColor?.argb === undefined) {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT } };
            }
          }
        }
        for (let cI = 1; cI <= cols; cI++) row.getCell(cI).border = allBorders;
      }
    };
    const titleBlock = (ws, title, span) => {
      ws.mergeCells(1, 1, 1, span);
      const t = ws.getCell(1, 1);
      t.value = (config?.classroomName || 'Coaching Center');
      t.font = { bold: true, size: 16, color: { argb: BRAND_DARK } };
      t.alignment = { vertical: 'middle', horizontal: 'left' };
      ws.getRow(1).height = 26;
      ws.mergeCells(2, 1, 2, span);
      const s = ws.getCell(2, 1);
      s.value = title;
      s.font = { size: 11, italic: true, color: { argb: 'FF475569' } };
      ws.getRow(2).height = 18;
      ws.addRow([]); // spacer row 3
    };

    // ============ SHEET 1: STUDENTS ============
    const ws1 = wb.addWorksheet('Students', { views: [{ state: 'frozen', ySplit: 5 }] });
    titleBlock(ws1, `Student List · ${students.length} students`, 8);
    const h1 = ws1.addRow(['Roll #', 'Name', 'Class', 'Batch', 'Phone', 'Parent', 'Parent Phone', 'Monthly Fee']);
    styleHeader(h1);
    students.forEach(s => {
      const row = ws1.addRow([
        s.rollNumber || '', s.name || '', s.className || '', batchName(s.batchId),
        s.phone || '', s.parentName || '', s.parentPhone || '', Number(s.monthlyFee) || 0,
      ]);
      row.getCell(8).numFmt = '"₹"#,##0';
      row.getCell(1).alignment = { horizontal: 'center' };
    });
    ws1.columns = [{ width: 9 }, { width: 22 }, { width: 10 }, { width: 16 }, { width: 15 }, { width: 20 }, { width: 15 }, { width: 14 }];
    zebra(ws1, 6, 8);

    // ============ SHEET 2: ATTENDANCE ============
    const ws2 = wb.addWorksheet(`Attendance`, { views: [{ state: 'frozen', ySplit: 5 }] });
    titleBlock(ws2, `Attendance · ${monthLabel}`, 8);
    const h2 = ws2.addRow(['Date', 'Day', 'Roll #', 'Name', 'Class', 'Status', 'In', 'Out']);
    styleHeader(h2);
    const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date) || (studentMap[String(a.studentId)]?.rollNumber || '').localeCompare(studentMap[String(b.studentId)]?.rollNumber || ''));
    sorted.forEach(r => {
      const st = studentMap[String(r.studentId)] || {};
      const dObj = new Date(r.date + 'T00:00:00');
      const row = ws2.addRow([
        r.date,
        dObj.toLocaleDateString('en-US', { weekday: 'short' }),
        st.rollNumber || '',
        st.studentName || st.name || 'Unknown',
        st.className || '',
        r.status === 'present' ? 'Present' : 'Absent',
        r.inTime || '', r.outTime || '',
      ]);
      const statusCell = row.getCell(6);
      statusCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      statusCell.alignment = { horizontal: 'center' };
      statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r.status === 'present' ? GREEN : RED } };
      row.getCell(1).alignment = { horizontal: 'center' };
      row.getCell(3).alignment = { horizontal: 'center' };
    });
    if (!sorted.length) { const e = ws2.addRow(['—', '', '', 'No attendance records for this month', '', '', '', '']); ws2.mergeCells(e.number, 4, e.number, 8); }
    ws2.columns = [{ width: 13 }, { width: 7 }, { width: 9 }, { width: 22 }, { width: 10 }, { width: 11 }, { width: 8 }, { width: 8 }];
    zebra(ws2, 6, 8);

    // ============ SHEET 3: FEES ============
    const ws3 = wb.addWorksheet('Fees', { views: [{ state: 'frozen', ySplit: 5 }] });
    titleBlock(ws3, `Fees · ${monthLabel}`, 7);
    const h3 = ws3.addRow(['Roll #', 'Name', 'Class', 'Monthly Fee', 'Status', 'Paid On', 'Note']);
    styleHeader(h3);
    let collected = 0, pendingAmt = 0;
    students.filter(s => Number(s.monthlyFee) > 0).forEach(s => {
      const pay = payMap[String(s._id)];
      const isPaid = !!pay;
      if (isPaid) collected += (pay.amount || s.monthlyFee || 0); else pendingAmt += Number(s.monthlyFee) || 0;
      const row = ws3.addRow([
        s.rollNumber || '', s.name || '', s.className || '',
        Number(s.monthlyFee) || 0,
        isPaid ? 'PAID' : 'PENDING',
        pay?.paidOn ? new Date(pay.paidOn).toLocaleDateString('en-IN') : '',
        pay?.note || '',
      ]);
      row.getCell(4).numFmt = '"₹"#,##0';
      const stc = row.getCell(5);
      stc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      stc.alignment = { horizontal: 'center' };
      stc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isPaid ? GREEN : AMBER } };
      row.getCell(1).alignment = { horizontal: 'center' };
    });
    // totals row
    ws3.addRow([]);
    const totalRow = ws3.addRow(['', 'TOTAL', '', collected + pendingAmt, '', '', '']);
    totalRow.getCell(2).font = { bold: true };
    totalRow.getCell(4).numFmt = '"₹"#,##0';
    totalRow.getCell(4).font = { bold: true };
    const cRow = ws3.addRow(['', 'Collected', '', collected, '', '', '']);
    cRow.getCell(4).numFmt = '"₹"#,##0'; cRow.getCell(2).font = { color: { argb: GREEN }, bold: true }; cRow.getCell(4).font = { color: { argb: GREEN }, bold: true };
    const pRow = ws3.addRow(['', 'Pending', '', pendingAmt, '', '', '']);
    pRow.getCell(4).numFmt = '"₹"#,##0'; pRow.getCell(2).font = { color: { argb: AMBER }, bold: true }; pRow.getCell(4).font = { color: { argb: AMBER }, bold: true };
    ws3.columns = [{ width: 9 }, { width: 22 }, { width: 10 }, { width: 14 }, { width: 11 }, { width: 14 }, { width: 24 }];
    zebra(ws3, 6, 7);

    const safeName = (config?.classroomName || 'Coaching').replace(/[^A-Za-z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_${month}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher can hard-delete any group chat message
app.delete('/api/chat/messages/:id', authenticate, teacherOnly, async (req, res) => {
  try {
    await ChatMessage.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher hard-deletes a parent chat message (removes for both sides)
app.delete('/api/parent-chat/:id/hard-delete', authenticate, teacherOnly, async (req, res) => {
  try {
    await ParentMessage.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// (students/me PUT is defined earlier, before /:id route)

// Get a single student's public profile (for chat profile modal)
// Returns ONLY fields that are safe to expose to other students
app.get('/api/students/:id/profile', authenticate, async (req, res) => {
  try {
    const s = await Student.findById(req.params.id).select('name rollNumber photo bio instagram className batchId subjects birthday');
    if (!s) return res.status(404).json({ error: 'Not found' });
    const cfg = await Config.findOne().select('batches');
    const batch = cfg?.batches?.find(b => String(b._id) === String(s.batchId));
    res.json({
      _id: s._id,
      name: s.name,
      rollNumber: s.rollNumber,
      photo: s.photo,
      bio: s.bio,
      instagram: s.instagram,
      className: s.className,
      subjects: s.subjects,
      batch: batch ? { name: batch.name, startTime: batch.startTime, endTime: batch.endTime } : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// FEES — MARK PAID / PENDING LIST
// ===========================
app.get('/api/fees/pending', authenticate, teacherOnly, async (req, res) => {
  try {
    const yyyymm = req.query.month || istDateISO().substring(0, 7);
    const students = await Student.find({ pendingApproval: { $ne: true }, monthlyFee: { $gt: 0 } }).select('name rollNumber monthlyFee feeDueDay parentPhone parentName photo className batchId');
    const paid = await FeePayment.find({ month: yyyymm });
    const paidIds = new Set(paid.map(p => String(p.studentId)));
    const todayDay = Number(istDateISO().substring(8, 10)); // IST day-of-month
    const pending = students
      .filter(s => !paidIds.has(String(s._id)))
      .map(s => ({
        ...s.toObject(),
        overdue: todayDay > (s.feeDueDay || 5),
        dueDay: s.feeDueDay || 5,
      }));
    res.json({ month: yyyymm, pending, totalPaid: paid.length, totalPending: pending.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Who has PAID this month (for teacher paid list)
app.get('/api/fees/paid', authenticate, teacherOnly, async (req, res) => {
  try {
    const yyyymm = req.query.month || istDateISO().substring(0, 7);
    const payments = await FeePayment.find({ month: yyyymm });
    const paidIds = payments.map(p => p.studentId);
    const students = await Student.find({ _id: { $in: paidIds }, pendingApproval: { $ne: true } })
      .select('name rollNumber monthlyFee photo className parentPhone');
    const payMap = {};
    payments.forEach(p => { payMap[String(p.studentId)] = p; });
    const result = students.map(s => ({
      ...s.toObject(),
      paidOn: payMap[String(s._id)]?.paidOn,
      paidAmount: payMap[String(s._id)]?.amount,
      note: payMap[String(s._id)]?.note,
    }));
    res.json({ month: yyyymm, paid: result, totalPaid: result.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fees/mark-paid', authenticate, teacherOnly, async (req, res) => {
  try {
    const { studentId, month, amount, note } = req.body;
    if (!studentId || !month) return res.status(400).json({ error: 'studentId and month required' });
    const existing = await FeePayment.findOne({ studentId, month });
    if (existing) {
      existing.paidOn = new Date();
      existing.amount = amount;
      existing.note = note;
      await existing.save();
      return res.json({ ok: true, payment: existing });
    }
    const payment = new FeePayment({ studentId, month, amount, note });
    await payment.save();
    res.json({ ok: true, payment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Roll back a fee payment marked by mistake — removes the paid record for that month.
app.post('/api/fees/unmark-paid', authenticate, teacherOnly, async (req, res) => {
  try {
    const { studentId, month } = req.body;
    if (!studentId || !month) return res.status(400).json({ error: 'studentId and month required' });
    const result = await FeePayment.deleteOne({ studentId, month });
    res.json({ ok: true, removed: result.deletedCount || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// For parent: see if their child has fees pending and how many days till due
app.get('/api/fees/my-status', authenticate, async (req, res) => {
  try {
    if (!['parent', 'student'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const s = await Student.findById(req.user.studentId);
    if (!s || !s.monthlyFee || s.monthlyFee <= 0) return res.json({ hasFee: false });
    const yyyymm = istDateISO().substring(0, 7);
    const paid = await FeePayment.findOne({ studentId: s._id, month: yyyymm });
    const todayDay = Number(istDateISO().substring(8, 10)); // IST day-of-month
    const dueDay = s.feeDueDay || 5;
    const daysUntilDue = dueDay - todayDay; // negative if overdue
    res.json({
      hasFee: true,
      paid: !!paid,
      paidOn: paid?.paidOn,
      amount: s.monthlyFee,
      dueDay,
      daysUntilDue,
      overdue: !paid && todayDay > dueDay,
      showReminder: !paid && daysUntilDue <= 5,
      month: yyyymm,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// EXAMS / TESTS (teacher creates, sends to selected students)
// ===========================
app.post('/api/exams', authenticate, teacherOnly, async (req, res) => {
  try {
    const { title, description, examDate, studentIds } = req.body;
    if (!title) return res.status(400).json({ error: 'Title required' });
    const exam = new Exam({
      title, description, examDate,
      studentIds: Array.isArray(studentIds) ? studentIds : [],
    });
    await exam.save();
    res.json({ ok: true, exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/exams', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'teacher') {
      const exams = await Exam.find().sort({ createdAt: -1 }).limit(50);
      return res.json({ exams });
    }
    // parent/student see only exams targeted at them (or to everyone, i.e. empty studentIds)
    const myId = req.user.studentId;
    const exams = await Exam.find({
      $or: [{ studentIds: { $size: 0 } }, { studentIds: myId }]
    }).sort({ createdAt: -1 }).limit(30);
    res.json({ exams });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/exams/:id', authenticate, teacherOnly, async (req, res) => {
  try {
    await Exam.findByIdAndDelete(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit an existing exam. Only the fields the teacher actually sends are touched —
// sentVia / readBy delivery history is preserved across edits.
app.put('/api/exams/:id', authenticate, teacherOnly, async (req, res) => {
  try {
    const { title, description, examDate, studentIds } = req.body;
    const patch = {};
    if (typeof title === 'string') {
      if (!title.trim()) return res.status(400).json({ error: 'Title required' });
      patch.title = title;
    }
    if (typeof description === 'string') patch.description = description;
    if (typeof examDate === 'string') patch.examDate = examDate;
    if (Array.isArray(studentIds)) patch.studentIds = studentIds;
    patch.updatedAt = new Date();
    const exam = await Exam.findByIdAndUpdate(req.params.id, patch, { new: true });
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    res.json({ ok: true, exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher confirms they sent the WhatsApp / SMS for a particular student.
// Safe to call repeatedly — same (examId, studentId) won't duplicate.
app.post('/api/exams/:id/mark-sent', authenticate, teacherOnly, async (req, res) => {
  try {
    const { studentId, channel } = req.body || {};
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    if (!mongoose.Types.ObjectId.isValid(studentId)) return res.status(400).json({ error: 'Invalid studentId' });
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    const already = (exam.sentVia || []).some(e => String(e.studentId) === String(studentId));
    if (!already) {
      exam.sentVia.push({ studentId, channel: channel || 'whatsapp', sentAt: new Date() });
      await exam.save();
    }
    res.json({ ok: true, exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Teacher can roll back a delivery confirmation if they marked it by mistake.
app.post('/api/exams/:id/unmark-sent', authenticate, teacherOnly, async (req, res) => {
  try {
    const { studentId } = req.body || {};
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    exam.sentVia = (exam.sentVia || []).filter(e => String(e.studentId) !== String(studentId));
    await exam.save();
    res.json({ ok: true, exam });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Student / parent opens an exam — record the view so the teacher can see who saw it.
app.post('/api/exams/:id/mark-read', authenticate, async (req, res) => {
  try {
    let studentId = null;
    if (req.user.role === 'parent' || req.user.role === 'student') {
      studentId = req.user.studentId;
    } else if (req.user.role === 'teacher') {
      studentId = req.body?.studentId || null;
    }
    if (!studentId) return res.status(400).json({ error: 'studentId required' });
    const exam = await Exam.findById(req.params.id);
    if (!exam) return res.status(404).json({ error: 'Exam not found' });
    const already = (exam.readBy || []).some(e => String(e.studentId) === String(studentId));
    if (!already) {
      exam.readBy.push({ studentId, readAt: new Date() });
      await exam.save();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// PARENT ↔ TEACHER CHAT (WhatsApp-style two-way)
// Reuses ParentMessage schema with from/deletedBy fields added.
// ===========================
// Send a message — both teacher and parent can use this
app.post('/api/parent-chat/send', authenticate, async (req, res) => {
  try {
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Message required' });
    if (text.length > 2000) return res.status(400).json({ error: 'Message too long' });

    let studentId, studentName, from;
    if (req.user.role === 'parent') {
      studentId = req.user.studentId;
      from = 'parent';
      const s = await Student.findById(studentId).select('name');
      studentName = s?.name || 'Parent';
    } else if (req.user.role === 'teacher') {
      studentId = req.body.studentId;
      if (!studentId) return res.status(400).json({ error: 'studentId required for teacher messages' });
      from = 'teacher';
      const s = await Student.findById(studentId).select('name');
      studentName = s?.name || '';
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const msg = new ParentMessage({
      studentId,
      studentName,
      text,
      from, // 'parent' or 'teacher'
    });
    await msg.save();
    res.json({ ok: true, message: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get conversation for a specific parent (teacher passes studentId; parent uses their own)
app.get('/api/parent-chat/:studentId', authenticate, async (req, res) => {
  try {
    if (!parentScopeCheck(req, req.params.studentId)) {
      if (req.user.role !== 'teacher') return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = req.user.role === 'teacher' ? 'teacher' : 'parent';
    const messages = await ParentMessage.find({
      studentId: req.params.studentId,
      // hide messages the current user has deleted
      [`deletedBy.${userId}`]: { $ne: true }
    }).sort({ createdAt: 1 }).limit(500);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a message for current user only (other side still sees it)
app.post('/api/parent-chat/:id/delete', authenticate, async (req, res) => {
  try {
    const userId = req.user.role === 'teacher' ? 'teacher' : 'parent';
    const msg = await ParentMessage.findById(req.params.id);
    if (!msg) return res.status(404).json({ error: 'Not found' });
    // parent can only delete from their own conversation
    if (req.user.role === 'parent' && String(msg.studentId) !== String(req.user.studentId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const path = `deletedBy.${userId}`;
    await ParentMessage.updateOne({ _id: req.params.id }, { $set: { [path]: true } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List of parent conversations for teacher (one per student who has chatted)
app.get('/api/parent-chat-list', authenticate, teacherOnly, async (req, res) => {
  try {
    const msgs = await ParentMessage.aggregate([
      { $match: { 'deletedBy.teacher': { $ne: true } } },
      { $sort: { createdAt: -1 } },
      { $group: {
        _id: '$studentId',
        lastMessage: { $first: '$text' },
        lastFrom: { $first: '$from' },
        lastAt: { $first: '$createdAt' },
        unread: { $sum: { $cond: [{ $and: [{ $eq: ['$from', 'parent'] }, { $ne: ['$read', true] }] }, 1, 0] } },
      }},
      { $sort: { lastAt: -1 } },
    ]);
    // attach student info
    const ids = msgs.map(m => m._id);
    const students = await Student.find({ _id: { $in: ids } }).select('name photo rollNumber').lean();
    const map = Object.fromEntries(students.map(s => [String(s._id), s]));
    const result = msgs.map(m => ({
      ...m,
      student: map[String(m._id)] || { name: 'Unknown', _id: m._id }
    }));
    res.json({ conversations: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mark conversation as read (teacher only)
app.post('/api/parent-chat/:studentId/mark-read', authenticate, teacherOnly, async (req, res) => {
  try {
    await ParentMessage.updateMany(
      { studentId: req.params.studentId, from: 'parent', read: { $ne: true } },
      { $set: { read: true } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// AI ASSISTANT — Google Gemini (free, no SDK needed)
// ===========================

const buildAIContext = async (user) => {
  const cfg = await Config.findOne().select('-teacherPassword').lean();
  const lines = [];
  lines.push(`Coaching Center: ${cfg?.classroomName || 'Unknown'}`);
  if (cfg?.teacherName) lines.push(`Teacher: ${cfg.teacherName}`);
  lines.push(`Today (IST): ${istDateISO()}`);

  if (user.role === 'teacher') {
    const students = await Student.find({ pendingApproval: { $ne: true } }).select('name rollNumber className batchId subjects phone parentPhone birthday').lean();
    const totalCount = students.length;
    const byClass = {};
    students.forEach(s => { const k = s.className || 'Unassigned'; byClass[k] = (byClass[k] || 0) + 1; });
    lines.push(`Total students: ${totalCount}`);
    lines.push(`By class: ${Object.entries(byClass).map(([k,v]) => `${k}: ${v}`).join(', ')}`);
    if (cfg?.classes?.length) lines.push(`Classes & fees: ${cfg.classes.map(c => `${c.name} (INR ${c.monthlyFee}/mo)`).join('; ')}`);
    if (cfg?.batches?.length) lines.push(`Batches: ${cfg.batches.map(b => `${b.name} (${b.startTime}-${b.endTime})`).join('; ')}`);
    if (cfg?.subjects?.length) lines.push(`Subjects: ${cfg.subjects.map(s => s.name).join(', ')}`);
    const today = istDateISO();
    const todayAtt = await Attendance.find({ date: today }).lean();
    const present = todayAtt.filter(a => a.status === 'present').length;
    const absent  = todayAtt.filter(a => a.status === 'absent').length;
    lines.push(`Today: ${present} present, ${absent} absent, ${totalCount - todayAtt.length} not yet marked.`);
    lines.push('\nFull student roster:');
    students.slice(0, 200).forEach(s => {
      lines.push(`- ${s.name} (Roll ${s.rollNumber}) - Class: ${s.className || '-'}, Phone: ${s.phone || '-'}, Parent: ${s.parentPhone || '-'}, DOB: ${s.birthday || '-'}`);
    });
  } else if (user.role === 'parent' || user.role === 'student') {
    const s = await Student.findById(user.studentId).lean();
    if (!s) { lines.push('Student record not found.'); return lines.join('\n'); }
    const cls = cfg?.classes?.find(c => c.name === s.className);
    const batch = cfg?.batches?.find(b => String(b._id) === String(s.batchId));
    lines.push(`\nStudent: ${s.name} (Roll ${s.rollNumber})`);
    lines.push(`Class: ${s.className || '-'} (Monthly fee: INR ${cls?.monthlyFee || 0})`);
    if (batch) lines.push(`Batch: ${batch.name} (${batch.startTime}-${batch.endTime})`);
    if (s.subjects?.length) lines.push(`Subjects: ${s.subjects.join(', ')}`);
    if (s.birthday) lines.push(`Date of birth: ${s.birthday}`);
    const recent = await Attendance.find({ studentId: s._id }).sort({ date: -1 }).limit(14).lean();
    if (recent.length) {
      lines.push('Recent attendance:');
      recent.forEach(r => lines.push(`  ${r.date}: ${r.status}${r.inTime ? ` (in ${r.inTime})` : ''}${r.reason ? ` reason: ${r.reason}` : ''}`));
    }
  }
  return lines.join('\n');
};

app.post('/api/ai/chat', authenticate, async (req, res) => {
  try {
    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) {
      return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'Add GEMINI_API_KEY to your Render environment variables.' });
    }
    const userMessages = req.body.messages;
    if (!Array.isArray(userMessages) || !userMessages.length) {
      return res.status(400).json({ error: 'messages array required' });
    }
    const context = await buildAIContext(req.user);
    const roleLabel = req.user.role === 'teacher' ? 'the teacher' : (req.user.role === 'parent' ? 'a parent' : 'a student');
    const systemPrompt = `You are the friendly AI assistant for this coaching center. You are speaking with ${roleLabel}.
Reply in whatever language the user writes in (Hindi, Punjabi, English). Be concise and helpful.
Only use the data below - never invent details. For parents/students, only discuss their own information.

CURRENT DATA:
${context}`;

    const sanitized = userMessages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .slice(-20)
      .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content.slice(0, 4000) }] }));

    if (!sanitized.length || sanitized[sanitized.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'Last message must be from user' });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;
    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: sanitized,
      generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
    };

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini error:', response.status, errText);
      return res.status(500).json({ error: 'Gemini API error: ' + response.status });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '(no reply)';
    res.json({ reply: text.trim() });
  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: err.message || 'AI request failed' });
  }
});

// ===========================
// ===========================
// STORAGE STATS (MongoDB Atlas usage)
// ===========================
app.get('/api/storage', authenticate, teacherOnly, async (req, res) => {
  try {
    const db = mongoose.connection.db;
    const stats = await db.stats();
    // Collect per-collection sizes so the UI can render an iPhone-style breakdown.
    const collections = await db.listCollections().toArray();
    const perCollection = [];
    for (const c of collections) {
      try {
        const cs = await db.command({ collStats: c.name });
        perCollection.push({
          name: c.name,
          count: cs.count || 0,
          size: cs.size || 0,
          storageSize: cs.storageSize || 0,
          indexSize: cs.totalIndexSize || 0,
        });
      } catch (_) { /* ignore individual collection errors */ }
    }
    perCollection.sort((a, b) => b.size - a.size);

    // Atlas free tier (M0) cap is 512 MB. Configurable via env for paid tiers.
    const cap = Number(process.env.MONGO_STORAGE_CAP_MB || 512) * 1024 * 1024;
    res.json({
      dataSize: stats.dataSize || 0,
      indexSize: stats.indexSize || 0,
      storageSize: stats.storageSize || 0,
      totalUsed: (stats.dataSize || 0) + (stats.indexSize || 0),
      objects: stats.objects || 0,
      collections: stats.collections || 0,
      cap,
      perCollection,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===========================
// ONE-TIME MIGRATION (runs after connect)
// ===========================
mongoose.connection.once('open', async () => {
  try {
    const cfg = await Config.findOne();
    if (cfg) {
      // Flatten any legacy subjects ([String] or [{name, monthlyFee}]) to {name} only.
      if (Array.isArray(cfg.subjects) && cfg.subjects.length) {
        const needs = cfg.subjects.some(s => typeof s === 'string' || s?.monthlyFee !== undefined);
        if (needs) {
          cfg.subjects = cfg.subjects.map(s =>
            typeof s === 'string' ? { name: s } : { name: s.name }
          );
        }
      }
      // Strip removed password fields if they linger from a previous schema.
      if (cfg.studentPassword || cfg.parentPassword) {
        cfg.studentPassword = undefined;
        cfg.parentPassword = undefined;
        await Config.updateOne({ _id: cfg._id }, { $unset: { studentPassword: '', parentPassword: '' } });
      }
      await cfg.save();
      console.log('✓ Config migrated (subjects flattened, legacy passwords removed)');
    }
    // Backfill parentCode for existing students.
    const missing = await Student.find({ $or: [{ parentCode: { $exists: false } }, { parentCode: '' }, { parentCode: null }] });
    for (const s of missing) {
      s.parentCode = await ensureUniqueParentCode(s.name, s.parentPhone);
      if (!s.enrollmentDate) s.enrollmentDate = istDateISO();
      await s.save();
    }
    if (missing.length) console.log(`✓ Backfilled parentCode for ${missing.length} student(s)`);

    // Fix duplicate roll numbers
    const allStudents = await Student.find().sort({ joinDate: 1 });
    const seenRolls = new Set();
    let fixedRolls = 0;
    for (const s of allStudents) {
      const current = (s.rollNumber || '').trim();
      if (current && !seenRolls.has(current)) {
        seenRolls.add(current);
        continue;
      }
      // Need a new unique roll
      let n = allStudents.length + 1;
      while (seenRolls.has(String(n).padStart(3, '0'))) n++;
      const newRoll = String(n).padStart(3, '0');
      seenRolls.add(newRoll);
      s.rollNumber = newRoll;
      await s.save();
      fixedRolls++;
    }
    if (fixedRolls) console.log(`✓ Fixed ${fixedRolls} duplicate roll number(s)`);
  } catch (err) {
    console.error('Migration warning:', err.message);
  }
});

// ===========================
// SERVE FRONTEND (must be LAST)
// ===========================

app.use(express.static(path.join(__dirname, 'frontend/dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

app.listen(PORT, () => {
  console.log(`\n✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ Timezone: ${TIMEZONE}`);
  console.log('✓ API ready at /api/*\n');
});
