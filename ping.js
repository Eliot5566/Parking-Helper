const axios = require("axios");
async function getTdxToken() {
  const url =
    "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: "a7868783-9aedcf5d-ceec-4b61",
    client_secret: "b33a1c68-6800-4fed-bd04-1c73f2ea8a79",
  });
  const { data } = await axios.post(url, params);
  return data.access_token;
}

// 測試用：直接執行取得 token 並印出
getTdxToken().then(token => {
  console.log('TDX Access Token:', token);
}).catch(err => {
  console.error('取得 TDX Token 失敗:', err.message);
});
