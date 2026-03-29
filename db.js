const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://root:F86K2Nf0Trp9ZRbGyl4Du3xgm7t51iXM@43.167.239.6:31056/zeabur',
  ssl: false
});

// ===== Schema initialization =====
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      -- 使用者
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(20) PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        password_hash VARCHAR(100) NOT NULL,
        dept VARCHAR(50),
        title VARCHAR(50),
        email VARCHAR(100),
        ext VARCHAR(10),
        role VARCHAR(20) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- 合約
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        contract_no VARCHAR(30) UNIQUE,
        vendor VARCHAR(100),
        name VARCHAR(200),
        amount DECIMAL(15,2),
        currency VARCHAR(10) DEFAULT 'TWD',
        period_start DATE,
        period_end DATE,
        sign_date DATE,
        payment_terms TEXT,
        first_payment_date DATE,
        contact_person VARCHAR(100),
        category VARCHAR(50),
        status VARCHAR(20) DEFAULT 'active',
        ai_confidence DECIMAL(5,2),
        ai_raw_response JSONB,
        original_filename VARCHAR(200),
        created_by VARCHAR(20) REFERENCES users(id),
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- 付款排程
      CREATE TABLE IF NOT EXISTS payment_schedules (
        id SERIAL PRIMARY KEY,
        contract_id INT REFERENCES contracts(id),
        period INT,
        due_date DATE,
        amount DECIMAL(15,2),
        description VARCHAR(200),
        status VARCHAR(20) DEFAULT 'draft',
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- 教育訓練課程
      CREATE TABLE IF NOT EXISTS training_courses (
        id VARCHAR(50) PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(20) NOT NULL,
        description TEXT,
        duration_min INT DEFAULT 30,
        passing_score INT DEFAULT 70,
        quarter VARCHAR(10),
        deadline DATE,
        survey_url VARCHAR(500),
        is_required BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- 教育訓練紀錄
      CREATE TABLE IF NOT EXISTS training_records (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(20) REFERENCES users(id),
        course_id VARCHAR(50) REFERENCES training_courses(id),
        score INT,
        passed BOOLEAN,
        completed_at TIMESTAMP,
        UNIQUE(user_id, course_id)
      );

      -- 請假餘額
      CREATE TABLE IF NOT EXISTS leave_balances (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(20) REFERENCES users(id),
        leave_type VARCHAR(20) NOT NULL,
        total DECIMAL(5,1) NOT NULL,
        used DECIMAL(5,1) DEFAULT 0,
        unit VARCHAR(10) DEFAULT 'day',
        expire_date DATE,
        year INT DEFAULT EXTRACT(YEAR FROM NOW()),
        UNIQUE(user_id, leave_type, year)
      );

      -- 請假申請
      CREATE TABLE IF NOT EXISTS leave_requests (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(20) REFERENCES users(id),
        leave_type VARCHAR(20) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        period VARCHAR(10) DEFAULT 'full',
        days DECIMAL(5,1) NOT NULL,
        deputy_id VARCHAR(20) REFERENCES users(id),
        reason TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        reviewer_id VARCHAR(20) REFERENCES users(id),
        reviewed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- 公告
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        category VARCHAR(20) NOT NULL,
        title VARCHAR(200) NOT NULL,
        content TEXT,
        author_id VARCHAR(20) REFERENCES users(id),
        target VARCHAR(50) DEFAULT 'all',
        pinned BOOLEAN DEFAULT false,
        require_read BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'published',
        scheduled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- 公告閱讀紀錄
      CREATE TABLE IF NOT EXISTS announcement_reads (
        id SERIAL PRIMARY KEY,
        announcement_id INT REFERENCES announcements(id),
        user_id VARCHAR(20) REFERENCES users(id),
        read_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(announcement_id, user_id)
      );

      -- 會議室
      CREATE TABLE IF NOT EXISTS meeting_rooms (
        id VARCHAR(10) PRIMARY KEY,
        name VARCHAR(50),
        floor INT,
        capacity INT,
        equipment VARCHAR(200)
      );

      -- 會議室預約
      CREATE TABLE IF NOT EXISTS room_bookings (
        id SERIAL PRIMARY KEY,
        room_id VARCHAR(10) REFERENCES meeting_rooms(id),
        booking_date DATE NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        subject VARCHAR(200) NOT NULL,
        booked_by VARCHAR(20) REFERENCES users(id),
        attendees TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- 簽核主表
      CREATE TABLE IF NOT EXISTS approvals (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL,          -- leave, payment, it-request, contract, expense
        ref_id VARCHAR(50),                 -- 關聯原始單號
        title VARCHAR(200) NOT NULL,
        description TEXT,
        amount DECIMAL(15,2),
        currency VARCHAR(10) DEFAULT 'TWD',
        applicant_id VARCHAR(20) REFERENCES users(id),
        current_step INT DEFAULT 1,
        total_steps INT DEFAULT 2,
        status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, rejected
        priority VARCHAR(10) DEFAULT 'normal', -- normal, high, urgent
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- 簽核步驟
      CREATE TABLE IF NOT EXISTS approval_steps (
        id SERIAL PRIMARY KEY,
        approval_id INT REFERENCES approvals(id) ON DELETE CASCADE,
        step_order INT NOT NULL,
        approver_id VARCHAR(20) REFERENCES users(id),
        role_label VARCHAR(50),
        status VARCHAR(20) DEFAULT 'pending',  -- pending, approved, rejected, skipped
        comment TEXT,
        acted_at TIMESTAMP,
        UNIQUE(approval_id, step_order)
      );

      -- Session table for connect-pg-simple
      CREATE TABLE IF NOT EXISTS "session" (
        "sid" varchar NOT NULL COLLATE "default",
        "sess" json NOT NULL,
        "expire" timestamp(6) NOT NULL,
        CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
    `);

    console.log('✅ Database schema initialized');

    // Seed default data
    await seedData(client);

  } finally {
    client.release();
  }
}

async function seedData(client) {
  // Check if users exist
  const { rows } = await client.query('SELECT COUNT(*) FROM users');
  if (parseInt(rows[0].count) > 0) {
    console.log('ℹ️  Data already seeded, skipping');
    return;
  }

  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('1234', 10);

  // Seed users
  const users = [
    ['BK00013', '陳建宏', hash, '資訊部', '副理', 'ch.chen@linebank.com.tw', '5501', 'admin'],
    ['BK00001', '王志明', hash, '資訊部', '工程師', 'cm.wang@linebank.com.tw', '5510', 'user'],
    ['BK00002', '林佩珊', hash, '財務部', '經理', 'ps.lin@linebank.com.tw', '5201', 'user'],
    ['BK00003', '張雅琪', hash, '人資部', '專員', 'yc.chang@linebank.com.tw', '5301', 'user'],
    ['BK00004', '李建安', hash, '總務部', '副理', 'ja.lee@linebank.com.tw', '5101', 'user'],
    ['BK00005', '劉大衛', hash, '風管部', '資深專員', 'dw.liu@linebank.com.tw', '5601', 'user'],
    ['BK00006', '黃雅慧', hash, '法遵部', '經理', 'yh.huang@linebank.com.tw', '5701', 'user'],
    ['BK00007', '趙雅芳', hash, '行銷部', '專員', 'yf.zhao@linebank.com.tw', '5401', 'user'],
    ['BK00008', '周承翰', hash, '行銷部', '副理', 'ch.zhou@linebank.com.tw', '5402', 'user'],
    ['BK00009', '蔡宜庭', hash, '人資部', '經理', 'yt.tsai@linebank.com.tw', '5302', 'user'],
    ['BK00010', '劉家豪', hash, '客服部', '專員', 'jh.liu@linebank.com.tw', '5801', 'user'],
    ['BK00011', '陳柏翰', hash, '營運部', '副理', 'bh.chen@linebank.com.tw', '5901', 'user'],
    ['BK00012', '吳明哲', hash, '稽核室', '經理', 'mj.wu@linebank.com.tw', '5051', 'user'],
  ];

  for (const u of users) {
    await client.query(
      'INSERT INTO users (id, name, password_hash, dept, title, email, ext, role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING',
      u
    );
  }

  // Seed training courses
  const courses = [
    ['TC-COMP-001', '洗錢防制法規年度複訓', 'compliance', '依金管會規定，全行同仁每年須完成洗錢防制教育訓練', 40, 70, '2026Q1', '2026-03-31', null, true],
    ['TC-COMP-002', '個人資料保護法與客戶隱私規範', 'compliance', '個資法最新修正內容與銀行實務應用', 30, 70, '2026Q1', '2026-03-31', null, true],
    ['TC-COMP-003', '金融消費者保護法重點提醒', 'compliance', '金融消費者保護法重點條文與案例分析', 25, 70, '2026Q1', '2026-03-31', null, true],
    ['TC-SEC-001', '資訊安全意識提升 — 社交工程防範', 'security', '釣魚郵件辨識、社交工程攻擊防範實務', 35, 70, '2026Q1', '2026-03-31', null, true],
    ['TC-SEC-002', '營業秘密保護與資料分級管理', 'security', '資料分級制度與營業秘密保護義務', 30, 70, '2026Q1', '2026-03-31', null, true],
    ['TC-AUD-001', '內部稽核配合事項與自評程序', 'audit', '內部稽核流程、自評程序與常見缺失', 20, 70, '2026Q1', '2026-03-31', null, true],
  ];

  for (const c of courses) {
    await client.query(
      'INSERT INTO training_courses (id, name, category, description, duration_min, passing_score, quarter, deadline, survey_url, is_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING',
      c
    );
  }

  // Seed some training records (simulate partial completion)
  const records = [
    // 陳建宏 - 完成4門
    ['BK00013', 'TC-COMP-001', 92], ['BK00013', 'TC-SEC-001', 88],
    ['BK00013', 'TC-COMP-003', 85], ['BK00013', 'TC-AUD-001', 78],
    // 王志明 - 完成3門
    ['BK00001', 'TC-COMP-001', 90], ['BK00001', 'TC-SEC-001', 85], ['BK00001', 'TC-SEC-002', 82],
    // 林佩珊 - 完成5門
    ['BK00002', 'TC-COMP-001', 95], ['BK00002', 'TC-COMP-002', 88], ['BK00002', 'TC-COMP-003', 91],
    ['BK00002', 'TC-SEC-001', 87], ['BK00002', 'TC-AUD-001', 80],
    // 黃雅慧(法遵部) - 全部完成
    ['BK00006', 'TC-COMP-001', 98], ['BK00006', 'TC-COMP-002', 95], ['BK00006', 'TC-COMP-003', 96],
    ['BK00006', 'TC-SEC-001', 92], ['BK00006', 'TC-SEC-002', 90], ['BK00006', 'TC-AUD-001', 88],
    // 吳明哲(稽核室) - 全部完成
    ['BK00012', 'TC-COMP-001', 94], ['BK00012', 'TC-COMP-002', 91], ['BK00012', 'TC-COMP-003', 89],
    ['BK00012', 'TC-SEC-001', 86], ['BK00012', 'TC-SEC-002', 84], ['BK00012', 'TC-AUD-001', 95],
  ];

  for (const [userId, courseId, score] of records) {
    await client.query(
      `INSERT INTO training_records (user_id, course_id, score, passed, completed_at)
       VALUES ($1, $2, $3, $4, NOW() - interval '1 day' * (random()*20)::int)
       ON CONFLICT DO NOTHING`,
      [userId, courseId, score, score >= 70]
    );
  }

  // Seed leave balances for all users (2026)
  const leaveTypes = [
    ['annual', 15, 'day', '2026-12-31'],
    ['personal', 14, 'day', '2026-12-31'],
    ['sick', 30, 'day', '2026-12-31'],
    ['comp', 8, 'hour', '2026-06-30'],
    ['marriage', 8, 'day', null],
    ['funeral', 0, 'day', null],
    ['official', 0, 'day', null],
  ];
  for (const u of users) {
    for (const [lt, total, unit, exp] of leaveTypes) {
      await client.query(
        `INSERT INTO leave_balances (user_id, leave_type, total, used, unit, expire_date, year)
         VALUES ($1,$2,$3,0,$4,$5,2026) ON CONFLICT DO NOTHING`,
        [u[0], lt, total, unit, exp]
      );
    }
  }

  // Seed some leave usage for 陳建宏
  const leaveUsage = [
    ['BK00013', 'annual', 7], ['BK00013', 'personal', 2],
    ['BK00013', 'sick', 1], ['BK00013', 'comp', 2],
  ];
  for (const [uid, lt, used] of leaveUsage) {
    await client.query(
      `UPDATE leave_balances SET used=$3 WHERE user_id=$1 AND leave_type=$2 AND year=2026`,
      [uid, lt, used]
    );
  }

  // Seed leave requests
  const leaveRequests = [
    ['BK00013', 'annual', '2026-03-10', '2026-03-10', 'full', 1, 'BK00004', '個人事務', 'approved', 'BK00009'],
    ['BK00013', 'personal', '2026-02-20', '2026-02-20', 'morning', 0.5, 'BK00003', '家庭事務', 'approved', 'BK00009'],
    ['BK00013', 'annual', '2026-02-05', '2026-02-07', 'full', 3, 'BK00004', '出遊', 'approved', 'BK00009'],
    ['BK00013', 'sick', '2026-01-15', '2026-01-15', 'full', 1, 'BK00001', '感冒', 'approved', 'BK00009'],
    ['BK00013', 'annual', '2026-01-02', '2026-01-03', 'full', 2, 'BK00004', '元旦連假', 'approved', 'BK00009'],
    ['BK00013', 'personal', '2025-12-20', '2025-12-20', 'morning', 0.5, 'BK00003', '搬家', 'approved', 'BK00009'],
    // 張雅琪 pending leave
    ['BK00003', 'annual', '2026-03-28', '2026-03-30', 'full', 3, 'BK00004', '個人旅遊', 'pending', null],
    // 王志明 approved leave
    ['BK00001', 'personal', '2026-03-27', '2026-03-27', 'morning', 0.5, 'BK00013', '看診', 'approved', 'BK00009'],
    ['BK00001', 'annual', '2026-04-01', '2026-04-02', 'full', 2, 'BK00013', '清明連假', 'approved', 'BK00009'],
    ['BK00002', 'annual', '2026-04-03', '2026-04-04', 'full', 2, 'BK00006', '家庭旅遊', 'pending', null],
  ];
  for (const lr of leaveRequests) {
    await client.query(
      `INSERT INTO leave_requests (user_id, leave_type, start_date, end_date, period, days, deputy_id, reason, status, reviewer_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() - interval '1 day' * (random()*30)::int) ON CONFLICT DO NOTHING`,
      lr
    );
  }

  // Seed announcements
  const announcements = [
    ['緊急', '系統維護公告 — 核心系統 3/29 (六) 02:00-06:00 維護', '維護期間核心銀行系統、網路銀行暫停服務。請各單位提前做好準備。IT Helpdesk 分機 9999。', 'BK00013', 'all', true, false, 'published'],
    ['全行', '2026 年第一季營運會議紀要已公布', 'Q1 營運會議紀要已上傳文件庫，請各部門主管於本週五前完成檢閱。', 'BK00013', 'all', false, false, 'published'],
    ['人事', '2026 年員工旅遊活動報名開始', '今年員工旅遊 5/16-5/18，花蓮三日遊。請於 4/10 前完成報名。', 'BK00009', 'all', false, false, 'published'],
    ['教育訓練', '資訊安全意識培訓 — 4/2 (三) 14:00 必修', '依金管會規定，全行同仁需完成年度資安意識培訓。線上課程連結將於 4/1 開放。', 'BK00005', 'all', false, true, 'published'],
    ['行政', 'B1 停車場 4/1 起調整車位編號', '因大樓管委會重新規劃，B1 停車場將於 4/1 起調整車位編號，請同仁注意。', 'BK00004', 'all', false, false, 'published'],
    ['行政', '4 月份慶生會：4/11 (五) 15:00 交誼廳', '4 月壽星請於 4/8 前回覆是否出席，福委會已準備精美蛋糕。', 'BK00009', 'all', false, false, 'published'],
  ];
  for (let i = 0; i < announcements.length; i++) {
    const a = announcements[i];
    await client.query(
      `INSERT INTO announcements (category, title, content, author_id, target, pinned, require_read, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW() - interval '${i}' day - interval '${i * 3}' hour) ON CONFLICT DO NOTHING`,
      a
    );
  }

  // Seed meeting rooms
  const rooms = [
    ['3-1', '301會議室', 3, 20, '投影機、視訊設備'],
    ['3-2', '302會議室', 3, 12, '投影機'],
    ['3-3', '303會議室', 3, 8, '白板、視訊設備'],
    ['3-4', '304會議室', 3, 6, '白板'],
    ['2-2', '202會議室', 2, 6, ''],
    ['2-3', '203會議室', 2, 6, ''],
    ['2-4', '204會議室', 2, 8, ''],
    ['2-5', '205會議室', 2, 8, ''],
    ['2-6', '206會議室', 2, 10, '投影機'],
    ['2-7', '207會議室', 2, 10, '投影機'],
    ['2-8', '208會議室', 2, 6, ''],
    ['2-9', '209會議室', 2, 6, ''],
    ['2-10', '210會議室', 2, 12, '視訊設備'],
    ['2-11', '211會議室', 2, 8, ''],
    ['2-12', '212會議室', 2, 6, ''],
    ['2-13', '213會議室', 2, 15, '投影機、視訊設備'],
    ['2-14', '214會議室', 2, 20, '投影機、視訊設備、白板'],
  ];
  for (const r of rooms) {
    await client.query(
      'INSERT INTO meeting_rooms (id, name, floor, capacity, equipment) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      r
    );
  }

  // Seed room bookings for today and nearby dates
  const today = new Date().toISOString().slice(0, 10);
  const bookings = [
    ['3-1', today, '09:00', '11:00', 'Q1 營運會議', 'BK00013'],
    ['3-1', today, '13:00', '14:00', '部門周會', 'BK00013'],
    ['3-1', today, '15:00', '17:00', '專案檢討', 'BK00001'],
    ['3-2', today, '10:00', '11:00', '廠商拜訪 — 鼎新電腦', 'BK00004'],
    ['3-2', today, '13:00', '15:00', '資安演練', 'BK00005'],
    ['3-3', today, '09:00', '10:00', '1-on-1', 'BK00013'],
    ['3-3', today, '13:00', '14:00', '面試', 'BK00009'],
    ['3-4', today, '13:00', '15:00', 'Sprint Review', 'BK00001'],
    ['2-2', today, '09:00', '10:00', '晨會 — 法遵部', 'BK00006'],
    ['2-3', today, '13:00', '14:00', '1-on-1', 'BK00002'],
    ['2-4', today, '09:00', '11:00', '產品需求會議', 'BK00008'],
    ['2-4', today, '13:00', '15:00', 'UX Review — 設計部', 'BK00007'],
    ['2-5', today, '10:00', '12:00', '教育訓練', 'BK00009'],
    ['2-6', today, '09:00', '10:00', 'Standup — 開發團隊A', 'BK00001'],
    ['2-6', today, '13:00', '14:00', '廠商 Demo — AWS', 'BK00004'],
    ['2-7', today, '09:00', '12:00', '系統架構討論 — Infra', 'BK00001'],
    ['2-7', today, '15:00', '17:00', 'Code Review — 後端', 'BK00001'],
    ['2-10', today, '09:00', '11:00', '跨部門會議 — 營運部', 'BK00011'],
    ['2-11', today, '13:00', '14:00', '週報 — 風管部', 'BK00005'],
    ['2-13', today, '10:00', '12:00', '董事會預備會議', 'BK00013'],
    ['2-13', today, '13:00', '15:00', '客戶簡報 — 業務部', 'BK00007'],
    ['2-14', today, '09:00', '12:00', '全行月會', 'BK00013'],
    ['2-14', today, '14:00', '16:00', '資安教育訓練 — 全行', 'BK00005'],
  ];
  for (const b of bookings) {
    await client.query(
      'INSERT INTO room_bookings (room_id, booking_date, start_time, end_time, subject, booked_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
      b
    );
  }

  // Seed approvals (簽核中心)
  const approvalData = [
    // 1. 廠商付款 — 鼎新電腦
    { type: 'payment', ref_id: 'PAY-0325-003', title: '廠商付款 — 技術顧問費 (鼎新電腦)', desc: '2026 Q1 技術顧問服務費用', amount: 450000, currency: 'TWD', applicant: 'BK00002', steps: 4, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00002', role: '申請人', status: 'approved' },
        { approver: 'BK00004', role: '部門主管', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'pending' },
        { approver: 'BK00011', role: '最終核准', status: 'pending' },
      ]},
    // 2. IT需求 — 信用卡系統升級 (急件)
    { type: 'it-request', ref_id: 'REQ-042', title: 'IT 開發需求 — 信用卡系統升級', desc: '配合金管會新規，信用卡核卡流程需支援線上身分驗證(eKYC)，預估工時 320hr', amount: null, currency: 'TWD', applicant: 'BK00001', steps: 3, current: 2, priority: 'urgent',
      chain: [
        { approver: 'BK00001', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '資訊部副理', status: 'pending' },
        { approver: 'BK00011', role: '營運部副理', status: 'pending' },
      ]},
    // 3. 請假 — 張雅琪
    { type: 'leave', ref_id: 'LEAVE-0328', title: '請假申請 — 張雅琪 特休 3/28-3/30', desc: '特別休假 3 天，代理人：李建安，剩餘特休 5 天', amount: null, currency: 'TWD', applicant: 'BK00003', steps: 2, current: 2, priority: 'normal',
      chain: [
        { approver: 'BK00003', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '主管', status: 'pending' },
      ]},
    // 4. 合約續約 — IBM
    { type: 'contract', ref_id: 'CON-IBM-2026', title: '合約續約審核 — IBM 主機維護合約', desc: '年度合約 NT$3,200,000，漲幅 +3.2%，到期日 2026-04-15', amount: 3200000, currency: 'TWD', applicant: 'BK00004', steps: 3, current: 2, priority: 'normal',
      chain: [
        { approver: 'BK00004', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'pending' },
        { approver: 'BK00011', role: '最終核准', status: 'pending' },
      ]},
    // 5. 廠商付款 — AWS
    { type: 'payment', ref_id: 'PAY-0325-002', title: '廠商付款 — 雲端服務月費 (AWS)', desc: 'AWS 3月份雲端服務費用，合約 C-2026-0085', amount: 12500, currency: 'USD', applicant: 'BK00001', steps: 3, current: 2, priority: 'normal',
      chain: [
        { approver: 'BK00001', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'pending' },
        { approver: 'BK00011', role: '最終核准', status: 'pending' },
      ]},
    // 6-11: 我送出的 + 已完成 (by BK00013)
    { type: 'payment', ref_id: 'PAY-0320-001', title: 'Microsoft M365 授權年費', desc: '全行 M365 E5 授權年費', amount: 1800000, currency: 'TWD', applicant: 'BK00013', steps: 4, current: 4, priority: 'normal',
      chain: [
        { approver: 'BK00013', role: '申請人', status: 'approved' },
        { approver: 'BK00004', role: '總務部副理', status: 'approved' },
        { approver: 'BK00002', role: '財務部經理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'pending' },
      ]},
    { type: 'it-request', ref_id: 'REQ-038', title: '內網 SSO 整合 Azure AD', desc: '整合 Azure AD 單一登入', amount: null, currency: 'TWD', applicant: 'BK00013', steps: 4, current: 4, priority: 'normal',
      chain: [
        { approver: 'BK00013', role: '申請人', status: 'approved' },
        { approver: 'BK00001', role: '工程師', status: 'approved' },
        { approver: 'BK00005', role: '風管部', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
    { type: 'payment', ref_id: 'PAY-0315-001', title: 'Fortinet 防火牆維護', desc: '年度防火牆維護合約', amount: 680000, currency: 'TWD', applicant: 'BK00013', steps: 3, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00013', role: '申請人', status: 'approved' },
        { approver: 'BK00002', role: '財務部經理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
    { type: 'leave', ref_id: 'LEAVE-0310', title: '特休 3/10', desc: '特休一天', amount: null, currency: 'TWD', applicant: 'BK00013', steps: 2, current: 2, priority: 'normal',
      chain: [
        { approver: 'BK00013', role: '申請人', status: 'approved' },
        { approver: 'BK00009', role: '人資部經理', status: 'approved' },
      ]},
    // 已完成 (別人送出，BK00013 已簽過)
    { type: 'payment', ref_id: 'PAY-0323-001', title: '趨勢科技 資安軟體授權', desc: '年度資安軟體授權費', amount: 520000, currency: 'TWD', applicant: 'BK00001', steps: 3, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00001', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
    { type: 'payment', ref_id: 'PAY-0321-001', title: '中華電信 專線租賃 3月', desc: '月租專線費用', amount: 85000, currency: 'TWD', applicant: 'BK00003', steps: 3, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00003', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
    { type: 'it-request', ref_id: 'REQ-040', title: 'OTP 驗證機制強化', desc: '加強 OTP 驗證安全性', amount: null, currency: 'TWD', applicant: 'BK00004', steps: 3, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00004', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
    { type: 'leave', ref_id: 'LEAVE-0314', title: '李建安 特休 3/14', desc: '特休一天', amount: null, currency: 'TWD', applicant: 'BK00004', steps: 2, current: 2, priority: 'normal',
      chain: [
        { approver: 'BK00004', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '主管', status: 'approved' },
      ]},
    { type: 'payment', ref_id: 'PAY-0310-001', title: '鼎新電腦 ERP 客製開發', desc: 'ERP 客製模組開發費', amount: 920000, currency: 'TWD', applicant: 'BK00002', steps: 3, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00002', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
    { type: 'it-request', ref_id: 'REQ-037', title: '報表匯出效能優化', desc: '大量報表匯出效能改善', amount: null, currency: 'TWD', applicant: 'BK00001', steps: 3, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00001', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
    { type: 'payment', ref_id: 'PAY-0228-001', title: 'AWS 雲端服務 2月', desc: 'AWS 2月份雲端服務費用', amount: 11800, currency: 'USD', applicant: 'BK00001', steps: 3, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00001', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
    { type: 'contract', ref_id: 'CON-TREND-2026', title: '趨勢科技 合約續約', desc: '資安軟體合約續約', amount: 520000, currency: 'TWD', applicant: 'BK00005', steps: 3, current: 3, priority: 'normal',
      chain: [
        { approver: 'BK00005', role: '申請人', status: 'approved' },
        { approver: 'BK00013', role: '副理', status: 'approved' },
        { approver: 'BK00011', role: '最終核准', status: 'approved' },
      ]},
  ];

  for (let i = 0; i < approvalData.length; i++) {
    const a = approvalData[i];
    const allApproved = a.chain.every(s => s.status === 'approved');
    const status = allApproved ? 'approved' : 'pending';
    const daysAgo = (approvalData.length - i) * 2;
    const { rows: apRows } = await client.query(
      `INSERT INTO approvals (type, ref_id, title, description, amount, currency, applicant_id, current_step, total_steps, status, priority, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NOW() - interval '${daysAgo} days', NOW() - interval '${Math.max(0, daysAgo-1)} days')
       RETURNING id`,
      [a.type, a.ref_id, a.title, a.desc, a.amount, a.currency, a.applicant, a.current, a.steps, status, a.priority]
    );
    const approvalId = apRows[0].id;
    for (let j = 0; j < a.chain.length; j++) {
      const s = a.chain[j];
      const actedAt = s.status === 'approved' ? `NOW() - interval '${daysAgo - j} days'` : 'NULL';
      await client.query(
        `INSERT INTO approval_steps (approval_id, step_order, approver_id, role_label, status, acted_at)
         VALUES ($1, $2, $3, $4, $5, ${actedAt})
         ON CONFLICT DO NOTHING`,
        [approvalId, j + 1, s.approver, s.role, s.status]
      );
    }
  }

  console.log('✅ Seed data inserted');
}

module.exports = { pool, initDB };
