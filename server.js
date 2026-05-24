import express from 'express';
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

app.use(cors());
app.use(express.json());

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
const ExamSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  examDate: String, // YYYY-MM-DD
  studentIds: [{ type: mongoose.Schema.Types.ObjectId }], // empty = all students
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
  photo: String, // sender's profile photo (base64) stored at send time
  text: { type: String, required: true },
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
    const token = jwt.sign({ role: 'teacher' }, JWT_SECRET);
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
        const token = jwt.sign({ role: 'teacher' }, JWT_SECRET);
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
    // Teacher: only approved students in the main list
    const students = await Student.find({ pendingApproval: { $ne: true } }).sort({ name: 1 });
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
    const records = await Attendance.find({ studentId: req.params.studentId });
    const present = records.filter(r => r.status === 'present').length;
    const absent = records.filter(r => r.status === 'absent').length;
    const total = present + absent;
    const percentage = total ? Math.round((present / total) * 100) : 0;
    const absentDays = records
      .filter(r => r.status === 'absent')
      .map(r => ({ date: r.date, reason: r.reason || 'No reason given' }))
      .sort((a, b) => b.date.localeCompare(a.date));
    res.json({ present, absent, total, percentage, absentDays });
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
    const today = istDateISO();
    const { batchId } = req.body || {};
    const config = await Config.findOne();
    const filter = {};
    if (batchId) filter.batchId = batchId;
    const students = await Student.find(filter);
    let marked = 0;
    for (const s of students) {
      let att = await Attendance.findOne({ studentId: s._id, date: today });
      if (att && att.status === 'present') continue;
      if (!att) {
        att = new Attendance({ studentId: s._id, date: today });
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
    res.json({ ok: true, marked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- UNDO / UNMARK -----------------------------------------------------------
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

  // Manual fee per student (set by teacher when adding/editing the student).
  const monthlyFee = Number(student.monthlyFee) || 0;
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

app.get('/api/fees/summary', authenticate, teacherOnly, async (req, res) => {
  try {
    const yyyymm = req.query.month || istDateISO().substring(0, 7);
    const students = await Student.find().sort({ name: 1 });
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

app.put('/api/config', authenticate, teacherOnly, async (req, res) => {
  try {
    const config = await Config.findOne();
    if (!config) return res.status(404).json({ error: 'Not found' });
    const { teacherPassword, subjects, classes, batches, ...rest } = req.body;

    // Subjects are just names now.
    if (subjects !== undefined) {
      config.subjects = (subjects || []).map(s =>
        typeof s === 'string' ? { name: s } : { name: s.name }
      );
    }
    // Classes carry the monthly fee.
    if (classes !== undefined) {
      config.classes = (classes || []).map(c => ({
        _id: c._id,
        name: c.name,
        monthlyFee: Number(c.monthlyFee) || 0,
      }));
    }
    if (batches !== undefined) {
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
    const text = (req.body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Empty message' });
    if (text.length > 1000) return res.status(400).json({ error: 'Too long (max 1000 chars)' });
    let name = 'Teacher';
    let rollNumber = '';
    let studentId = null;
    let photo = '';
    if (req.user.role === 'student') {
      const s = await Student.findById(req.user.studentId).select('name rollNumber photo');
      if (!s) return res.status(404).json({ error: 'Student not found' });
      name = s.name;
      rollNumber = s.rollNumber;
      studentId = req.user.studentId;
      photo = s.photo || '';
    } else {
      const cfg = await Config.findOne().select('teacherName');
      name = cfg?.teacherName || 'Teacher';
    }
    const msg = new ChatMessage({
      role: req.user.role, studentId, name, rollNumber, photo, text,
    });
    await msg.save();
    res.json({ ok: true, message: msg });
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
    const students = await Student.find({ pendingApproval: { $ne: true }, monthlyFee: { $gt: 0 } }).select('name rollNumber monthlyFee feeDueDay parentPhone parentName photo className');
    const paid = await FeePayment.find({ month: yyyymm });
    const paidIds = new Set(paid.map(p => String(p.studentId)));
    const today = new Date();
    const todayDay = today.getDate();
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

// For parent: see if their child has fees pending and how many days till due
app.get('/api/fees/my-status', authenticate, async (req, res) => {
  try {
    if (!['parent', 'student'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
    const s = await Student.findById(req.user.studentId);
    if (!s || !s.monthlyFee || s.monthlyFee <= 0) return res.json({ hasFee: false });
    const yyyymm = istDateISO().substring(0, 7);
    const paid = await FeePayment.findOne({ studentId: s._id, month: yyyymm });
    const today = new Date();
    const todayDay = today.getDate();
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
