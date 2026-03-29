const express = require('express');
const path = require('path');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const multer = require('multer');
const bcrypt = require('bcryptjs');
const { pool, initDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;

// ===== Middleware =====
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('只支援 PDF 格式'), false);
  }
});

// Session
app.use(session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'linebank-portal-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24h
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.user) return next();
  res.status(401).json({ error: '請先登入' });
}

// =============================================
// AUTH API
// =============================================
app.post('/api/login', async (req, res) => {
  try {
    const { userId, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (rows.length === 0) return res.status(401).json({ error: '帳號不存在' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: '密碼錯誤' });

    req.session.user = {
      id: user.id, name: user.name, dept: user.dept,
      title: user.title, email: user.email, role: user.role
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '登入失敗' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) {
    res.json(req.session.user);
  } else {
    res.status(401).json({ error: '未登入' });
  }
});

// =============================================
// TRAINING API
// =============================================

// 取得所有課程 + 當前使用者完成狀態
app.get('/api/training/courses', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(`
      SELECT c.*,
        tr.score, tr.passed, tr.completed_at,
        (SELECT COUNT(*) FROM training_records r2 WHERE r2.course_id = c.id AND r2.passed = true) as completed_count,
        (SELECT COUNT(*) FROM users) as total_users
      FROM training_courses c
      LEFT JOIN training_records tr ON tr.course_id = c.id AND tr.user_id = $1
      ORDER BY c.category, c.name
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('Training courses error:', err);
    res.status(500).json({ error: '載入課程失敗' });
  }
});

// 當前使用者的訓練紀錄
app.get('/api/training/my-records', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(`
      SELECT c.id as course_id, c.name, c.category, c.passing_score,
        tr.score, tr.passed, tr.completed_at
      FROM training_courses c
      LEFT JOIN training_records tr ON tr.course_id = c.id AND tr.user_id = $1
      WHERE c.is_required = true
      ORDER BY c.category, c.name
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('My records error:', err);
    res.status(500).json({ error: '載入紀錄失敗' });
  }
});

// 提交測驗成績
app.post('/api/training/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { courseId, score } = req.body;

    // Get course passing score
    const { rows: courseRows } = await pool.query('SELECT passing_score FROM training_courses WHERE id = $1', [courseId]);
    if (courseRows.length === 0) return res.status(404).json({ error: '課程不存在' });

    const passed = score >= courseRows[0].passing_score;

    const { rows } = await pool.query(`
      INSERT INTO training_records (user_id, course_id, score, passed, completed_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (user_id, course_id)
      DO UPDATE SET score = GREATEST(training_records.score, $3),
                    passed = $4 OR training_records.passed,
                    completed_at = CASE WHEN $4 THEN NOW() ELSE training_records.completed_at END
      RETURNING *
    `, [userId, courseId, score, passed]);

    res.json({ success: true, record: rows[0], passed });
  } catch (err) {
    console.error('Submit training error:', err);
    res.status(500).json({ error: '提交失敗' });
  }
});

// 部門完成率統計 (admin/manager)
app.get('/api/training/stats', requireAuth, async (req, res) => {
  try {
    // 各部門完成率
    const { rows: deptStats } = await pool.query(`
      SELECT u.dept,
        COUNT(DISTINCT u.id) as total_users,
        COUNT(DISTINCT u.id) * (SELECT COUNT(*) FROM training_courses WHERE is_required = true) as total_required,
        COUNT(tr.id) FILTER (WHERE tr.passed = true) as completed
      FROM users u
      LEFT JOIN training_records tr ON tr.user_id = u.id
      GROUP BY u.dept
      ORDER BY (COUNT(tr.id) FILTER (WHERE tr.passed = true))::float /
               NULLIF(COUNT(DISTINCT u.id) * (SELECT COUNT(*) FROM training_courses WHERE is_required = true), 0) DESC
    `);

    // 各課程通過率
    const { rows: courseStats } = await pool.query(`
      SELECT c.id, c.name, c.category,
        (SELECT COUNT(*) FROM users) as total_users,
        COUNT(tr.id) as completed_count,
        COUNT(tr.id) FILTER (WHERE tr.passed = true) as passed_count,
        ROUND(AVG(tr.score), 1) as avg_score
      FROM training_courses c
      LEFT JOIN training_records tr ON tr.course_id = c.id
      WHERE c.is_required = true
      GROUP BY c.id, c.name, c.category
      ORDER BY c.category, c.name
    `);

    // 未完成人員
    const { rows: incomplete } = await pool.query(`
      SELECT u.id, u.name, u.dept,
        (SELECT COUNT(*) FROM training_courses WHERE is_required = true) as total_courses,
        COUNT(tr.id) FILTER (WHERE tr.passed = true) as completed,
        ARRAY_AGG(
          CASE WHEN tr.id IS NULL THEN c.name END
        ) FILTER (WHERE tr.id IS NULL) as missing_courses,
        ARRAY_AGG(
          CASE WHEN tr.id IS NULL THEN c.category END
        ) FILTER (WHERE tr.id IS NULL) as missing_categories
      FROM users u
      CROSS JOIN training_courses c
      LEFT JOIN training_records tr ON tr.user_id = u.id AND tr.course_id = c.id AND tr.passed = true
      WHERE c.is_required = true
      GROUP BY u.id, u.name, u.dept
      HAVING COUNT(tr.id) FILTER (WHERE tr.passed = true) < (SELECT COUNT(*) FROM training_courses WHERE is_required = true)
      ORDER BY COUNT(tr.id) FILTER (WHERE tr.passed = true) ASC
    `);

    res.json({ deptStats, courseStats, incomplete });
  } catch (err) {
    console.error('Training stats error:', err);
    res.status(500).json({ error: '統計載入失敗' });
  }
});

// =============================================
// CONTRACT AI PARSING API
// =============================================
app.post('/api/contracts/parse', requireAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '請上傳 PDF 檔案' });

    const pdfParse = require('pdf-parse');
    const pdfData = await pdfParse(req.file.buffer);
    const pdfText = pdfData.text;

    // Check if Claude API key is available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Fallback: return mock AI result with actual filename
      console.log('⚠️  No ANTHROPIC_API_KEY set, using mock AI response');
      return res.json({
        success: true,
        mode: 'demo',
        filename: req.file.originalname,
        pdfTextPreview: pdfText.substring(0, 500),
        parsed: {
          contract_no: 'C-2026-' + String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0'),
          vendor: extractGuess(pdfText, 'vendor') || '（AI 解析需要 API Key）',
          name: extractGuess(pdfText, 'name') || req.file.originalname.replace('.pdf', ''),
          amount: extractGuess(pdfText, 'amount') || 'NT$ 0',
          currency: 'TWD',
          period_start: new Date().toISOString().split('T')[0],
          period_end: new Date(Date.now() + 365 * 86400000).toISOString().split('T')[0],
          sign_date: new Date().toISOString().split('T')[0],
          payment_terms: '（需設定 ANTHROPIC_API_KEY 以啟用 AI 解析）',
          first_payment_date: '',
          contact_person: '',
          category: 'IT 軟體維護',
          confidence: 0
        }
      });
    }

    // Real Claude API call
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `你是一位銀行合約解析專家。請從以下合約文字中提取關鍵資訊，以 JSON 格式回覆。

合約內容：
${pdfText.substring(0, 8000)}

請回覆以下 JSON 格式（純 JSON，不要其他文字）：
{
  "vendor": "簽約對象公司名稱",
  "name": "合約名稱/標題",
  "amount": "合約金額（含幣別，如 NT$ 1,680,000）",
  "currency": "TWD 或 USD",
  "period_start": "合約起始日 YYYY-MM-DD",
  "period_end": "合約結束日 YYYY-MM-DD",
  "sign_date": "簽約日期 YYYY-MM-DD",
  "payment_terms": "付款條件描述",
  "first_payment_date": "首期付款日 YYYY-MM-DD",
  "contact_person": "聯絡人",
  "category": "合約分類（如：IT軟體維護、硬體採購、專業服務等）",
  "confidence": 0.95
}

如果某欄位無法辨識，填空字串。confidence 為 0-1 之間的數字，表示整體解析信心度。`
      }]
    });

    let parsed;
    try {
      const text = message.content[0].text;
      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch (e) {
      return res.status(500).json({ error: 'AI 回覆解析失敗', raw: message.content[0].text });
    }

    // Generate contract number
    parsed.contract_no = 'C-2026-' + String(Math.floor(Math.random() * 9000) + 1000).padStart(4, '0');

    res.json({
      success: true,
      mode: 'ai',
      filename: req.file.originalname,
      pdfTextPreview: pdfText.substring(0, 500),
      parsed
    });

  } catch (err) {
    console.error('Contract parse error:', err);
    res.status(500).json({ error: '合約解析失敗: ' + err.message });
  }
});

// Simple text extraction guess (fallback without API key)
function extractGuess(text, field) {
  if (!text) return '';
  if (field === 'amount') {
    const m = text.match(/(?:NT\$|NTD|新?臺?幣)\s?[\d,]+/i);
    return m ? m[0] : '';
  }
  if (field === 'vendor') {
    const m = text.match(/(?:甲方|乙方|立合約人|簽約對象)[：:]\s*(.+)/);
    return m ? m[1].trim().substring(0, 50) : '';
  }
  if (field === 'name') {
    const m = text.match(/(?:合約名稱|合約書|契約書)[：:]\s*(.+)/);
    return m ? m[1].trim().substring(0, 100) : '';
  }
  return '';
}

// 確認歸檔合約 + 建立付款排程
app.post('/api/contracts/confirm', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { parsed, paymentPlan } = req.body;

    // Parse amount to number
    let amountNum = 0;
    if (parsed.amount) {
      amountNum = parseFloat(parsed.amount.replace(/[^0-9.]/g, '')) || 0;
    }

    // Insert contract
    const { rows: contractRows } = await pool.query(`
      INSERT INTO contracts (contract_no, vendor, name, amount, currency, period_start, period_end,
        sign_date, payment_terms, first_payment_date, contact_person, category, ai_confidence, original_filename, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `, [
      parsed.contract_no, parsed.vendor, parsed.name, amountNum, parsed.currency || 'TWD',
      parsed.period_start || null, parsed.period_end || null, parsed.sign_date || null,
      parsed.payment_terms, parsed.first_payment_date || null, parsed.contact_person,
      parsed.category, parsed.confidence || 0, parsed.filename || '', userId
    ]);

    const contract = contractRows[0];

    // Insert payment schedules if provided
    if (paymentPlan && paymentPlan.length > 0) {
      for (const p of paymentPlan) {
        await pool.query(
          'INSERT INTO payment_schedules (contract_id, period, due_date, amount, description) VALUES ($1,$2,$3,$4,$5)',
          [contract.id, p.period, p.due_date, p.amount, p.description]
        );
      }
    }

    res.json({ success: true, contract });
  } catch (err) {
    console.error('Contract confirm error:', err);
    res.status(500).json({ error: '歸檔失敗: ' + err.message });
  }
});

// 取得合約列表
app.get('/api/contracts', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT c.*, u.name as created_by_name
      FROM contracts c
      LEFT JOIN users u ON u.id = c.created_by
      ORDER BY c.created_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    console.error('Contracts list error:', err);
    res.status(500).json({ error: '載入合約失敗' });
  }
});

// 取得單一合約 + 付款排程
app.get('/api/contracts/:id', requireAuth, async (req, res) => {
  try {
    const { rows: contractRows } = await pool.query('SELECT * FROM contracts WHERE id = $1', [req.params.id]);
    if (contractRows.length === 0) return res.status(404).json({ error: '合約不存在' });

    const { rows: payments } = await pool.query(
      'SELECT * FROM payment_schedules WHERE contract_id = $1 ORDER BY period',
      [req.params.id]
    );

    res.json({ contract: contractRows[0], payments });
  } catch (err) {
    res.status(500).json({ error: '載入合約失敗' });
  }
});

// =============================================
// LEAVE API
// =============================================

// 取得假別餘額
app.get('/api/leave/balances', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(
      'SELECT * FROM leave_balances WHERE user_id = $1 AND year = EXTRACT(YEAR FROM NOW()) ORDER BY leave_type',
      [userId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Leave balances error:', err);
    res.status(500).json({ error: '載入假別餘額失敗' });
  }
});

// 取得請假紀錄 (自己的)
app.get('/api/leave/my-records', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(`
      SELECT lr.*, d.name as deputy_name
      FROM leave_requests lr
      LEFT JOIN users d ON d.id = lr.deputy_id
      WHERE lr.user_id = $1
      ORDER BY lr.start_date DESC
      LIMIT 50
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('Leave records error:', err);
    res.status(500).json({ error: '載入請假紀錄失敗' });
  }
});

// 取得部門日曆（同部門所有人的請假）
app.get('/api/leave/calendar', requireAuth, async (req, res) => {
  try {
    const dept = req.session.user.dept;
    const month = req.query.month || new Date().toISOString().slice(0, 7); // YYYY-MM
    const { rows } = await pool.query(`
      SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.period, lr.days, lr.status,
             u.name as user_name, u.dept
      FROM leave_requests lr
      JOIN users u ON u.id = lr.user_id
      WHERE u.dept = $1
        AND lr.status IN ('approved','pending')
        AND lr.start_date <= ($2 || '-31')::date
        AND lr.end_date >= ($2 || '-01')::date
      ORDER BY lr.start_date
    `, [dept, month]);
    res.json(rows);
  } catch (err) {
    console.error('Leave calendar error:', err);
    res.status(500).json({ error: '載入部門日曆失敗' });
  }
});

// 取得可選代理人（同部門同事）
app.get('/api/leave/deputies', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(
      'SELECT id, name, title FROM users WHERE id != $1 ORDER BY name',
      [userId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: '載入代理人失敗' });
  }
});

// 送出請假申請
app.post('/api/leave/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { leaveType, startDate, endDate, period, days, deputyId, reason } = req.body;

    // Check balance
    const { rows: balRows } = await pool.query(
      'SELECT * FROM leave_balances WHERE user_id = $1 AND leave_type = $2 AND year = EXTRACT(YEAR FROM NOW())',
      [userId, leaveType]
    );

    if (balRows.length > 0) {
      const bal = balRows[0];
      const remaining = parseFloat(bal.total) - parseFloat(bal.used);
      if (remaining < parseFloat(days) && parseFloat(bal.total) > 0) {
        return res.status(400).json({ error: `${leaveType} 餘額不足，剩餘 ${remaining} ${bal.unit === 'hour' ? '小時' : '天'}` });
      }
    }

    // Insert request
    const { rows } = await pool.query(`
      INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, period, days, deputy_id, reason, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
      RETURNING *
    `, [userId, leaveType, startDate, endDate, period, days, deputyId, reason]);

    // Update balance (deduct used)
    await pool.query(
      `UPDATE leave_balances SET used = used + $3
       WHERE user_id = $1 AND leave_type = $2 AND year = EXTRACT(YEAR FROM NOW())`,
      [userId, leaveType, days]
    );

    res.json({ success: true, leave: rows[0] });
  } catch (err) {
    console.error('Leave submit error:', err);
    res.status(500).json({ error: '請假送出失敗: ' + err.message });
  }
});

// =============================================
// DIRECTORY API
// =============================================
app.get('/api/directory', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, dept, title, email, ext FROM users ORDER BY dept, name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: '載入通訊錄失敗' });
  }
});

// =============================================
// ANNOUNCEMENTS API
// =============================================
app.get('/api/announcements', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(`
      SELECT a.*, u.name as author_name, u.dept as author_dept,
        (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id) as read_count,
        (SELECT COUNT(*) FROM users) as total_users,
        EXISTS(SELECT 1 FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = $1) as is_read
      FROM announcements a
      LEFT JOIN users u ON u.id = a.author_id
      WHERE a.status = 'published'
      ORDER BY a.pinned DESC, a.created_at DESC
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('Announcements error:', err);
    res.status(500).json({ error: '載入公告失敗' });
  }
});

app.post('/api/announcements', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { category, title, content, target, pinned, requireRead, scheduledAt } = req.body;
    const status = scheduledAt ? 'scheduled' : 'published';
    const { rows } = await pool.query(`
      INSERT INTO announcements (category, title, content, author_id, target, pinned, require_read, status, scheduled_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *
    `, [category, title, content, userId, target || 'all', pinned || false, requireRead || false, status, scheduledAt || null]);
    res.json({ success: true, announcement: rows[0] });
  } catch (err) {
    console.error('Create announcement error:', err);
    res.status(500).json({ error: '發布公告失敗' });
  }
});

app.post('/api/announcements/:id/read', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    await pool.query(
      'INSERT INTO announcement_reads (announcement_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, userId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '標記失敗' });
  }
});

// =============================================
// MEETING ROOMS API
// =============================================
app.get('/api/rooms', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM meeting_rooms ORDER BY floor DESC, id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: '載入會議室失敗' });
  }
});

app.get('/api/rooms/bookings', requireAuth, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const { rows } = await pool.query(`
      SELECT rb.*, u.name as booked_by_name
      FROM room_bookings rb
      LEFT JOIN users u ON u.id = rb.booked_by
      WHERE rb.booking_date = $1
      ORDER BY rb.room_id, rb.start_time
    `, [date]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: '載入預約失敗' });
  }
});

app.post('/api/rooms/book', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { roomId, date, startTime, endTime, subject } = req.body;

    // Check for conflicts
    const { rows: conflicts } = await pool.query(`
      SELECT * FROM room_bookings
      WHERE room_id = $1 AND booking_date = $2
        AND start_time < $4 AND end_time > $3
    `, [roomId, date, startTime, endTime]);

    if (conflicts.length > 0) {
      return res.status(409).json({ error: '該時段已被預約', conflict: conflicts[0] });
    }

    const { rows } = await pool.query(`
      INSERT INTO room_bookings (room_id, booking_date, start_time, end_time, subject, booked_by)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
    `, [roomId, date, startTime, endTime, subject, userId]);

    res.json({ success: true, booking: rows[0] });
  } catch (err) {
    console.error('Room booking error:', err);
    res.status(500).json({ error: '預約失敗: ' + err.message });
  }
});

app.delete('/api/rooms/bookings/:id', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rowCount } = await pool.query(
      'DELETE FROM room_bookings WHERE id = $1 AND booked_by = $2',
      [req.params.id, userId]
    );
    if (rowCount === 0) return res.status(404).json({ error: '預約不存在或無權取消' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '取消失敗' });
  }
});

// =============================================
// APPROVALS API
// =============================================

// 待我簽核
app.get('/api/approvals/pending', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(`
      SELECT a.*, u.name as applicant_name, u.dept as applicant_dept,
        json_agg(json_build_object(
          'step_order', s.step_order, 'approver_id', s.approver_id,
          'approver_name', su.name, 'role_label', s.role_label,
          'status', s.status, 'comment', s.comment, 'acted_at', s.acted_at
        ) ORDER BY s.step_order) as steps
      FROM approvals a
      JOIN users u ON u.id = a.applicant_id
      JOIN approval_steps s ON s.approval_id = a.id
      JOIN users su ON su.id = s.approver_id
      WHERE a.status = 'pending'
        AND EXISTS (
          SELECT 1 FROM approval_steps cs
          WHERE cs.approval_id = a.id AND cs.approver_id = $1
            AND cs.step_order = a.current_step AND cs.status = 'pending'
        )
      GROUP BY a.id, u.name, u.dept
      ORDER BY CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, a.created_at DESC
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('Approvals pending error:', err);
    res.status(500).json({ error: '載入待簽核失敗' });
  }
});

// 我送出的
app.get('/api/approvals/sent', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows } = await pool.query(`
      SELECT a.*, u.name as applicant_name,
        json_agg(json_build_object(
          'step_order', s.step_order, 'approver_id', s.approver_id,
          'approver_name', su.name, 'role_label', s.role_label,
          'status', s.status, 'acted_at', s.acted_at
        ) ORDER BY s.step_order) as steps
      FROM approvals a
      JOIN users u ON u.id = a.applicant_id
      JOIN approval_steps s ON s.approval_id = a.id
      JOIN users su ON su.id = s.approver_id
      WHERE a.applicant_id = $1
      GROUP BY a.id, u.name
      ORDER BY a.created_at DESC
    `, [userId]);
    res.json(rows);
  } catch (err) {
    console.error('Approvals sent error:', err);
    res.status(500).json({ error: '載入送出簽核失敗' });
  }
});

// 已完成 (我簽核過的)
app.get('/api/approvals/history', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const typeFilter = req.query.type || '';
    const monthFilter = req.query.month || '';
    let extraWhere = '';
    const params = [userId];
    if (typeFilter) {
      params.push(typeFilter);
      extraWhere += ` AND a.type = $${params.length}`;
    }
    if (monthFilter) {
      params.push(monthFilter + '-01');
      params.push(monthFilter + '-31');
      extraWhere += ` AND my_step.acted_at >= $${params.length - 1}::date AND my_step.acted_at <= $${params.length}::date`;
    }
    const { rows } = await pool.query(`
      SELECT a.id, a.type, a.title, a.status, a.amount, a.currency,
        u.name as applicant_name, my_step.status as my_decision, my_step.acted_at,
        my_step.comment as my_comment
      FROM approvals a
      JOIN users u ON u.id = a.applicant_id
      JOIN approval_steps my_step ON my_step.approval_id = a.id AND my_step.approver_id = $1
      WHERE my_step.status IN ('approved','rejected')
        AND a.applicant_id != $1
        ${extraWhere}
      ORDER BY my_step.acted_at DESC
      LIMIT 50
    `, params);
    res.json(rows);
  } catch (err) {
    console.error('Approvals history error:', err);
    res.status(500).json({ error: '載入簽核歷史失敗' });
  }
});

// 簽核統計
app.get('/api/approvals/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { rows: pending } = await pool.query(`
      SELECT COUNT(*) FROM approvals a
      JOIN approval_steps s ON s.approval_id = a.id
      WHERE a.status = 'pending' AND s.approver_id = $1
        AND s.step_order = a.current_step AND s.status = 'pending'
    `, [userId]);
    const { rows: sent } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending') as in_progress,
              COUNT(*) FILTER (WHERE status = 'approved') as approved,
              COUNT(*) FILTER (WHERE status = 'rejected') as rejected
       FROM approvals WHERE applicant_id = $1`, [userId]);
    const { rows: history } = await pool.query(`
      SELECT COUNT(*) FROM approval_steps
      WHERE approver_id = $1 AND status IN ('approved','rejected')
    `, [userId]);
    res.json({
      pending: parseInt(pending[0].count),
      sentInProgress: parseInt(sent[0].in_progress),
      sentApproved: parseInt(sent[0].approved),
      sentRejected: parseInt(sent[0].rejected),
      historyCount: parseInt(history[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: '統計載入失敗' });
  }
});

// 核准
app.post('/api/approvals/:id/approve', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const approvalId = req.params.id;
    const { comment } = req.body || {};

    // Verify this user is the current step approver
    const { rows: approval } = await pool.query('SELECT * FROM approvals WHERE id = $1', [approvalId]);
    if (approval.length === 0) return res.status(404).json({ error: '簽核單不存在' });
    const appr = approval[0];
    if (appr.status !== 'pending') return res.status(400).json({ error: '此簽核單已結案' });

    const { rows: step } = await pool.query(
      'SELECT * FROM approval_steps WHERE approval_id = $1 AND step_order = $2 AND approver_id = $3 AND status = \'pending\'',
      [approvalId, appr.current_step, userId]
    );
    if (step.length === 0) return res.status(403).json({ error: '您不是目前的簽核人' });

    // Mark step as approved
    await pool.query(
      'UPDATE approval_steps SET status = \'approved\', comment = $3, acted_at = NOW() WHERE approval_id = $1 AND step_order = $2',
      [approvalId, appr.current_step, comment || null]
    );

    // Check if this was the last step
    if (appr.current_step >= appr.total_steps) {
      await pool.query('UPDATE approvals SET status = \'approved\', updated_at = NOW() WHERE id = $1', [approvalId]);
    } else {
      await pool.query('UPDATE approvals SET current_step = current_step + 1, updated_at = NOW() WHERE id = $1', [approvalId]);
    }

    res.json({ success: true, message: '已核准' });
  } catch (err) {
    console.error('Approve error:', err);
    res.status(500).json({ error: '簽核失敗' });
  }
});

// 退回
app.post('/api/approvals/:id/reject', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const approvalId = req.params.id;
    const { comment } = req.body || {};

    const { rows: approval } = await pool.query('SELECT * FROM approvals WHERE id = $1', [approvalId]);
    if (approval.length === 0) return res.status(404).json({ error: '簽核單不存在' });
    const appr = approval[0];
    if (appr.status !== 'pending') return res.status(400).json({ error: '此簽核單已結案' });

    const { rows: step } = await pool.query(
      'SELECT * FROM approval_steps WHERE approval_id = $1 AND step_order = $2 AND approver_id = $3 AND status = \'pending\'',
      [approvalId, appr.current_step, userId]
    );
    if (step.length === 0) return res.status(403).json({ error: '您不是目前的簽核人' });

    await pool.query(
      'UPDATE approval_steps SET status = \'rejected\', comment = $3, acted_at = NOW() WHERE approval_id = $1 AND step_order = $2',
      [approvalId, appr.current_step, comment || null]
    );
    await pool.query('UPDATE approvals SET status = \'rejected\', updated_at = NOW() WHERE id = $1', [approvalId]);

    res.json({ success: true, message: '已退回' });
  } catch (err) {
    console.error('Reject error:', err);
    res.status(500).json({ error: '退回失敗' });
  }
});

// =============================================
// SPA FALLBACK
// =============================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================
// START
// =============================================
initDB()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 LINE Bank Internal Portal running on port ${PORT}`);
      console.log(`   Database: ${process.env.DATABASE_URL ? 'Connected (env)' : 'Connected (default)'}`);
      console.log(`   Claude API: ${process.env.ANTHROPIC_API_KEY ? 'Configured ✅' : 'Not set (demo mode)'}`);
    });
  })
  .catch(err => {
    console.error('❌ Failed to initialize database:', err);
    process.exit(1);
  });
