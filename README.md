# 多益練習室

四回多益聽讀練習，共 800 題。網站提供單元題庫、模擬考、錯題本、跨裝置同步、陪練角色和手機主畫面安裝。

[開啟 GitHub Pages 網站](https://jianningg.github.io/toeic-practice/)

## 使用方式

| 功能 | 操作 |
| --- | --- |
| 單元題庫 | 可指定回次與題數，依 Part 1–7 練習。確認答案後可以看中文解析。 |
| 模擬考 | 可選整回、聽力或閱讀。交卷後查看答對題數、各 Part 正確率和逐題解析。 |
| 錯題本 | 自動收錄答錯的題目，可依回次、題型和訂正狀態篩選。 |
| 聽力 | 練習時可隨題或題組播放，也可手動播放、暫停與重播。提供 0.5×、0.75×、1.0×、1.25×、1.5×，模考聽力倒數會隨倍速調整。 |
| 陪練角色 | 首頁可進入角色選擇。選好角色後會在頁面角落走動，點擊可以互動。可從設定隱藏走動角色。 |
| 每日提醒 | 設定時間與時區，選每日練習、聽力或錯題複習文案，也可自訂標題／內容；可傳送測試與關閉。需先完成推播後端部署。 |
| 手機主畫面 | iPhone／iPad 用 Safari 的「分享 → 加入主畫面」。Android 用 Chrome 的「安裝應用程式」或「加到主畫面」。 |

### 紀錄與同步碼

1. 每個新瀏覽器首次開啟時，會產生一組同步碼。進入「設定」可以查看及複製目前的碼。
2. 在原裝置按「啟用雲端同步」，等狀態顯示已同步。
3. 另一台裝置可以在「另一組同步碼」填入原本的碼，再按「切換同步碼」，讀取該組的歷次作答、錯題和偏好。兩組碼的紀錄各自保存。

進行中的練習保留在目前瀏覽器。設定頁也可匯出或匯入 JSON 備份，備份內含同步碼及作答紀錄，請自行保管。啟用同步後，紀錄在瀏覽器內加密，再儲存到同步服務。

## 儲存庫內容

| 路徑 | 用途 |
| --- | --- |
| `index.html`、`style.css`、`app.js` | 網站介面、作答、計時、播放和陪練角色。 |
| `study-data.js` | 瀏覽器儲存、同步碼切換、備份與加密同步。 |
| `install.js`、`sw.js`、`manifest.webmanifest`、`icon-*.png` | 網頁 App 安裝、圖示與離線介面。聽力音檔透過網路載入。 |
| `theme/` | 原照片去背的六個角色及兩張方形網站圖示。 |
| `bank.js`、`timings.js`、`material.zip`、`listening-*.m4a.part-*` | 現行網站所用的題庫資料、題目圖片和網頁版聽力資源。 |
| `sync-worker/` | Cloudflare Worker、D1 資料庫設定和遷移檔。 |
| `tools/build_site.py`、`.github/workflows/pages.yml` | 本機和 GitHub Pages 共用的打包腳本，以及發布工作流程。 |

原始題目卷、答案卷和原始整回錄音另行保存。網站需要的執行檔與素材可從 GitHub 的「Code → Download ZIP」一併取得。

## 練習與學習分析

- 單元題庫可選「智慧複習」、「隨機」或「依題號」。智慧複習依序優先安排有待訂正題目的題組、含未練題目的題組，再安排已練題組；同一優先序內隨機抽取。
- 關鍵字搜尋涵蓋題目、選項、逐字稿、解析與文字素材，不辨識圖片內文字。按搜尋套用，清除可恢復題庫；命中任一題會保留整個題組，因此實際出題可能多於設定題數。
- 首頁與學習紀錄顯示題庫涵蓋率、最近最多 50 題已交卷作答的正確率，以及累計正確率最低的 Part，可直接開始智慧複習。涵蓋率以不同題目計算，重做不會重複累加；進行中已確認答案的題目也計入涵蓋率。
- 這些指標沿用現有作答紀錄，不需要新增帳號或同步設定；近期統計依交卷時間及卷內題序計算，並非每次點選答案的時間。

功能構想參考 [iPAS AI 模擬考練習](https://yazelin.github.io/ipas-ai-quiz/) 的智慧複習、關鍵字篩選與學習統計，程式依本專案題組與紀錄格式實作。

核心行為測試（需要 Node.js）：`node --test tests/learning.test.cjs`。

## 本機預覽

需要 Python 3.9 以上版本。從儲存庫根目錄執行。

```sh
python tools/build_site.py
python -m http.server 4173 --bind 127.0.0.1 --directory _site
```

打開 [本機預覽](http://127.0.0.1:4173/)。打包腳本會重組四回音檔、解開題目圖片並檢查網頁所需的素材。正式同步服務只接受正式網站的瀏覽器來源，本機預覽可用本機紀錄測試。

## 維護與部署

### GitHub Pages

網站由 `.github/workflows/pages.yml` 部署。推送到 `main` 後，GitHub Actions 會打包 `_site` 並發布。可到 [Pages 工作流程](https://github.com/Jianningg/toeic-practice/actions/workflows/pages.yml)查看結果。若從另一個儲存庫重新架設，在該儲存庫的「Settings → Pages」將發布來源設為「GitHub Actions」。

### Cloudflare Workers 與 D1

單純修改前端時，推送到 GitHub 即可。需要部署同步服務時，登入 Cloudflare 並從儲存庫根目錄執行。

```sh
npx wrangler d1 migrations apply toeic-practice-sync --config sync-worker/wrangler.toml --remote
npx wrangler deploy --config sync-worker/wrangler.toml
```

若改用其他 Cloudflare 帳號，先建立 D1 資料庫，將名稱及 ID 填入 `sync-worker/wrangler.toml`，再套用遷移並部署。若更換網站網址或 Worker，請更新 `sync-worker/index.mjs` 的允許來源，以及 `index.html` 中的 `toeic-sync-url`。可用 Worker 的 `/health` 端點確認服務已啟動。 [Cloudflare D1 部署說明](https://developers.cloudflare.com/d1/get-started/)

### 每日提醒推播部署

提醒使用標準 Web Push，在網頁關閉時仍可送達，不依賴頁面計時器。每台裝置獨立訂閱與關閉，並不隨學習同步碼切換。iPhone／iPad 需 iOS/iPadOS 16.4 以上，先加入主畫面並從 App 開啟；其他裝置也需要瀏覽器支援並允許通知。

從儲存庫根目錄執行（需要 Node.js 22 以上及 Cloudflare 登入／部署權限）：

```sh
npm ci --prefix sync-worker
node --test tests/learning.test.cjs tests/reminders.test.mjs
npx wrangler d1 migrations apply toeic-practice-sync --config sync-worker/wrangler.toml --remote
cd sync-worker
node tools/generate-vapid.mjs
npx wrangler secret bulk .vapid-keys.json --config wrangler.toml
npx wrangler deploy --config wrangler.toml
```

產生金鑰的命令只需執行一次，會建立已忽略的 `.vapid-keys.json`（權限 0600），包含 `VAPID_PUBLIC`、`VAPID_PRIVATE`、`VAPID_SUBJECT`。請安全保存、不要提交或分享；檔案已存在時不會覆寫。`secret bulk` 將三項設定存入 Worker，`/push/config` 僅公開公鑰與就緒狀態。更換金鑰會使舊訂閱失效，請沿用原金鑰。之後部署不必重新產生或上傳金鑰。

部署後到網站「設定 → 每日提醒推播」選擇時間、時區及文案，按「啟用／儲存提醒」，允許通知，再按「傳送測試」。自訂標題最多 40 字、內容最多 160 字。測試會送出**已儲存**的內容，每台裝置每分鐘最多測試一次。關閉提醒會先刪除伺服器排程，再解除瀏覽器訂閱。

Cron 每分鐘檢查設定時區的時間，每個當地日期最多發一次；短暫失敗會在設定時間後 15 分鐘內重試，過期的訂閱會移除。通知可能因網路、裝置省電或瀏覽器政策延遲，並非準點送達保證。夏令時間跳過的時間不補發，重複的小時也不會多發。點通知會開啟單元題庫。

伺服器為推播保存裝置訂閱、時間、時區及通知文案；文案不包含同步碼，也不加入學習備份。推播文案會在伺服器端讀取後加密傳送，並可能顯示在鎖定畫面。這個功能不會改動現有同步資料。

前端仍由 GitHub Pages 發布；必須同時部署新版 Worker、套用 `0002_reminders.sql` 與設定 VAPID，光更新前端無法啟用推播。沒有後端設定時，介面會明確顯示尚未就緒。本機前端使用的來源不在正式 Worker 的允許清單中，可用自動化測試驗證介面與排程邏輯。
