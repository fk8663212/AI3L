# AI3L Speaking Lab：Vercel 部署操作手冊

本指南以目前 repository `https://github.com/EntropicRegression/ddc`、Vercel Next.js、Neon PostgreSQL、Private Vercel Blob 與 Google Drive OAuth 為準。

## 部署完成後會有哪些服務

```text
學生瀏覽器
  ├─ 文字與階段操作 ──> Vercel Next.js Functions ──> Neon PostgreSQL
  ├─ 圖片直接上傳 ───> Private Vercel Blob
  └─ 錄音暫存 Blob ──> AI 逐字稿／分析 ──> Google Drive 長期保存

管理員
  └─ /admin ──> API Key、模型、任務、學生代碼、研究匯出
```

Vercel Functions 已在 `vercel.json` 固定為新加坡 `sin1`。建立 Neon 與 Blob 時也選新加坡，讓運算與資料盡量位於同一區域。

## 0. 先準備帳號與資料

需要：

- GitHub 帳號，並可存取 `EntropicRegression/ddc`。
- Vercel 帳號。
- Google Cloud 帳號與一個可保存錄音的 Google Drive 帳號。
- 至少一個 AI API Key：Google Gemini 或 OpenAI。
- Node.js 20.9 以上。

正式研究若涉及未成年人，請先確認研究倫理、家長同意、保存期限及資料跨境規範。

## 1. 提交整理後的檔案

在 PowerShell 進入專案：

```powershell
cd C:\Users\User\Desktop\ddc
git status
npm install
npm run lint
npm run typecheck
npm test
npm run build
```

確認都通過後提交：

```powershell
git add .
git commit -m "chore: prepare Vercel deployment"
git push origin main
```

不要提交 `.env.local`、API Key、Google Client Secret 或 Vercel token。

## 2. 從 GitHub 建立 Vercel Project

1. 登入 [Vercel Dashboard](https://vercel.com/dashboard)。
2. 選 **Add New → Project**。
3. 找到並 Import `EntropicRegression/ddc`。
4. Framework Preset 應自動顯示 **Next.js**。
5. Root Directory 使用 `./`，Build Command 與 Output Directory 保持預設。
6. 先按 **Deploy**。

第一次部署只是在 Vercel 建立 Project；資料庫與密鑰尚未設定時，首頁可開啟，但學生代碼與管理後台 API 還不能使用。

Git 連接完成後，推送 `main` 會建立 Production deployment，其他 branch 則是 Preview deployment。

## 3. 建立 Neon PostgreSQL

1. 在 Vercel Project 開啟 **Storage** 或前往 **Marketplace**。
2. 搜尋並安裝 **Neon**。
3. 新使用者選 **Create New Neon Account**；已有 Neon 可選 Link Existing。
4. 建立資料庫時，區域選 **AWS Asia Pacific (Singapore)**。
5. 將 Neon resource 連接到目前的 Vercel Project。
6. 到 **Project → Settings → Environment Variables**，確認已有 `DATABASE_URL`。

建議先只讓 Production 使用正式資料庫。若要測試 Preview，請使用 Neon Preview Integration 的獨立 branch，避免測試資料寫入正式研究庫。

## 4. 建立 Private Vercel Blob

1. 進入 **Project → Storage**。
2. 選 **Create Database → Blob → Continue**。
3. Access 必須選 **Private**，不可選 Public。
4. Region 選 **Singapore (`sin1`)**。Blob 建立後不能修改 access mode 或 region。
5. 連接到目前 Project。

連接後，Vercel 會提供 `BLOB_READ_WRITE_TOKEN`，或在新版 Production Functions 使用短效 OIDC。不要自行把 Blob token 寫入 Git。

## 5. 產生網站密鑰與管理員密碼

產生四個互不相同的隨機密鑰：

```powershell
npm run auth:secrets
```

輸出形式如下，先暫存在密碼管理器：

```text
AUTH_SECRET=...
APP_ENCRYPTION_KEY=...
ACCESS_CODE_PEPPER=...
CRON_SECRET=...
```

再產生管理員密碼雜湊：

```powershell
npm run auth:hash -- '你的高強度管理員密碼'
```

只把輸出的 `scrypt$...` 保存為 `ADMIN_PASSWORD_HASH`；網站不需要保存明文密碼。

密鑰上線並產生資料後，不可任意更換：

- 更換 `APP_ENCRYPTION_KEY` 會讓既有 API Key 與 Drive refresh token 無法解密。
- 更換 `ACCESS_CODE_PEPPER` 會讓既有學生代碼失效。
- 更換 `AUTH_SECRET` 會讓所有登入 cookie 失效，但不會破壞研究資料。

## 6. 建立 Google Drive OAuth

1. 進入 [Google Cloud Console](https://console.cloud.google.com/) 建立或選擇 Project。
2. 到 **APIs & Services → Library**，啟用 **Google Drive API**。
3. 設定 OAuth consent screen：
   - 校內 Google Workspace 可依政策選 Internal。
   - 一般 Gmail 選 External；Testing 狀態下要把管理員 Gmail 加入 Test users。
4. 到 **Google Auth Platform → Clients → Create Client**。
5. Application type 選 **Web application**。
6. Authorized redirect URI 填入：

```text
https://你的-production-網域/api/admin/google/callback
```

例如：

```text
https://ddc.vercel.app/api/admin/google/callback
```

URI 的 `https`、網域、大小寫、路徑與結尾斜線必須完全相同；這個專案的 callback 結尾沒有 `/`。

7. 保存 Client ID 與 Client Secret，稍後分別填入：
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`

網站只要求 `drive.file` scope，讓應用程式操作自己建立或經使用者授權的檔案，而不是讀取整個 Drive。

## 7. 設定 Vercel Environment Variables

進入 **Project → Settings → Environment Variables**。正式研究建議先全部只勾選 **Production**：

| 變數 | 來源 | 是否敏感 |
| --- | --- | --- |
| `DATABASE_URL` | Neon 自動加入 | 是 |
| `AUTH_SECRET` | `npm run auth:secrets` | 是 |
| `APP_ENCRYPTION_KEY` | `npm run auth:secrets` | 是 |
| `ACCESS_CODE_PEPPER` | `npm run auth:secrets` | 是 |
| `CRON_SECRET` | `npm run auth:secrets` | 是 |
| `ADMIN_PASSWORD_HASH` | `npm run auth:hash` | 是 |
| `NEXT_PUBLIC_APP_URL` | Production origin，例如 `https://ddc.vercel.app` | 否 |
| `GOOGLE_CLIENT_ID` | Google Cloud | 是 |
| `GOOGLE_CLIENT_SECRET` | Google Cloud | 是 |
| `BLOB_READ_WRITE_TOKEN` | Blob 自動加入；OIDC 模式可能不顯示 | 是 |

`NEXT_PUBLIC_APP_URL` 不可包含結尾斜線、callback 路徑或查詢參數。

Environment Variables 修改後只會套用到新的 deployment，舊 deployment 不會自動更新。

## 8. 連結 Vercel CLI 並初始化資料庫

不必把 Production secrets 下載到硬碟，可由 Vercel CLI 暫時注入命令：

```powershell
npx vercel@latest login
npx vercel@latest link
```

`link` 時選擇現有的 `ddc` Project。接著檢查 Production 設定：

```powershell
npx vercel@latest env run -e production -- npm run deploy:check
```

看到「部署前檢查通過」後，套用已提交的 Drizzle migration：

```powershell
npx vercel@latest env run -e production -- npm run db:migrate
```

再建立預設 Gemini／OpenAI model 與大稻埕任務草稿：

```powershell
npx vercel@latest env run -e production -- npm run db:seed
```

`db:migrate` 會記錄已套用版本，可以安全地在未來 migration 產生後再次執行。不要用 `drizzle-kit push --force` 取代正式 migration。

## 9. 重新部署 Production

回到 Vercel：

1. 開啟 **Deployments**。
2. 找到最新的 `main` deployment。
3. 點右側選單 → **Redeploy**。
4. 部署完成後開啟 Production URL。

也可以再 push 一個 commit，Vercel 會自動部署 `main`：

```powershell
git commit --allow-empty -m "chore: trigger production deployment"
git push origin main
```

## 10. 第一次後台設定

1. 開啟 `https://你的網域/admin/login`。
2. 使用產生 hash 時的明文管理員密碼登入。
3. 到 **AI 供應商**：
   - 填入 Gemini API Key，測試 `gemini-3.6-flash`；或
   - 填入 OpenAI API Key，測試 `gpt-5.6-terra`。
4. 回到 Overview，按 **連接 Google Drive**。
5. 使用第 6 步設定的 Google 帳號授權。
6. 到 **研究任務**確認 provider/model，發布預設任務。
7. 產生學生代碼並立刻下載 CSV；代碼明文只顯示一次。

任務發布後會鎖定 provider 與 model，系統不會自動 fallback，確保研究條件一致。

## 11. 正式驗收清單

- [ ] `/` 可顯示學生代碼入口。
- [ ] `/admin/login` 可登入。
- [ ] 選定的 AI provider 顯示「已驗證」。
- [ ] Google Drive 顯示「已連接」，且建立 `AI3L Speaking Research` 資料夾。
- [ ] 任務已發布，學生代碼可建立工作階段。
- [ ] 手繪圖成功存入 Private Blob，直接開 Blob URL 無法公開讀取。
- [ ] 麥克風可在 HTTPS 網站錄音。
- [ ] 錄音完成後出現在 Drive，Blob 暫存被刪除。
- [ ] 七個階段不能跳關；後測時看不到先前提示。
- [ ] 管理後台可下載研究 JSON。
- [ ] Vercel **Settings → Cron Jobs** 可看到 `/api/cron/cleanup-blob` 每日工作。

正式收案前，建議用一個測試代碼完整跑完七階段，再從研究資料匯出確認逐字稿、口說分析、AI run 與 Drive locator 都存在。

## 常見問題

### `DATABASE_URL is not configured`

Neon 尚未連接到這個 Vercel Project，或變數沒有勾選目前 deployment environment。連接後重新部署。

### `redirect_uri_mismatch`

Google Cloud 的 Authorized redirect URI 與 `NEXT_PUBLIC_APP_URL + /api/admin/google/callback` 不完全一致。特別檢查 `https` 與結尾斜線。

### Google 沒有回傳 refresh token

到 Google 帳號的第三方存取權移除舊授權，再從後台重新連接；本系統會再次要求 consent。

### `DRIVE_NOT_CONNECTED`

系統刻意禁止在 Drive 未連接時發布任務，避免學生錄音沒有長期保存位置。

### Blob 上傳失敗

確認建立的是 **Private Blob**、已連接正確 Project，且部署使用 `@vercel/blob` 2.3 以上。本專案目前版本已符合。

### Preview 可以開但操作 API 失敗

不要把 Production 的 `NEXT_PUBLIC_APP_URL` 原封不動套到 Preview。Preview 應使用自己的 origin、獨立 Neon branch 與 OAuth redirect URI；正式研究建議先只使用 Production。

### 換成自訂網域

加入自訂網域後，同時：

1. 更新 Production 的 `NEXT_PUBLIC_APP_URL`。
2. 在 Google OAuth 增加新 callback URI。
3. Redeploy。
4. 從管理後台重新連接一次 Google Drive。

## 官方參考

- [Vercel Git deployments](https://vercel.com/docs/git)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel Private Blob](https://vercel.com/docs/vercel-blob/private-storage)
- [Neon on Vercel Marketplace](https://vercel.com/marketplace/neon)
- [Vercel Function regions](https://vercel.com/docs/functions/configuring-functions/region)
- [Google OAuth Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Drizzle migrations](https://orm.drizzle.team/docs/drizzle-kit-migrate)
