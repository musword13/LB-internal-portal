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
      title: user.title, email: user.email, role: user.role,
      isDemo: false
    };
    // Audit log: login
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_name, dept, action, page, detail, ip_address, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [user.id, user.name, user.dept, '登入', 'login', '正式登入', req.ip, false]
    );
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
// APPROVALS API (Microsoft Teams Integration)
// =============================================

// Teams Webhook URL (設定在環境變數中)
const TEAMS_WEBHOOK = process.env.TEAMS_WEBHOOK_URL;

// Helper: 發送 Teams 通知
async function sendTeamsNotification(approver, requestType, requestData) {
  if (!TEAMS_WEBHOOK) {
    console.log('ℹ️  Teams webhook not configured');
    return null;
  }

  const message = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: `${requestType} 簽核申請`,
    themeColor: '0078d4',
    sections: [
      {
        activityTitle: `${requestType} 簽核申請`,
        activitySubtitle: `申請人：${requestData.requesterName}`,
        facts: [
          { name: '申請類型', value: requestType },
          { name: '部門', value: requestData.dept || 'N/A' },
          { name: '申請日期', value: new Date(requestData.createdAt).toLocaleDateString('zh-TW') },
          ...Object.entries(requestData.details || {}).map(([k, v]) => ({
            name: k,
            value: v
          }))
        ],
        markdown: true
      }
    ],
    potentialAction: [
      {
        '@type': 'OpenUri',
        name: '查看申請',
        targets: [{ os: 'default', uri: `${process.env.APP_URL}/approvals/${requestType}` }]
      },
      {
        '@type': 'Action.OpenUri',
        name: '批准',
        targets: [{ os: 'default', uri: `${process.env.APP_URL}/approvals/${requestType}/approve` }]
      },
      {
        '@type': 'Action.OpenUri',
        name: '拒絕',
        targets: [{ os: 'default', uri: `${process.env.APP_URL}/approvals/${requestType}/reject` }]
      }
    ]
  };

  try {
    const res = await fetch(TEAMS_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    return res.ok ? { success: true } : { success: false, error: await res.text() };
  } catch (err) {
    console.error('Teams notification error:', err);
    return null;
  }
}

// 取得簽核待辦清單
app.get('/api/approvals/pending', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, u.name as requester_name
      FROM approvals a
      LEFT JOIN users u ON u.id = a.approver_id
      WHERE a.status = 'pending' AND a.approver_id = $1
      ORDER BY a.created_at DESC
    `, [req.session.user.id]);
    res.json(rows);
  } catch (err) {
    console.error('Approvals error:', err);
    res.status(500).json({ error: '載入簽核清單失敗' });
  }
});

// 提交簽核
app.post('/api/approvals/submit', requireAuth, async (req, res) => {
  try {
    const { approvalId, status, comment } = req.body;
    const approverId = req.session.user.id;

    const { rows } = await pool.query(`
      UPDATE approvals
      SET status = $2, comment = $3, approver_id = $4, approved_at = NOW()
      WHERE id = $1
      RETURNING *
    `, [approvalId, status, comment, approverId]);

    if (rows.length === 0) return res.status(404).json({ error: '簽核紀錄不存在' });

    res.json({ success: true, approval: rows[0] });
  } catch (err) {
    console.error('Approval submit error:', err);
    res.status(500).json({ error: '簽核提交失敗' });
  }
});

// 發送簽核通知至 Teams
app.post('/api/approvals/notify-teams', requireAuth, async (req, res) => {
  try {
    const { requestType, requestId, approverList, requestData } = req.body;

    for (const approver of approverList) {
      await sendTeamsNotification(approver, requestType, {
        requesterName: req.session.user.name,
        dept: req.session.user.dept,
        createdAt: new Date(),
        details: requestData
      });
    }

    res.json({ success: true, message: `已發送 ${approverList.length} 個簽核通知至 Teams` });
  } catch (err) {
    console.error('Teams notification error:', err);
    res.status(500).json({ error: '發送通知失敗' });
  }
});

// =============================================
// DEMO LOGIN
// =============================================
app.post('/api/demo-login', async (req, res) => {
  try {
    // Default demo user: BK00013
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', ['BK00013']);
    if (rows.length === 0) return res.status(500).json({ error: 'Demo 使用者不存在' });
    const user = rows[0];
    req.session.user = {
      id: user.id, name: user.name, dept: user.dept,
      title: user.title, email: user.email, role: user.role,
      isDemo: true
    };
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_name, dept, action, page, detail, ip_address, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [user.id, user.name, user.dept, '登入', 'login', 'Demo 模式登入', req.ip, true]
    );
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error('Demo login error:', err);
    res.status(500).json({ error: 'Demo 登入失敗' });
  }
});

// =============================================
// AUDIT LOG API
// =============================================

// 記錄操作
app.post('/api/audit-log', requireAuth, async (req, res) => {
  try {
    const { action, page, detail } = req.body;
    const user = req.session.user;
    await pool.query(
      'INSERT INTO audit_logs (user_id, user_name, dept, action, page, detail, ip_address, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [user.id, user.name, user.dept, action, page, detail, req.ip, user.isDemo || false]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: '記錄失敗' });
  }
});

// 查詢稽核紀錄
app.get('/api/audit-logs', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { target, startDate, endDate, limit: queryLimit } = req.query;
    const lim = Math.min(parseInt(queryLimit) || 200, 1000);
    let query, params;

    // 部門主管 (role=admin 或 title 含 經理/副理/主管/總) 可以查看部門紀錄
    const isManager = user.role === 'admin' || /經理|副理|主管|總|協理/.test(user.title);

    if (isManager && target === 'dept') {
      query = `SELECT * FROM audit_logs WHERE dept = $1`;
      params = [user.dept];
    } else if (isManager && target && target !== 'self') {
      // 查看特定員工
      query = `SELECT * FROM audit_logs WHERE user_id = $1 AND dept = $2`;
      params = [target, user.dept];
    } else {
      // 查看自己
      query = `SELECT * FROM audit_logs WHERE user_id = $1`;
      params = [user.id];
    }

    if (startDate) {
      params.push(startDate);
      query += ` AND created_at >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate + ' 23:59:59');
      query += ` AND created_at <= $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT ${lim}`;
    const { rows } = await pool.query(query, params);
    res.json({ logs: rows, isManager });
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: '載入稽核紀錄失敗' });
  }
});

// 取得部門成員列表 (主管用)
app.get('/api/audit-logs/dept-members', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const isManager = user.role === 'admin' || /經理|副理|主管|總|協理/.test(user.title);
    if (!isManager) return res.json({ members: [] });
    const { rows } = await pool.query(
      'SELECT id, name, title FROM users WHERE dept = $1 ORDER BY name', [user.dept]
    );
    res.json({ members: rows });
  } catch (err) {
    res.status(500).json({ error: '載入失敗' });
  }
});

// 匯出 CSV
app.get('/api/audit-logs/export', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { target, startDate, endDate } = req.query;
    const isManager = user.role === 'admin' || /經理|副理|主管|總|協理/.test(user.title);

    let query, params;
    if (isManager && target === 'dept') {
      query = 'SELECT * FROM audit_logs WHERE dept = $1';
      params = [user.dept];
    } else if (isManager && target && target !== 'self') {
      query = 'SELECT * FROM audit_logs WHERE user_id = $1 AND dept = $2';
      params = [target, user.dept];
    } else {
      query = 'SELECT * FROM audit_logs WHERE user_id = $1';
      params = [user.id];
    }
    if (startDate) { params.push(startDate); query += ` AND created_at >= $${params.length}`; }
    if (endDate) { params.push(endDate + ' 23:59:59'); query += ` AND created_at <= $${params.length}`; }
    query += ' ORDER BY created_at DESC LIMIT 5000';

    const { rows } = await pool.query(query, params);

    const BOM = '\uFEFF';
    let csv = BOM + '時間,員工編號,姓名,部門,操作,頁面,詳情,模式\n';
    rows.forEach(r => {
      const time = new Date(r.created_at).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
      csv += `"${time}","${r.user_id}","${r.user_name}","${r.dept}","${r.action}","${r.page || ''}","${(r.detail || '').replace(/"/g, '""')}","${r.is_demo ? 'Demo' : '正式'}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=audit_log_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: '匯出失敗' });
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
