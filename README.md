# CarProject - LINE Bot 停車格查詢系統

本專案為 Node.js + Express + LINE Bot SDK 架構，協助用戶於 LINE 上查詢附近停車格資訊。

## 主要功能

- LINE Bot 互動
- 預留地理位置與停車格查詢功能擴充

## 快速開始

1. 安裝依賴：
   ```powershell
   npm install
   ```
2. 設定 `.env` 檔案，填入你的 LINE Bot channel 資訊。
3. 啟動伺服器：
   ```powershell
   node index.js
   ```
4. 將 webhook URL 設定為 `https://你的伺服器/webhook`

## 檔案結構

- `index.js`：主程式入口
- `.env`：環境變數設定


## 待辦事項

- 串接地理位置與停車格資料 API
- 處理用戶傳送位置訊息
- 美化回覆訊息格式

## API 使用

<!-- TDX 運輸資料流通服務 – 呼叫限制 & 點數
狀態	認證方式	呼叫頻率	點數 / 資料量
訪客模式（沒登入、沒帶 API Key）	只能在 Swagger 或瀏覽器	20 次 / IP / 天	無法程式介接
基礎會員（目前的情況）	Client Id + Client Secret
或 Bearer Token	5 次 / 分鐘 / Key
（外加整體 50 次 / 秒 / IP 的大閘門）	基礎服務 0 點 – 完全免費，儘管呼叫
進階／加值會員	另行加購	依方案提高	「加值服務」才開始吃點數（1 點 = 1 500 次 或 150 MB） -->

<!-- 總結：一名使用者點一次，扣多少配額？
類別	是否一定會扣	一次呼叫耗量 (最常見)
Google Geocoding	只有文字地址時	1 次
Google Distance Matrix	有 GOOGLE_MAPS_KEY 時	5 elements
TDX 基礎服務	必定	3 次

Google：免費額度足夠支撐每日上千名使用者。

 -->

# 平台流量

<!-- 服務	目前用量	免費額度	可能超量點
Google Maps Geocoding	8 次	約 40 000 次/月 (US$200)	幾乎很難超，只要不是大量 Push
Google Distance Matrix	10 elements	同上	每個目的地算 1 element，若改成 Broadcast 大量呼叫需注意
交通部 TDX	42 次	基礎會員：20 次/日/來源 IP (未帶 token)
有 token：依你訂閱方案	若使用者非常多，記得申請正式 Client ID / Secret，把 TDX_TOKEN 改成 OAuth 流程 -->
