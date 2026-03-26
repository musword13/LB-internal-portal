# LINE Bank Internal Portal

銀行內部員工整合平台，以單一介面取代多套難用的廠商系統（如 VITALSESP ESP），結合 AI 智慧功能提升作業效率。

## 核心功能

### 1. 合約文件歸檔 + 財務付款系統
- 上傳合約 PDF，AI 自動解析關鍵欄位（簽約對象、金額、期間、付款條件等）
- 解析結果可即時編輯修正，顯示 AI 信心度
- 一鍵確認歸檔並自動建立分期付款草稿
- 付款排程管理，到期自動提醒

### 2. 簽核流程 + Teams / Slack 通知
- 視覺化多階段簽核流程
- 核准 / 退回後自動透過 Microsoft Teams 或 Slack 發送個別通知
- 支援付款、IT 需求、請假、合約續約等多種簽核類型

### 3. IT 需求申請 + JIRA 整合
- Kanban 看板追蹤所有 IT 需求狀態
- 核准後自動建立 JIRA Ticket，可指定 Project 與開發團隊
- 自動透過 Teams / Slack 通知相關人員

## 其他功能模組

| 模組 | 說明 |
|------|------|
| 儀表板 | 待辦總覽、統計數據、快速操作、到期合約提醒、付款趨勢圖 |
| 企業公告欄 | 分級公告（緊急 / 全行 / 人事 / 教育訓練 / 行政） |
| 員工通訊錄 | 即時搜尋、部門篩選、分機 / Email、一鍵開啟 Teams 對話 |
| 請假管理 | 線上請假、假別餘額視覺化、部門日曆、代理人設定 |
| 會議室預約 | 三間會議室即時狀態、時段表、快速預約 |
| 費用報銷 | 報銷申請、AI 收據辨識、歷史紀錄 |
| AI 智慧助手 | 合約查詢、付款追蹤、JIRA 狀態、假別餘額、行內規章查詢 |
| 系統設定 | 通知管道設定、整合服務連線狀態、個人資訊管理 |

## 技術架構

- **前端**：純 HTML / CSS / JavaScript（單一檔案，無框架依賴）
- **後端**：Node.js + Express 靜態伺服器
- **整合服務**：Microsoft Teams、Slack、JIRA、Google Calendar、AI 文件解析引擎（Claude API）

## 專案結構

```
deploy/
├── README.md
├── .gitignore
├── package.json          # Node.js 專案設定
├── server.js             # Express 靜態伺服器
├── zbpack.json           # Zeabur 部署設定
└── public/
    └── index.html        # LINE Bank Portal 主頁面
```

## 部署方式（Zeabur）

### 方法一：Git 部署（推薦）

1. 將 `deploy/` 資料夾推到 GitHub Repository
2. 前往 [Zeabur Dashboard](https://dash.zeabur.com) 建立新專案
3. 選擇「Deploy from GitHub」，連結該 Repository
4. Zeabur 自動偵測 Node.js 並執行 `npm install` + `npm start`
5. 部署完成後綁定自訂網域即可

### 方法二：Zeabur CLI

```bash
cd deploy
npm install
npx zeabur deploy
```

## 環境變數

| 變數 | 說明 | 預設值 |
|------|------|--------|
| `PORT` | 伺服器連接埠（Zeabur 自動注入） | `8080` |

## Demo 模式

目前為前端 Demo 版本，所有互動功能以模擬資料呈現。登入頁面直接點擊「登入」即可體驗完整功能。

## License

Internal use only - LINE Bank
