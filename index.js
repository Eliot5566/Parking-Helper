/* -------------------------------------------------
 *  Parking-bot 2025  —  完整可執行 index.js
 *  Node ≥ 18   npm i express axios @line/bot-sdk dotenv
 * ------------------------------------------------*/

/* ---------- 0. 依賴 ---------- */
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const line    = require('@line/bot-sdk');

/* ---------- 1. 讀環境變數 ---------- */
const {
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  GOOGLE_MAPS_KEY   = '',           // 可留空
  TDX_TOKEN         = '',           // 可留空
  TDX_CLIENT_ID     = '',
  TDX_CLIENT_SECRET = '',
  PORT              = 3450,
} = process.env;

/* ---------- 2. LINE SDK ---------- */
const lineConfig = { channelAccessToken:LINE_CHANNEL_ACCESS_TOKEN, channelSecret:LINE_CHANNEL_SECRET };
const client     = new line.Client(lineConfig);

/* ---------- 3. Express ---------- */
const app = express();
app.get('/', (_,res)=>res.send('🚗 Parking-bot is running!'));
app.post('/webhook',
  line.middleware(lineConfig),
  express.json(),
  async (req,res)=>{
    try{
      const results = await Promise.all(req.body.events.map(handleEvent));
      res.json(results);
    }catch(err){
      console.error('Webhook error:', err);
      res.status(500).end();
    }
});
app.listen(PORT,()=>console.log(`🚀 Parking-bot listening on :${PORT}`));

/* =================================================
 *  4. 事件處理
 * =================================================*/
async function handleEvent(e){
  if (e.type!=='message') return null;

  /* 4-1 位置訊息 */
  if (e.message.type==='location'){
    const { latitude, longitude } = e.message;
    const reply = await findParking(latitude, longitude);
    return client.replyMessage(e.replyToken,{ type:'text', text:reply });
  }

  /* 4-2 純文字 = 地址查詢 */
  if (e.message.type==='text'){
    const q = e.message.text.trim();
    const geo = await geocode(q);
    if (!geo){
      return client.replyMessage(e.replyToken,{ type:'text',
        text:'❓ 找不到這個地址，請再確認或直接傳「位置資訊」。'});
    }
    const reply = await findParking(geo.lat, geo.lng, geo.formatted);
    return client.replyMessage(e.replyToken,{ type:'text', text:reply });
  }
  return null;
}


function toRad(x){ return x*Math.PI/180 }
function haversine(φ1,λ1,φ2,λ2){
  const R=6371, dφ=toRad(φ2-φ1), dλ=toRad(λ2-λ1);
  const a=Math.sin(dφ/2)**2 + Math.cos(toRad(φ1))*Math.cos(toRad(φ2))*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));   // 回傳 km
}

/* =================================================
 *  5. 主功能：找附近停車場
 * =================================================*/
const RADIUS_KM = 2.5;   // 篩選半徑
async function findParking(lat,lng,originLabel=''){
  /* 5-1 決定 cityCode（若失敗回 'ALL'） */
  const cityCode = await getCityCode(lat,lng);   // 需 GOOGLE_MAPS_KEY

  /* 5-2 取 TDX 靜/動態資料 (CarPark + Facility + Availability) */
  let lots = [], liveMap = new Map();
  if (cityCode!=='ALL'){
    try{
      const token   = await getTDXAccessToken();
      const headers = { Authorization:`Bearer ${token}` };

      const base = 'https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet';
      const carURL = makeCityURL(`${base}/CarPark`,            cityCode);
      const facURL = makeCityURL(`${base}/ParkingFacility`,    cityCode);
      const avaURL = makeCityURL(`${base}/ParkingAvailability`,cityCode);

      const [carRes, facRes, avaRes] = await Promise.allSettled([
        axios.get(carURL,{headers,timeout:10000}),
        axios.get(facURL,{headers,timeout:10000}),
        axios.get(avaURL,{headers,timeout:10000}),
      ]);

      if (carRes.status==='fulfilled') lots.push(...(carRes.value.data.CarParks || []));
      if (facRes.status==='fulfilled') lots.push(...(facRes.value.data.ParkingFacilities || []));
      if (avaRes.status==='fulfilled'){
        const a = avaRes.value.data.ParkingAvailabilities || [];
        liveMap = new Map(a.map(p=>[ p.ParkingFacilityID||p.CarParkID, p.AvailableSpaces ?? '—' ]));
      }
    }catch(err){
      console.warn('TDX fetch error:', err.response?.status || err.message);
    }
  }

  /* 5-3 OpenData Fallback（示範台北，可自行擴充） */
  if (!lots.length){
    lots = await taipeiOpenData(lat,lng);
  }
  if (!lots.length){
    return '🙈 附近查無停車場（TDX / OpenData 均無資料）。';
  }

  /* 5-4 篩直線距離最近 10 筆 */
  const cand = lots.map(p=>{
      const pos = p.CarParkPosition || p.OffStreetMapPosition || {};
      const φ = p.lat || +pos.PositionLat, λ = p.lng || +pos.PositionLon;
      if (Number.isNaN(φ)||Number.isNaN(λ)) return null;
      return {
        id   : p.CarParkID||p.ParkingFacilityID,
        name : (p.CarParkName||p.ParkingFacilityName||{}).Zh_tw || p.CarParkName || p.ParkingFacilityName,
        addr : p.Address || p.CarParkAddress || '—',
        lat  : φ, lng: λ,
        dist : haversine(lat,lng,φ,λ)
      };
    })
    .filter(Boolean)
    .sort((a,b)=>a.dist-b.dist)
    .slice(0,10);

  /* 5-5 Google Distance Matrix（可選） */
  if (GOOGLE_MAPS_KEY){
    try{
      const dest = cand.map(c=>`${c.lat},${c.lng}`).join('|');
      const { data } = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        { params:{ origins:`${lat},${lng}`, destinations:dest, mode:'driving',
                   key:GOOGLE_MAPS_KEY }, timeout:8000 }
      );
      if (data.status==='OK'){
        data.rows[0].elements.forEach((e,i)=>{
          cand[i].road   = e.status==='OK' ? (e.distance.value/1000).toFixed(1)+' km' : null;
          cand[i].time   = e.status==='OK' ? e.duration.text : null;
        });
      }
    }catch(e){ /* 失敗時照直線距離顯示 */ }
  }

  /* 5-6 組回覆文字 */
  const text = cand.slice(0,5).map(c=>{
    const avail = liveMap.get(c.id);
    return [
      `🅿️ ${c.name||'—'}`,
      `地址：${c.addr}`,
      avail!==undefined ? `剩餘車位：${avail}` : null,
      c.road ? `開車：${c.road}，約 ${c.time}` : `直線距離：${c.dist.toFixed(1)} km`
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  const srcNote = liveMap.size
      ? '📊 資料來源：交通部 TDX 停車場'
      : '📊 資料來源：地方政府開放資料';
  const extra   = GOOGLE_MAPS_KEY ? '' : '\n⚠️ 無 Google Key，只顯示直線距離';

  return (originLabel ? `📍 ${originLabel}\n\n` : '') + text + '\n\n' + srcNote + extra;
}

/* =================================================
 *  6. 支援函式
 * =================================================*/
/* 6-1 取得 TDX Access-Token（雙模式） */
async function getTDXAccessToken(){
  if (TDX_TOKEN) return TDX_TOKEN;           // 用一次性 token
  if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET)
    throw new Error('缺少 TDX_TOKEN 或 TDX_CLIENT_ID / SECRET');

  // 已快取？
  if (global.tdxToken && Date.now() < global.tdxTokenExpiry)
    return global.tdxToken;

  // client_credentials 流程
  const url  = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
  const body = new URLSearchParams({
    grant_type   : 'client_credentials',
    client_id    : TDX_CLIENT_ID,
    client_secret: TDX_CLIENT_SECRET
  });
  const { data } = await axios.post(url, body,
    { headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, timeout:8000 });

  global.tdxToken       = data.access_token;
  global.tdxTokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // 提早失效
  return global.tdxToken;
}

/* 6-2 makeCityURL — 自動把 $format 轉 %24format */
function makeCityURL(base, city){
  const qs = new URLSearchParams({ '$format':'JSON' }).toString(); // %24format=JSON
  return `${base}/City/${encodeURIComponent(city)}?${qs}`;
}

/* 6-3 Google → 座標、City 代碼 */
async function geocode(addr){
  if (!GOOGLE_MAPS_KEY) return null;
  try{
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      { params:{ address:addr, key:GOOGLE_MAPS_KEY, language:'zh-TW' }, timeout:8000 }
    );
    if (data.status!=='OK') return null;
    const r = data.results[0];
    return { lat:r.geometry.location.lat, lng:r.geometry.location.lng, formatted:r.formatted_address };
  }catch{ return null; }
}
async function getCityCode(lat,lng){
  if (!GOOGLE_MAPS_KEY) return 'ALL';
  try{
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      { params:{ latlng:`${lat},${lng}`, key:GOOGLE_MAPS_KEY, language:'zh-TW' }, timeout:8000 }
    );
    if (data.status!=='OK') return 'ALL';
    const tw = data.results[0]?.address_components.find(c=>c.types.includes('administrative_area_level_1'))?.long_name;
    const map = {
      '臺北市':'Taipei','台北市':'Taipei','新北市':'NewTaipei','桃園市':'Taoyuan',
      '臺中市':'Taichung','台中市':'Taichung','臺南市':'Tainan','台南市':'Tainan',
      '高雄市':'Kaohsiung','基隆市':'Keelung','新竹市':'Hsinchu','新竹縣':'HsinchuCounty',
      '苗栗縣':'MiaoliCounty','彰化縣':'ChanghuaCounty','南投縣':'NantouCounty',
      '雲林縣':'YunlinCounty','嘉義市':'Chiayi','嘉義縣':'ChiayiCounty',
      '屏東縣':'PingtungCounty','宜蘭縣':'YilanCounty','花蓮縣':'HualienCounty',
      '臺東縣':'TaitungCounty','澎湖縣':'PenghuCounty','金門縣':'KinmenCounty',
      '連江縣':'LienchiangCounty'
    };
    return map[tw] || 'ALL';
  }catch{ return 'ALL'; }
}

/* 6-4 臺北市 OpenData 範例（可自行擴充其他縣市） */
async function taipeiOpenData(lat,lng){
  try{
    const url = 'https://data.taipei/api/v1/dataset/37e1efb9-909b-463f-aac5-076ff107d970?scope=resourceAquire';
    const { data } = await axios.get(url,{ timeout:10000 });
    return (data.result?.results||[])
      .map(r=>({ id:r._id, name:r.name, addr:r.address, lat:+r.lat, lng:+r.lng }))
      .filter(p=>!Number.isNaN(p.lat)&&!Number.isNaN(p.lng)&&haversine(lat,lng,p.lat,p.lng)<=RADIUS_KM);
  }catch(e){
    console.warn('Taipei OpenData error:',e.message);
    return [];
  }
}

/* 6-5 Haversine 已在最上面定義 */

/* =================================================
 *  伺服器啟動完成
 * =================================================*/
