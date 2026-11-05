# AI3L Speaking Lab

以論文與海報中的「視覺化 → 概念建構 → AI 擴充 → 語言鷹架 → 獨立口說」研究流程實作的繁體中文研究平台。專案可部署到 Vercel；學生端刻意只保留左側階段指示器與右側對話工作區，研究控制、供應商設定與匯出集中於管理後台。

> 第一次部署請直接依照 [`docs/DEPLOY_VERCEL.md`](docs/DEPLOY_VERCEL.md) 操作。論文與海報已整理至 [`docs/research/`](docs/research/)。

## 系統行為

學生流程由伺服器端狀態機控制，不能靠改網址或前端資料跳關：

1. 獨立口說前測：不顯示 AI 提示，30–120 秒錄音。
2. 手繪情境：私人圖片上傳後立即在後台預先執行 AI 圖像辨識，但不向學生揭露結果；學生仍先自行標記至少三個英文詞。
3. 自主概念圖：學生在紙上手繪概念圖（概念、方向連線與關係詞）後拍照上傳，AI 尚未介入。
4. AI 圖像分析：顯示上傳時預先產生的較完整詞彙與原圖標記，讓學生逐項接受、修改或拒絕；預先分析失敗時可在此重試。
5. AI 概念圖：AI 讀取手繪概念圖並整合已確認詞彙，學生審核 AI 新增的節點與關係。
6. 句型鷹架：先寫至少三句，再取得漸進提示並錄製練習。
7. 獨立口說後測：隱藏先前提示，完成第二次獨立錄音。

每次 AI 執行都保存供應商、實際模型、提示版本／雜湊、延遲、token 與錯誤。前測、練習與後測錄音會產生忠實逐字稿與描述性口說指標；研究完成前不會把前後測分析回傳給學生。

## 儲存與隱私

- 結構化資料：Neon PostgreSQL（Drizzle ORM）。
- 圖片：Private Vercel Blob，瀏覽時由已驗證的 API 代理。
- 錄音：先由瀏覽器直接上傳 Private Blob，再轉存至管理員授權的私人 Google Drive；成功後刪除 Blob 暫存。
- 暫存清理：Vercel Cron 每天清除超過 24 小時、且沒有任何紀錄引用的 Blob（錄音暫存、失敗或放棄的上傳、已刪除參與者的殘留檔）。
- API Key／Drive refresh token：以 `APP_ENCRYPTION_KEY` 衍生的 AES-256-GCM 金鑰加密。
- 學生身分：一次一碼的匿名研究代碼，不收姓名或 Email。
- Google OAuth scope：`drive.file`，只操作本系統建立或取得權限的檔案。

若研究涉及未成年人，正式上線前仍需依研究倫理審查、校方規範與家長同意調整同意文、保存期限、資料刪除與跨境處理方式。

## 本機啟動

需求：Node.js 20.9+、Neon 資料庫、Private Vercel Blob、Google Cloud OAuth Web application。

```bash
npm install
copy .env.example .env.local
npm run auth:hash -- "至少十二字元的管理員密碼"
npm run db:migrate
npm run db:seed
npm run dev
```

把密碼雜湊填入 `ADMIN_PASSWORD_HASH`。其餘三個應用程式密鑰與 `CRON_SECRET` 請各自使用至少 32 bytes 的隨機值。

Google OAuth 的 Authorized redirect URI：

```text
http://localhost:3000/api/admin/google/callback
https://你的正式網域/api/admin/google/callback
```

登入 `/admin/login` 後依序：

1. 保存並測試 Gemini 或 OpenAI API Key。
2. 連接 Google Drive。
3. 編輯預設任務，選擇固定供應商／模型並發布。
4. 在「學生代碼」產生匿名學生代碼（可設有效期限）；明碼只顯示一次，請下載 CSV。

## 研究期間的管理

- 學生代碼：可單筆或批次停用、重新啟用、設定期限、刪除（已被使用的代碼只能停用）。停用、過期或任務封存會立即中止該學生的存取。
- 任務封存：研究結束時封存任務，學生無法再登入或作答；資料保留，可恢復發布。
- 學生登出：共用裝置上，學生可從左側欄登出；同一組代碼可從原進度繼續。
- 錄音分析重試：「研究資料」列出分析失敗或逾時未完成的錄音，可從 Google Drive 重新讀取並重試。
- 前後測比較：依任務顯示配對樣本的描述性統計，並可下載 CSV。
- 刪除參與者資料：撤回同意時，可永久刪除單一學生的錄音、圖片與所有紀錄（需輸入學生標籤確認）。
- 保存期限：「研究資料」列出超過任務保存天數的工作階段，由管理員確認後刪除；系統不會自動刪除。
- 稽核紀錄：所有管理員操作可在「稽核紀錄」查看。

預設模型：

- Google：`gemini-3.6-flash`
- OpenAI：`gpt-5.6-terra`

OpenAI 錄音轉錄固定記錄為 `gpt-4o-transcribe`；其餘分析使用任務發布時鎖定的模型。系統不自動切換供應商或模型，避免研究條件漂移。

## 部署至 Vercel

1. 將此資料夾推送至 Git repository，匯入 Vercel。
2. 在 Vercel Marketplace 建立 Neon；確認 `DATABASE_URL` 已注入。
3. 建立 **Private** Blob store；確認 `BLOB_READ_WRITE_TOKEN` 已注入。
4. 在 Production、Preview（需要時）設定 `.env.example` 中其餘變數。
5. 將 `NEXT_PUBLIC_APP_URL` 設為正式 HTTPS 網域，並在 Google OAuth 登錄你實際開啟後台的網域的 callback（連接 Drive 時會回到目前所在的網域）。
6. 先執行一次 `npm run db:migrate`，再部署。
7. 在 `/admin` 完成 API Key、Drive、任務發布與代碼產生。

`vercel.json` 已設定每日一次清理工作，符合 Hobby 每日 Cron 限制；Vercel 會把 `CRON_SECRET` 自動放入 Authorization header。

## Vercel Blob 成本（2026-07-29 查核）

Vercel 官方目前列出的基準價格為：

| 項目 | Hobby 每月含量 | 超額／按量基準 |
| --- | ---: | ---: |
| Storage | 1 GB | US$0.023 / GB-month |
| Simple operations | 10,000 | US$0.40 / 1M |
| Advanced operations | 2,000 | US$5.00 / 1M |
| Blob data transfer | 10 GB | US$0.05 / GB 起 |

Private 與 Public Blob 的儲存、操作、上傳單價相同，但 Private Blob 由 Function 代理下載時還會產生 Function 傳輸成本。Client Upload 不收上傳資料傳輸費；`del()` 不計帳單操作費。來源：[Vercel Blob usage and pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)、[Private storage](https://vercel.com/docs/vercel-blob/private-storage)。

以 100 位學生、每人 1 張壓縮後約 1 MB 圖片、3 段各約 5 MB 錄音估算：永久 Blob 約 0.1 GB；錄音只短暫停留後進 Drive；約 400 次上傳、400 次 `head()`，以及約 1.6 GB 的 Blob 讀取。單看 Blob 通常仍在 Hobby 含量內，但正式研究建議使用 Pro，以避免達 Hobby 上限後 Blob 暫停服務，並另外估算 Vercel Function、Neon、Google Drive 與 AI API 費用。

## 驗證

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

研究資料可由管理後台匯出 JSON；錄音原檔保留於 Drive，匯出資料包含其 Drive locator 與所有階段、訊息、artifact、AI run 和稽核紀錄。
