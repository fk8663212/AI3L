# AI3L Speaking Lab

> **Macro／Micro 已接入正式第 5、6 階段**，使用學生已確認的概念圖與實際 AI 提示。Macro 依內容安排講述段落，可改名、調整順序與概念分組；選取段落會同步切換 Micro 子圖、關鍵詞與句首。單層圖仍可切換對照。
>
> 操作與資料規則見 [docs/MACRO_MICRO.md](docs/MACRO_MICRO.md)。原本給老師確認形式的 [public/demo/index.html](public/demo/index.html) 仍是獨立固定範例，不使用學生資料。

以論文與海報中的「視覺化 → 概念建構 → AI 擴充 → 語言鷹架 → 獨立口說」研究流程實作的繁體中文研究平台。專案支援完整本機部署，也保留 Vercel 雲端模式；學生端刻意只保留左側階段指示器與右側對話工作區，研究控制、供應商設定與匯出集中於管理後台。

> 第一次本機部署請依照 [`docs/LOCAL_DEPLOYMENT.md`](docs/LOCAL_DEPLOYMENT.md) 操作。論文與海報已整理至 [`docs/research/`](docs/research/)。

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

第 6 階段若收到不完整的 Gemini 回覆，會以同一模型自動重試一次；只有每個學生句子都有對應提示時才保存。兩次仍失敗時會保留句子，學生可再次取得提示。

錄音前可選擇麥克風，錄音時顯示收音音量；確認音量有變化後再說話。全靜音錄音會要求重錄。新錄音會補上 WebM 時長資訊，後台提供保留副檔名的下載，並支援拖曳播放。既有靜音檔無法還原未錄到的聲音；本次修正不會修改原檔。

## 完整本機部署（建議）

使用本機 PostgreSQL 與私有檔案目錄，網站、圖片與錄音保存不需要 Vercel、Neon 或 Google Drive 帳號。AI 分析仍需在後台設定 Gemini／OpenAI API Key。

需求：Node.js 22、已啟動的 Docker Desktop／Docker Engine、Docker Compose v2。

在專案根目錄執行：

```bash
npm run local:setup
docker compose up --build -d
docker compose ps
```

第一次建置完成、`app` 顯示 healthy 後開啟：

- 網站：<http://localhost:3000>
- 老師登入：<http://localhost:3000/admin/login>
- 管理員密碼：讀取本機 `.local/admin-password.txt`。

初始化會自動建立 `.env`、`.env.local`、隨機密鑰與資料庫密碼；已有設定時不會覆寫。容器啟動會自動遷移資料庫並建立預設任務草稿。`cleanup` 服務會每日清除過期、未被研究資料引用的暫存檔。

登入後確認「本機錄音庫」可用，設定並測試 AI Key／模型，發布任務，再產生學生代碼，即可使用原有七階段流程。

**完整逐步操作、開發模式、停止／更新、備份／還原及疑難排解，請看 [docs/LOCAL_DEPLOYMENT.md](docs/LOCAL_DEPLOYMENT.md)。**

## 儲存與隱私

- 結構化資料：PostgreSQL，Docker 使用持久資料卷；也支援既有 Neon 連線。
- `STORAGE_DRIVER=local`：圖片與錄音保存在 `.local/storage/`，只透過已驗證的 API 提供；不直接放在公開目錄。
- `STORAGE_DRIVER=vercel`：沿用 Private Vercel Blob 保存圖片、暫存錄音，再將錄音轉存私人 Google Drive。
- 保留原有學生權限、階段限制、後測隱藏、稽核紀錄與管理員確認刪除機制。
- API Key 以 `APP_ENCRYPTION_KEY` 衍生的 AES-256-GCM 金鑰加密；`.env.local` 必須與資料庫及檔案一起備份。
- 學生使用匿名研究代碼，不收姓名或 Email。AI API 分析仍會將必要內容傳至所選供應商。

## 本機開發（Node.js + PostgreSQL）

若要修改程式並立即看效果，先完成本機初始化，再執行：

```bash
npm ci
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run deploy:check
npm run dev
```

這個方式與 Docker 完整部署共用本機資料。請先停止 Compose 的 `app`、`cleanup`，避免爭用網站連接埠。

## 研究期間的管理

- 學生代碼：可單筆或批次停用、重新啟用、設定期限、刪除（已被使用的代碼只能停用）。停用、過期或任務封存會立即中止該學生的存取。
- 任務封存：研究結束時封存任務，學生無法再登入或作答；資料保留，可恢復發布。
- 學生登出：共用裝置上，學生可從左側欄登出；同一組代碼可從原進度繼續。
- 錄音分析重試：「研究資料」列出分析失敗或逾時未完成的錄音，可從錄音儲存庫重新讀取並重試。
- 前後測比較：依任務顯示配對樣本的描述性統計，並可下載 CSV。
- 刪除參與者資料：撤回同意時，可永久刪除單一學生的錄音、圖片與所有紀錄（需輸入學生標籤確認）。
- 保存期限：「研究資料」列出超過任務保存天數的工作階段，由管理員確認後刪除；系統不會自動刪除。
- 稽核紀錄：所有管理員操作可在「稽核紀錄」查看。

預設模型：

- Google：`gemini-3.6-flash`
- OpenAI：`gpt-5.6-terra`

OpenAI 錄音轉錄固定記錄為 `gpt-4o-transcribe`；其餘分析使用任務發布時鎖定的模型。系統不自動切換供應商或模型，避免研究條件漂移。

## 選用：部署至 Vercel

若要沿用雲端儲存，設定 `STORAGE_DRIVER=vercel`，並依 [docs/DEPLOY_VERCEL.md](docs/DEPLOY_VERCEL.md) 設定 PostgreSQL／Neon、Private Blob 與 Google OAuth。本機與雲端模式的切換不會自動搬移既有檔案。

## 驗證

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

研究資料可由管理後台匯出 JSON；錄音原檔保留於設定的本機或 Drive 儲存庫，匯出資料包含其儲存 locator 與所有階段、訊息、artifact、AI run 和稽核紀錄。
