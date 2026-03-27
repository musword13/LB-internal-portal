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

  console.log('✅ Seed data inserted');
}

module.exports = { pool, initDB };
