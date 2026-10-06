# 開發與驗證

擴充功能使用 Manifest V3 與原生 JavaScript，沒有 npm 建置步驟。測試需 Node.js 18+，macOS 輔助程式需 Python 3.9+。

0.7.1 更名為 RefClip。為了相容既有安裝，保留 `com.shakesave.host`、`ShakeSave` 安裝目錄、`ShakeSaveHost.exe`、JavaScript 內部名稱與訊息識別碼。顯示名稱改為 RefClip；更名本身不需重裝主機。若希望既有 Windows 選擇器也顯示新名稱，可重跑主機安裝。

## 結構

| 檔案 | 用途 |
| --- | --- |
| content.js、shared.js | 手勢、設定／命名、來源頁圖片讀取 |
| tag-editor.js | 縮圖、動態打標表單、歷史提示、鍵盤、動畫 |
| screenshot-background.js、screenshot-selector.js | 快捷鍵擷取、凍結畫面框選、高 DPI PNG 裁切 |
| background.js、native.js | Chrome 下載、原生訊息與圖片串流 |
| options.*、category-settings.js、popup.* | 設定、類別與排錯 |
| native/Host.cs | Windows .NET Framework 圖片主機 |
| native/macos/host.py、setup.py | macOS 圖片主機、安裝與移除 |
| tests/ | 自動測試與瀏覽器測試頁 |

## 測試

```sh
node --test tests/*.test.cjs
python3 tests/macos_host_test.py
```

Windows 的第二行可用 `py -3 tests/macos_host_test.py`。Node 的 Windows 主機測試使用系統 C# 編譯器，在其他平台略過。Python 的 POSIX 檢查只在 macOS/Linux 執行，二進位訊息主機程序測試只在 macOS 執行。測試只使用 `native/test-build`、`native/test-output` 下的目錄，不註冊主機或使用個人收藏目錄。

2026-10-06 本機結果（Windows）：

- 50 項 JavaScript／Windows 主機測試通過，包括真實 Windows 程序與磁碟寫入。
- 9 項 Python 主機測試中，6 項通過、3 項平台限定測試略過。涵蓋位元組、同名避讓、無效要求、圖片檔頭、選擇器模擬回覆、安裝更新與移除。
- 新增 `Extension context invalidated` 同步拋錯處理、表單歷史回覆隔離、前後綴原樣保留與平台字元限制測試。
- JavaScript 語法檢查通過。

`.github/workflows/test.yml` 配置 Windows 與 macOS runner；尚未推送，因此 CI 配置不代表 macOS 實測通過。Chrome 的載入、快捷鍵、登入來源、系統選擇器與重啟仍需實機驗收。

## 瀏覽器測試頁

執行 `node tests/serve-fixtures.cjs`，Ctrl+C 停止。

| 本機網址 | 用途 |
| --- | --- |
| http://127.0.0.1:8765 | HTTP／data／blob 圖片，配合已載入的擴充功能驗收 |
| http://127.0.0.1:8765/editor | 縮圖、動態欄位、前綴提示、預覽 |
| http://127.0.0.1:8765/settings | 設定 UI，使用測試頁 localStorage |
| http://127.0.0.1:8765/screenshot | 模擬擷取來源、實際 canvas PNG 裁切與打標 |

後三頁使用模擬 Chrome API，不寫圖片、不更改正式擴充功能設定。真實 DOM 驗證不等於 Chrome 擴充功能端到端驗證。Python 選擇器測試亦使用模擬回覆。

## 安全與儲存

- 主機名稱為 `com.shakesave.host`，Chrome 的 allowed_origins 與主機再次驗證的 origin 限制來源。選擇器只接受 options.html 操作。
- 只提供 status、choose、begin、chunk、commit，沒有網址下載、任意檔案讀取、任意目的地或任意指令介面。macOS 只執行固定 AppleScript，不插入使用者資料。
- 每張最多 20 MiB、每段 192 KiB；檔頭辨識 PNG、JPEG、GIF、WebP、AVIF、SVG、BMP、ICO、TIFF。SVG 禁止 DTD／實體，這不是完整圖片解碼或防毒掃描。
- 在目標目錄寫暫存檔、刷新資料，再以不覆蓋操作發布。Windows 使用移動，macOS 使用同目錄硬連結後清理暫存檔。不支援硬連結的檔案系統會報錯。
- macOS 每層 POSIX 路徑使用 no-follow 目錄描述符並持有目錄，拒絕符號連結及寫入途中替換的目的地。Windows 拒絕 UNC、符號連結與接合點。
- 一般錯誤／斷線清理 `.part`；斷電或強制終止可能留下暫存檔。完成檔案後回覆前斷線可能結果不明，先查看目錄再重試。
- 本機模式不經 Chrome 下載管線／下載安全檢查，不自動開圖。失敗不改存其他地方。
- 原圖保留來源位元組；同源優先來源頁 fetch，其他來源 extension fetch。Cookie／Referer／防盜連仍可能使請求失敗。
- 截圖只由 Chrome command 觸發，使用 activeTab／captureVisibleTab。切換分頁、視窗或尺寸時取消，PNG 在本機裁切。
- 前後綴不轉換，平台禁止字元明確拒絕。標籤內容的非法路徑字元仍安全替換。主檔名最多 110 UTF-16 字元，macOS 另限 230 UTF-8 位元組，留出副檔名及同名編號空間。

## 官方資料

- [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands)
- [captureVisibleTab](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-captureVisibleTab)
- [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
- [跨來源請求](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)
- [Windows 檔名限制](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
