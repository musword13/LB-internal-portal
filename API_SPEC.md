# LINE Bank Internal Portal — API Specification

> **Version:** 1.0.0
> **Base URL:** `https://lbinternal.zeabur.app` (Production) / `http://localhost:8080` (Development)
> **Last Updated:** 2026-03-29
> **Total APIs:** 30 endpoints

---

## Table of Contents

| # | Module | Endpoints | Status |
|---|--------|-----------|--------|
| 1 | [Authentication](#1-authentication) | 3 | Implemented |
| 2 | [Training (教育訓練)](#2-training-教育訓練) | 4 | Implemented |
| 3 | [Contracts (合約管理)](#3-contracts-合約管理) | 4 | Implemented |
| 4 | [Leave (請假管理)](#4-leave-請假管理) | 5 | Implemented |
| 5 | [Directory (員工通訊錄)](#5-directory-員工通訊錄) | 1 | Implemented |
| 6 | [Announcements (公告欄)](#6-announcements-公告欄) | 3 | Implemented |
| 7 | [Meeting Rooms (會議室預約)](#7-meeting-rooms-會議室預約) | 4 | Implemented |
| 8 | [Approvals (簽核中心)](#8-approvals-簽核中心) | 6 | Implemented |

---

## Common

### Authentication

除 `POST /api/login` 外，所有 API 均需登入 Session。未登入時回傳：

```json
{ "error": "請先登入" }
```

**HTTP Status:** `401 Unauthorized`

### Error Response Format

所有錯誤均回傳：

```json
{ "error": "錯誤訊息描述" }
```

### Session

- 機制：Server-side session (connect-pg-simple)
- Cookie 有效期：24 小時
- Session 儲存於 PostgreSQL `session` table

---

## 1. Authentication

### 1.1 POST /api/login

登入系統，建立 Session。

**Auth Required:** No

**Request Body:**
```json
{
  "userId": "BK00013",      // string, required — 員工編號
  "password": "1234"         // string, required — 密碼
}
```

**Response (200):**
```json
{
  "success": true,
  "user": {
    "id": "BK00013",
    "name": "陳建宏",
    "dept": "資訊部",
    "title": "副理",
    "email": "ch.chen@linebank.com.tw",
    "role": "admin"           // "admin" | "user"
  }
}
```

**Error (401):**
```json
{ "error": "帳號不存在" }
// or
{ "error": "密碼錯誤" }
```

---

### 1.2 POST /api/logout

登出系統，銷毀 Session。

**Auth Required:** No

**Request Body:** None

**Response (200):**
```json
{ "success": true }
```

---

### 1.3 GET /api/me

取得當前登入使用者資訊。

**Auth Required:** Yes (Session)

**Request:** None

**Response (200):**
```json
{
  "id": "BK00013",
  "name": "陳建宏",
  "dept": "資訊部",
  "title": "副理",
  "email": "ch.chen@linebank.com.tw",
  "role": "admin"
}
```

**Error (401):**
```json
{ "error": "未登入" }
```

---

## 2. Training (教育訓練)

### 2.1 GET /api/training/courses

取得所有課程清單，含當前使用者完成狀態與全行通過率。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<Course>`
```json
[
  {
    "id": "TC-COMP-001",
    "name": "洗錢防制法規年度複訓",
    "category": "compliance",        // "compliance" | "security" | "audit"
    "description": "依金管會規定...",
    "duration_min": 40,
    "passing_score": 70,
    "quarter": "2026Q1",
    "deadline": "2026-03-31",
    "survey_url": null,
    "is_required": true,
    "created_at": "2026-03-29T...",
    "score": 92,                     // number | null — 當前使用者分數
    "passed": true,                  // boolean | null
    "completed_at": "2026-03-15T...",// timestamp | null
    "completed_count": "10",         // string(count) — 全行通過人數
    "total_users": "13"              // string(count) — 全行總人數
  }
]
```

---

### 2.2 GET /api/training/my-records

取得當前使用者的必修課程完成狀態。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<Record>`
```json
[
  {
    "course_id": "TC-COMP-001",
    "name": "洗錢防制法規年度複訓",
    "category": "compliance",
    "passing_score": 70,
    "score": 92,               // number | null
    "passed": true,            // boolean | null
    "completed_at": "2026-03-15T..."  // timestamp | null
  }
]
```

---

### 2.3 POST /api/training/submit

提交測驗成績。採 UPSERT 邏輯：已有紀錄時保留最高分。

**Auth Required:** Yes

**Request Body:**
```json
{
  "courseId": "TC-COMP-001",   // string, required — 課程 ID
  "score": 85                  // number, required — 測驗分數 (0-100)
}
```

**Response (200):**
```json
{
  "success": true,
  "record": {
    "id": 1,
    "user_id": "BK00013",
    "course_id": "TC-COMP-001",
    "score": 92,               // 保留歷史最高分
    "passed": true,
    "completed_at": "2026-03-29T..."
  },
  "passed": true
}
```

**Error (404):**
```json
{ "error": "課程不存在" }
```

---

### 2.4 GET /api/training/stats

取得全行教育訓練統計（部門完成率、課程通過率、未完成人員）。

**Auth Required:** Yes

**Request:** None

**Response (200):**
```json
{
  "deptStats": [
    {
      "dept": "法遵部",
      "total_users": "1",
      "total_required": "6",
      "completed": "6"
    }
  ],
  "courseStats": [
    {
      "id": "TC-COMP-001",
      "name": "洗錢防制法規年度複訓",
      "category": "compliance",
      "total_users": "13",
      "completed_count": "5",
      "passed_count": "5",
      "avg_score": "93.8"
    }
  ],
  "incomplete": [
    {
      "id": "BK00007",
      "name": "趙雅芳",
      "dept": "行銷部",
      "total_courses": "6",
      "completed": "0",
      "missing_courses": ["洗錢防制法規年度複訓", "..."],
      "missing_categories": ["compliance", "..."]
    }
  ]
}
```

---

## 3. Contracts (合約管理)

### 3.1 POST /api/contracts/parse

上傳 PDF 合約，使用 AI (Claude) 自動解析欄位。若未設定 `ANTHROPIC_API_KEY` 則回傳 Demo 模式結果。

**Auth Required:** Yes

**Request:** `multipart/form-data`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File (PDF) | Yes | 合約 PDF 檔案，上限 50MB |

**Response (200) — AI Mode:**
```json
{
  "success": true,
  "mode": "ai",                      // "ai" | "demo"
  "filename": "contract.pdf",
  "pdfTextPreview": "合約前 500 字...",
  "parsed": {
    "contract_no": "C-2026-1234",
    "vendor": "鼎新電腦股份有限公司",
    "name": "ERP 系統客製開發合約",
    "amount": "NT$ 1,680,000",
    "currency": "TWD",               // "TWD" | "USD"
    "period_start": "2026-01-01",
    "period_end": "2026-12-31",
    "sign_date": "2025-12-15",
    "payment_terms": "分四期，每季支付 25%",
    "first_payment_date": "2026-01-15",
    "contact_person": "王經理",
    "category": "IT 軟體維護",
    "confidence": 0.92
  }
}
```

**Error (400):**
```json
{ "error": "請上傳 PDF 檔案" }
```

---

### 3.2 POST /api/contracts/confirm

確認歸檔合約並建立付款排程。

**Auth Required:** Yes

**Request Body:**
```json
{
  "parsed": {
    "contract_no": "C-2026-1234",
    "vendor": "鼎新電腦",
    "name": "ERP 客製開發",
    "amount": "NT$ 1,680,000",
    "currency": "TWD",
    "period_start": "2026-01-01",
    "period_end": "2026-12-31",
    "sign_date": "2025-12-15",
    "payment_terms": "分四期",
    "first_payment_date": "2026-01-15",
    "contact_person": "王經理",
    "category": "IT 軟體維護",
    "confidence": 0.92,
    "filename": "contract.pdf"
  },
  "paymentPlan": [                   // optional — 付款排程
    {
      "period": 1,
      "due_date": "2026-01-15",
      "amount": 420000,
      "description": "第一期款"
    }
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "contract": {
    "id": 1,
    "contract_no": "C-2026-1234",
    "vendor": "鼎新電腦",
    "name": "ERP 客製開發",
    "amount": "1680000.00",
    "currency": "TWD",
    "status": "active",
    "created_by": "BK00013",
    "created_at": "2026-03-29T..."
  }
}
```

---

### 3.3 GET /api/contracts

取得合約列表（最近 50 筆）。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<Contract>`
```json
[
  {
    "id": 1,
    "contract_no": "C-2026-1234",
    "vendor": "鼎新電腦",
    "name": "ERP 客製開發",
    "amount": "1680000.00",
    "currency": "TWD",
    "period_start": "2026-01-01",
    "period_end": "2026-12-31",
    "sign_date": "2025-12-15",
    "payment_terms": "分四期",
    "first_payment_date": "2026-01-15",
    "contact_person": "王經理",
    "category": "IT 軟體維護",
    "status": "active",
    "ai_confidence": "0.92",
    "original_filename": "contract.pdf",
    "created_by": "BK00013",
    "created_by_name": "陳建宏",
    "created_at": "2026-03-29T..."
  }
]
```

---

### 3.4 GET /api/contracts/:id

取得單一合約詳情 + 付款排程。

**Auth Required:** Yes

**Path Params:**
| Param | Type | Description |
|-------|------|-------------|
| id | number | 合約 ID (auto-increment) |

**Response (200):**
```json
{
  "contract": {
    "id": 1,
    "contract_no": "C-2026-1234",
    "vendor": "鼎新電腦",
    "name": "ERP 客製開發",
    "amount": "1680000.00",
    "currency": "TWD",
    "period_start": "2026-01-01",
    "period_end": "2026-12-31",
    "status": "active",
    "ai_confidence": "0.92"
  },
  "payments": [
    {
      "id": 1,
      "contract_id": 1,
      "period": 1,
      "due_date": "2026-01-15",
      "amount": "420000.00",
      "description": "第一期款",
      "status": "draft",
      "created_at": "2026-03-29T..."
    }
  ]
}
```

**Error (404):**
```json
{ "error": "合約不存在" }
```

---

## 4. Leave (請假管理)

### 4.1 GET /api/leave/balances

取得當前使用者今年度的各假別餘額。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<Balance>`
```json
[
  {
    "id": 1,
    "user_id": "BK00013",
    "leave_type": "annual",         // "annual"|"personal"|"sick"|"comp"|"marriage"|"funeral"|"official"
    "total": "15.0",
    "used": "7.0",
    "unit": "day",                  // "day" | "hour"
    "expire_date": "2026-12-31",
    "year": 2026
  }
]
```

---

### 4.2 GET /api/leave/my-records

取得當前使用者的請假紀錄（最近 50 筆）。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<LeaveRequest>`
```json
[
  {
    "id": 1,
    "user_id": "BK00013",
    "leave_type": "annual",
    "start_date": "2026-03-10",
    "end_date": "2026-03-10",
    "period": "full",               // "full" | "morning" | "afternoon"
    "days": "1.0",
    "deputy_id": "BK00004",
    "deputy_name": "李建安",
    "reason": "個人事務",
    "status": "approved",           // "pending" | "approved" | "rejected"
    "reviewer_id": "BK00009",
    "reviewed_at": null,
    "created_at": "2026-03-07T..."
  }
]
```

---

### 4.3 GET /api/leave/calendar

取得同部門同仁的請假日曆（指定月份）。

**Auth Required:** Yes

**Query Params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| month | string | 當月 | 月份，格式 `YYYY-MM` |

**Response (200):** `Array<CalendarEntry>`
```json
[
  {
    "id": 1,
    "leave_type": "annual",
    "start_date": "2026-03-10",
    "end_date": "2026-03-10",
    "period": "full",
    "days": "1.0",
    "status": "approved",
    "user_name": "陳建宏",
    "dept": "資訊部"
  }
]
```

---

### 4.4 GET /api/leave/deputies

取得可選代理人清單（排除自己的所有同仁）。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<Deputy>`
```json
[
  {
    "id": "BK00001",
    "name": "王志明",
    "title": "工程師"
  }
]
```

---

### 4.5 POST /api/leave/submit

送出請假申請。系統會先檢查餘額，通過後扣減已使用天數。

**Auth Required:** Yes

**Request Body:**
```json
{
  "leaveType": "annual",            // string, required
  "startDate": "2026-04-10",        // string (YYYY-MM-DD), required
  "endDate": "2026-04-11",          // string (YYYY-MM-DD), required
  "period": "full",                 // "full" | "morning" | "afternoon", required
  "days": 2,                        // number, required
  "deputyId": "BK00004",            // string, required — 代理人員工編號
  "reason": "個人旅遊"              // string, optional
}
```

**Response (200):**
```json
{
  "success": true,
  "leave": {
    "id": 11,
    "user_id": "BK00013",
    "leave_type": "annual",
    "start_date": "2026-04-10",
    "end_date": "2026-04-11",
    "period": "full",
    "days": "2.0",
    "deputy_id": "BK00004",
    "reason": "個人旅遊",
    "status": "pending",
    "created_at": "2026-03-29T..."
  }
}
```

**Error (400):**
```json
{ "error": "annual 餘額不足，剩餘 1 天" }
```

---

## 5. Directory (員工通訊錄)

### 5.1 GET /api/directory

取得全行員工通訊錄。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<Employee>`
```json
[
  {
    "id": "BK00013",
    "name": "陳建宏",
    "dept": "資訊部",
    "title": "副理",
    "email": "ch.chen@linebank.com.tw",
    "ext": "5501"
  }
]
```

---

## 6. Announcements (公告欄)

### 6.1 GET /api/announcements

取得所有已發布公告，含閱讀統計與當前使用者已讀狀態。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<Announcement>`
```json
[
  {
    "id": 1,
    "category": "緊急",             // "緊急"|"全行"|"人事"|"教育訓練"|"行政"
    "title": "系統維護公告 — 核心系統 3/29 維護",
    "content": "維護期間核心銀行系統...",
    "author_id": "BK00013",
    "author_name": "陳建宏",
    "author_dept": "資訊部",
    "target": "all",
    "pinned": true,
    "require_read": false,
    "status": "published",
    "scheduled_at": null,
    "created_at": "2026-03-29T...",
    "read_count": "8",              // string(count)
    "total_users": "13",            // string(count)
    "is_read": true                 // boolean — 當前使用者是否已讀
  }
]
```

---

### 6.2 POST /api/announcements

發布新公告。

**Auth Required:** Yes

**Request Body:**
```json
{
  "category": "全行",               // string, required
  "title": "2026 年端午節放假公告",  // string, required
  "content": "依行政院公告...",      // string, optional
  "target": "all",                  // string, optional, default "all"
  "pinned": false,                  // boolean, optional
  "requireRead": true,              // boolean, optional
  "scheduledAt": null               // string (ISO timestamp) | null, optional — 排程發布時間
}
```

**Response (200):**
```json
{
  "success": true,
  "announcement": {
    "id": 7,
    "category": "全行",
    "title": "2026 年端午節放假公告",
    "content": "依行政院公告...",
    "author_id": "BK00013",
    "target": "all",
    "pinned": false,
    "require_read": true,
    "status": "published",           // "published" | "scheduled"
    "created_at": "2026-03-29T..."
  }
}
```

---

### 6.3 POST /api/announcements/:id/read

標記公告為已讀。冪等操作（重複呼叫不會報錯）。

**Auth Required:** Yes

**Path Params:**
| Param | Type | Description |
|-------|------|-------------|
| id | number | 公告 ID |

**Request Body:** None

**Response (200):**
```json
{ "success": true }
```

---

## 7. Meeting Rooms (會議室預約)

### 7.1 GET /api/rooms

取得所有會議室清單。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<Room>`
```json
[
  {
    "id": "3-1",
    "name": "301會議室",
    "floor": 3,
    "capacity": 20,
    "equipment": "投影機、視訊設備"
  }
]
```

---

### 7.2 GET /api/rooms/bookings

取得指定日期的所有會議室預約。

**Auth Required:** Yes

**Query Params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| date | string | 今天 | 日期，格式 `YYYY-MM-DD` |

**Response (200):** `Array<Booking>`
```json
[
  {
    "id": 1,
    "room_id": "3-1",
    "booking_date": "2026-03-29",
    "start_time": "09:00:00",
    "end_time": "11:00:00",
    "subject": "Q1 營運會議",
    "booked_by": "BK00013",
    "booked_by_name": "陳建宏",
    "attendees": null,
    "created_at": "2026-03-29T..."
  }
]
```

---

### 7.3 POST /api/rooms/book

預約會議室。系統會自動檢查時段衝突。

**Auth Required:** Yes

**Request Body:**
```json
{
  "roomId": "3-1",                  // string, required — 會議室 ID
  "date": "2026-04-01",             // string (YYYY-MM-DD), required
  "startTime": "14:00",             // string (HH:MM), required
  "endTime": "15:00",               // string (HH:MM), required
  "subject": "部門周會"             // string, required
}
```

**Response (200):**
```json
{
  "success": true,
  "booking": {
    "id": 24,
    "room_id": "3-1",
    "booking_date": "2026-04-01",
    "start_time": "14:00:00",
    "end_time": "15:00:00",
    "subject": "部門周會",
    "booked_by": "BK00013",
    "created_at": "2026-03-29T..."
  }
}
```

**Error (409) — 時段衝突:**
```json
{
  "error": "該時段已被預約",
  "conflict": {
    "id": 1,
    "room_id": "3-1",
    "start_time": "13:00:00",
    "end_time": "15:00:00",
    "subject": "部門周會"
  }
}
```

---

### 7.4 DELETE /api/rooms/bookings/:id

取消自己的會議室預約。僅能取消自己建立的預約。

**Auth Required:** Yes

**Path Params:**
| Param | Type | Description |
|-------|------|-------------|
| id | number | 預約 ID |

**Request Body:** None

**Response (200):**
```json
{ "success": true }
```

**Error (404):**
```json
{ "error": "預約不存在或無權取消" }
```

---

## 8. Approvals (簽核中心)

### 8.1 GET /api/approvals/pending

取得當前使用者待簽核的項目，含完整簽核鏈。按優先級排序（urgent > high > normal）。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<ApprovalWithSteps>`
```json
[
  {
    "id": 2,
    "type": "it-request",           // "payment"|"it-request"|"leave"|"contract"|"expense"
    "ref_id": "REQ-042",
    "title": "IT 開發需求 — 信用卡系統升級",
    "description": "配合金管會新規...",
    "amount": null,                  // number | null
    "currency": "TWD",
    "applicant_id": "BK00001",
    "applicant_name": "王志明",
    "applicant_dept": "資訊部",
    "current_step": 2,
    "total_steps": 3,
    "status": "pending",
    "priority": "urgent",           // "normal" | "high" | "urgent"
    "metadata": null,
    "created_at": "2026-03-25T...",
    "updated_at": "2026-03-26T...",
    "steps": [
      {
        "step_order": 1,
        "approver_id": "BK00001",
        "approver_name": "王志明",
        "role_label": "申請人",
        "status": "approved",
        "comment": null,
        "acted_at": "2026-03-25T..."
      },
      {
        "step_order": 2,
        "approver_id": "BK00013",
        "approver_name": "陳建宏",
        "role_label": "資訊部副理",
        "status": "pending",
        "comment": null,
        "acted_at": null
      },
      {
        "step_order": 3,
        "approver_id": "BK00011",
        "approver_name": "陳柏翰",
        "role_label": "營運部副理",
        "status": "pending",
        "comment": null,
        "acted_at": null
      }
    ]
  }
]
```

---

### 8.2 GET /api/approvals/sent

取得當前使用者送出的所有簽核（含進行中與已完成）。

**Auth Required:** Yes

**Request:** None

**Response (200):** `Array<ApprovalWithSteps>`

格式同 `GET /api/approvals/pending`，但包含所有狀態（pending / approved / rejected）。

---

### 8.3 GET /api/approvals/history

取得當前使用者已簽核過的歷史紀錄（不含自己送出的）。支援類型與月份篩選。

**Auth Required:** Yes

**Query Params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| type | string | (all) | 篩選類型：`payment` / `it-request` / `leave` / `contract` / `expense` |
| month | string | (all) | 篩選月份，格式 `YYYY-MM` |

**Response (200):** `Array<HistoryItem>`
```json
[
  {
    "id": 10,
    "type": "payment",
    "title": "趨勢科技 資安軟體授權",
    "status": "approved",
    "amount": "520000.00",
    "currency": "TWD",
    "applicant_name": "王志明",
    "my_decision": "approved",       // "approved" | "rejected"
    "acted_at": "2026-03-23T...",
    "my_comment": null
  }
]
```

---

### 8.4 GET /api/approvals/stats

取得當前使用者的簽核統計數據（用於 Dashboard）。

**Auth Required:** Yes

**Request:** None

**Response (200):**
```json
{
  "pending": 5,                      // 待我簽核數量
  "sentInProgress": 1,               // 我送出的簽核中數量
  "sentApproved": 3,                 // 我送出的已核准數量
  "sentRejected": 0,                 // 我送出的已退回數量
  "historyCount": 8                  // 我已簽核過的總數
}
```

---

### 8.5 POST /api/approvals/:id/approve

核准簽核單。系統會驗證當前使用者是否為目前關卡的簽核人，核准後自動推進到下一關，若為最後一關則將整張單標記為 approved。

**Auth Required:** Yes

**Path Params:**
| Param | Type | Description |
|-------|------|-------------|
| id | number | 簽核單 ID |

**Request Body:**
```json
{
  "comment": "同意，請儘速執行"     // string, optional — 加註意見
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "已核准"
}
```

**Error (400):**
```json
{ "error": "此簽核單已結案" }
```

**Error (403):**
```json
{ "error": "您不是目前的簽核人" }
```

**Error (404):**
```json
{ "error": "簽核單不存在" }
```

---

### 8.6 POST /api/approvals/:id/reject

退回簽核單。驗證邏輯同核准，退回後整張單立即標記為 rejected。

**Auth Required:** Yes

**Path Params:**
| Param | Type | Description |
|-------|------|-------------|
| id | number | 簽核單 ID |

**Request Body:**
```json
{
  "comment": "金額需重新評估"       // string, optional — 退回原因
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "已退回"
}
```

**Error:** 同 `POST /api/approvals/:id/approve`

---

## Database Schema

### Tables

| Table | Description | Records (Seed) |
|-------|-------------|-----------------|
| `users` | 員工帳號 | 13 |
| `contracts` | 合約 | 0 (動態新增) |
| `payment_schedules` | 付款排程 | 0 (動態新增) |
| `training_courses` | 教育訓練課程 | 6 |
| `training_records` | 訓練完成紀錄 | ~22 |
| `leave_balances` | 假別餘額 | 91 (13 users x 7 types) |
| `leave_requests` | 請假申請 | 10 |
| `announcements` | 公告 | 6 |
| `announcement_reads` | 公告閱讀紀錄 | 0 (動態新增) |
| `meeting_rooms` | 會議室 | 17 |
| `room_bookings` | 會議室預約 | 23 |
| `approvals` | 簽核主表 | 17 |
| `approval_steps` | 簽核步驟 | 51 |
| `session` | Session 儲存 | (dynamic) |

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js + Express |
| Database | PostgreSQL (Zeabur) |
| Session | connect-pg-simple |
| Auth | bcryptjs |
| File Upload | multer (memory storage) |
| AI | Anthropic Claude API (optional) |
| PDF Parsing | pdf-parse |
| Hosting | Zeabur |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | No | Session 加密金鑰 (有預設值) |
| `ANTHROPIC_API_KEY` | No | Claude API Key，未設定則合約解析使用 Demo 模式 |
| `PORT` | No | Server port，預設 8080 |
