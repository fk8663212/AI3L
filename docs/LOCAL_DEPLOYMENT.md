# 完整本機部署

本機模式使用 PostgreSQL 保存研究資料，圖片與錄音存到本機私有目錄。網站、資料庫與檔案儲存不需要 Vercel、Neon 或 Google Drive 帳號。AI 圖像分析、轉錄與語言提示仍使用後台設定的 Gemini／OpenAI API，需要網路與有效金鑰；本機部署不等於 AI 完全離線。

Macro／Micro 雙層圖已接入正式第 5、6 階段，使用學生確認的概念與任務設定的講述模板；操作規則見 [MACRO_MICRO.md](MACRO_MICRO.md)。原本的獨立 Demo 仍使用固定範例，可用來展示介面。

## 1. 準備環境

- Node.js 22，先以 `node --version` 確認。
- Docker Desktop 或 Docker Engine，以及 Docker Compose v2 或更新版本（[官方安裝說明](https://docs.docker.com/compose/install/)）。
- 啟動 Docker，確認 `docker info` 和 `docker compose version` 都成功。
- 第一次安裝會下載套件與容器映像，需要網路。網站字型已附在專案內，建置與瀏覽不需連線到 Google Fonts。

以下指令在專案根目錄執行；目前工作副本是 `/home/yangkai/AI3L/ddc-personal`。若系統目前是 Node 18，可暫以 `npx --yes --package=node@22 -- npm run local:setup` 執行初始化，長期開發建議切換到 Node 22。

### 目前這台 WSL 工作機

此副本已完成初始化。這台機器原有 Docker 主機有網路設定衝突，因此已另設專案專用引擎與 Compose 工具，資料保存在 `.local/docker-engine/`，不會修改其他專案的 Docker 資料。日後在此副本啟動可執行：

```bash
cd /home/yangkai/AI3L/ddc-personal
./.local/compose.sh up -d
./.local/compose.sh ps
```

這台機器將下文的 `docker compose` 替換成 `./.local/compose.sh` 即可，包括重新建置與備份。捷徑與引擎均為這台機器的本機工具，已被 Git 忽略；其他電腦請安裝正常的 Docker／Compose，照一般步驟部署。

## 2. 初始化本機設定

```bash
npm run local:setup
```

這個指令不需要先安裝套件，會產生：

| 位置 | 內容 |
| --- | --- |
| `.env` | Docker 的資料庫帳號、隨機密碼與連接埠設定 |
| `.env.local` | 網站資料庫連線、驗證／加密密鑰、管理員密碼雜湊與儲存設定 |
| `.local/admin-password.txt` | 自動產生的管理員登入密碼 |
| `.local/storage/` | 私有圖片、錄音與檔案 metadata |

環境檔與 `.local/` 都已加入 Git 忽略規則，也不會被放進 Docker 映像。已存在設定時，初始化會停止而不覆寫，避免舊研究資料的密鑰遺失。再次啟動網站不必重新執行初始化。

若資料庫的 5432 埠已被使用，首次初始化前可設定 `POSTGRES_PORT`，或一起修改 `.env` 的 `POSTGRES_PORT` 與 `.env.local` 的 `DATABASE_URL` 連接埠。若網站的 3000 埠已被使用，一起修改 `.env` 的 `APP_PORT` 與 `.env.local` 的 `NEXT_PUBLIC_APP_URL`。

## 3. 啟動完整網站

```bash
docker compose up --build -d
docker compose ps
```

Compose 會啟動三個服務：

1. `postgres`：有持久資料卷的 PostgreSQL 16。
2. `app`：建置後的 Next.js 網站。啟動時自動檢查設定、套用資料庫遷移並建立預設任務草稿。
3. `cleanup`：每 24 小時清除超過 24 小時且沒有研究紀錄引用的暫存檔。這項工作不會自動刪除仍有紀錄的學生資料。

第一次建置較久，等 `app` 為 healthy 後開啟：

- 網站首頁：<http://localhost:3000>
- 老師登入：<http://localhost:3000/admin/login>
- 固定範例 Demo：<http://localhost:3000/demo/index.html>

老師登入使用 `.local/admin-password.txt` 中的密碼。這個本機部署使用正式建置的 `next start`，不是只啟動獨立 HTML 展示。

## 4. 第一次設定老師與學生流程

1. 進入老師後台，確認「本機錄音庫」可用；可按「檢查本機儲存」驗證。
2. 在「AI 與儲存」設定自己的 Gemini 或 OpenAI API Key，測試要使用的模型。若預設模型不適用，新增自己帳號可使用的模型。
3. 編輯預設研究任務，選擇模型、錄音長度與各階段說明，再發布任務。發布時會檢查 AI 與錄音儲存庫。
4. 到「學生代碼」建立並下載匿名代碼。
5. 學生回首頁輸入代碼，完成同意程序後進入七階段學習流程。

即使尚未設定 AI Key，老師仍能登入與管理設定。AI 相關功能會明確回報尚未設定，不會用固定範例冒充真實分析。學生錄音可保存於本機；分析失敗會留在後台供補上金鑰後重試。

本機模式的檔案透過既有登入驗證與階段權限提供，沒有放進 `public/`。前後測隱藏提示、同一階段一次錄音、跨學生檔案權限等限制仍保留。

## 5. 日常啟動、停止與更新

```bash
# 查看服務與記錄
docker compose ps
docker compose logs --tail=100 app

# 停止（保留資料庫資料卷與本機檔案）
docker compose down

# 再次啟動
docker compose up -d

# 程式更新後重新建置
docker compose up --build -d
```

啟動時資料庫遷移與預設資料初始化可重複執行；既有任務與研究紀錄不會因重新啟動而清空。開發與更新都在個人 repo 的功能分支進行；學長的更新來源保留為 `upstream`。

## 6. 本機開發（只將 PostgreSQL 放 Docker）

想修改程式並立即看到變更時，可以只啟動資料庫，網站用 Node.js 跑：

```bash
npm ci
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run deploy:check
npm run dev
```

這條路與完整 Docker 部署共用同一份 `.env.local`、PostgreSQL 資料與 `.local/storage`。使用前先停止 Compose 的 `app`、`cleanup`，讓 3000 埠只被一個網站使用。

Node.js 直接作正式本機運行可用：

```bash
npm run build
npm run start
```

開發模式沒有 Compose 的定時清理服務，可在網站啟動時手動執行 `npm run local:cleanup`，或排程執行此指令。它會使用 `CRON_SECRET` 呼叫同一個清理 API，不需要將金鑰寫進排程命令。

## 7. 備份與還原

研究資料包含資料庫、檔案及解密所需的 `.env.local`。只備份其中一部分，無法完整還原。以下是 Bash／WSL 的範例，備份請放在私人位置。

```bash
umask 077
mkdir -p backups
docker compose stop app cleanup
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backups/database.dump
tar -czf backups/files-and-config.tar.gz .local/storage .env .env.local .local/admin-password.txt
docker compose start app cleanup
```

還原到新的本機環境時，先取回同一份程式碼及備份；暫停網站後解開設定與檔案，再啟動 PostgreSQL，還原資料庫：

```bash
tar -xzf backups/files-and-config.tar.gz
docker compose up -d postgres
# 等 postgres 為 healthy 後執行
docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/database.dump
docker compose up --build -d
```

備份與還原需在相同的 Compose 專案目錄執行。PostgreSQL 的資料卷會隨專案名稱區分，請保留備份，不要把資料卷當作唯一備份。

## 8. 設定與疑難排解

- `Cannot connect to the Docker daemon`：先啟動 Docker Desktop／Docker Engine；WSL 使用者確認 Docker 的 WSL 整合已啟用。這是 Docker 主機狀態，不是網站金鑰問題。
- `port is already allocated`：確認 3000、5432 是否被其他網站或資料庫占用，再按第 2 節一併修改連接埠。
- 管理員密碼錯誤：使用 `.local/admin-password.txt`；手動設定 scrypt 雜湊時，`.env.local` 的 `$` 必須寫為 `\$`，腳本會使用與 Next.js 相同的環境載入方式。
- 儲存檢查失敗：以同一位作業系統使用者執行初始化與 Compose，確認 `.local/storage` 可讀寫；不要將儲存位置改成 `public/`。
- 本機開發與 Compose 同時啟動：兩者會爭用 3000 埠，請只啟動其中一個網站。
- AI 分析失敗：先在老師後台測試 API Key 與模型；錄音可在「研究資料」中重試分析。
- `http://localhost` 可使用瀏覽器麥克風。若要讓其他電腦透過區網使用，還需要 HTTPS 與對應的網站 origin 設定；預設 Compose 僅綁定本機 loopback。

## 9. 保留雲端部署模式

若要沿用學長原本的雲端服務，將 `STORAGE_DRIVER=vercel`、`DATABASE_URL` 設成 Neon／PostgreSQL 連線，補上 Vercel Blob 認證與 Google OAuth 設定，並在後台連接 Drive。資料庫改用標準 PostgreSQL TCP 驅動，同樣可連 Neon；檔案讀取依已保存的 locator 分辨本機檔案與雲端檔案。

Vercel 的部署細節見 [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md)。本機與雲端資料需要各自備份；更換模式不會自動搬移已保存的研究檔案。

## 10. 驗證

```bash
npm run typecheck
npm test
npm run deploy:check
```

測試包含原有七階段研究流程，以及本機檔案保存、讀取、錄音分析重試、刪除、路徑限制、權限與後測隱藏。自動化流程測試以替身模擬 AI 回覆，實際 AI 功能仍需用自己的金鑰與可用模型驗證。
