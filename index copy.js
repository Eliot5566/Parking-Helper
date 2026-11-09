// /* -------------------------------------------------
//  *  Parking-bot 2025  —  停車場 + 路邊停車格
//  *  Node ≥ 18   npm i express axios @line/bot-sdk dotenv
//  * ------------------------------------------------*/
// require('dotenv').config();
// const express = require('express');
// const axios   = require('axios');
// const line    = require('@line/bot-sdk');

// /* ---------- 1. ENV ---------- */
// const {
//   LINE_CHANNEL_ACCESS_TOKEN,
//   LINE_CHANNEL_SECRET,
//   GOOGLE_MAPS_KEY   = '',
//   TDX_TOKEN         = '',
//   TDX_CLIENT_ID     = '',
//   TDX_CLIENT_SECRET = '',
//   PORT              = 3450,
// } = process.env;

// /* ---------- 2. LINE SDK ---------- */
// const lineConfig = { channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
//                      channelSecret     : LINE_CHANNEL_SECRET  };
// const client = new line.Client(lineConfig);

// /* ---------- 3. Express ---------- */
// const app = express();
// app.get('/', (_,res)=>res.send('🚗 Parking-bot is running!'));
// app.post('/webhook',
//   line.middleware(lineConfig),
//   express.json(),
//   async (req,res)=>{
//     try{
//       const results = await Promise.all(req.body.events.map(handleEvent));
//       res.json(results);
//     }catch(err){
//       console.error('Webhook error:', err);
//       res.status(500).end();
//     }
// });
// app.listen(PORT,()=>console.log(`🚀 Parking-bot listening on :${PORT}`));

// /* =================================================
//  *  4. 事件處理
//  * =================================================*/
// const MODE_KEYWORDS = {
//   lot : ['停車場','查詢附近停車場'],
//   slot: ['停車格','路邊停車格','查詢附近停車格']
// };
// function detectMode(t){
//   if (MODE_KEYWORDS.slot.some(k=>t.includes(k))) return 'slot';
//   if (MODE_KEYWORDS.lot .some(k=>t.includes(k))) return 'lot';
//   return null;
// }
// const lastMode = new Map();   // userId -> 'lot'|'slot'

// async function handleEvent(e){

//   /* ---------- 4-1 位置訊息 ---------- */
//   if (e.type==='message' && e.message.type==='location'){
//     const mode = lastMode.get(e.source.userId) || 'lot';
//     const { plain, flex } = await findParking(
//       e.message.latitude, e.message.longitude, '', mode);
//     return client.replyMessage(
//       e.replyToken,
//       [ {type:'text', text:plain}, flex ].filter(Boolean)   // 避免 null 造成 400
//     );
//   }

//   /* ---------- 4-2 文字訊息 ---------- */
//   if (e.type==='message' && e.message.type==='text'){
//     const q = e.message.text.trim();
//     const mode = detectMode(q);

//     /* 指令（停車場 / 停車格） */
//     if (mode){
//       if (e.source.userId) lastMode.set(e.source.userId, mode);
//       return client.replyMessage(e.replyToken,{
//         type:'text',
//         text:`請點下方「傳送我的位置」或直接分享定位，即可查詢附近${mode==='lot'?'停車場':'停車格'}。`,
//         quickReply:{ items:[
//           { type:'action', action:{ type:'location', label:'傳送我的位置' } },
//           { type:'action', action:{ type:'message', label:'台北車站', text:'台北車站' } },
//           { type:'action', action:{ type:'message', label:'台北101', text:'台北101'   } },
//           { type:'action', action:{ type:'message', label:'板橋車站', text:'板橋車站' } }
//         ]}
//       });
//     }

//     /* 地址查詢（預設查停車場） */
//     const geo = await geocode(q);
//     if (!geo){
//       return client.replyMessage(e.replyToken,{ type:'text',
//         text:'❓ 找不到此地址，請再確認或直接分享「位置資訊」。'});
//     }
//     const { plain, flex } = await findParking(
//       geo.lat, geo.lng, geo.formatted, 'lot');
//     return client.replyMessage(
//       e.replyToken,
//       [ {type:'text', text:plain}, flex ].filter(Boolean)
//     );
//   }
//   return null;
// }

// /* =================================================
//  *  5. 主功能
//  * =================================================*/
// function toRad(x){ return x*Math.PI/180 }
// function haversine(φ1,λ1,φ2,λ2){
//   const R=6371, dφ=toRad(φ2-φ1), dλ=toRad(λ2-λ1);
//   const a=Math.sin(dφ/2)**2 + Math.cos(toRad(φ1))*Math.cos(toRad(φ2))*Math.sin(dλ/2)**2;
//   return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));   // km
// }

// const RADIUS_KM = 2.5;

// /** mode: 'lot' | 'slot' */
// async function findParking(lat,lng,originLabel='', mode='lot'){
//   /* 5-1 決定 cityCode */
//   const cityCode = await getCityCode(lat,lng);

//   /* 5-2 撈 TDX */
//   let lots=[], liveMap=new Map();
//   if (cityCode!=='ALL'){
//     try{
//       const token   = await getTDXAccessToken();
//       const headers = { Authorization:`Bearer ${token}` };
//       const base    = mode==='lot'
//         ? 'https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet'
//         : 'https://tdx.transportdata.tw/api/basic/v1/Parking/OnStreet';

//       const calls = mode==='lot'
//         ? [
//             axios.get(makeCityURL(`${base}/CarPark`,            cityCode),{headers,timeout:10000}),
//             axios.get(makeCityURL(`${base}/ParkingFacility`,    cityCode),{headers,timeout:10000}),
//             axios.get(makeCityURL(`${base}/ParkingAvailability`,cityCode),{headers,timeout:10000})
//           ]
//         : [
//             axios.get(makeCityURL(`${base}/ParkingSpace`,       cityCode),{headers,timeout:10000}),
//             axios.get(makeCityURL(`${base}/ParkingAvailability`,cityCode),{headers,timeout:10000})
//           ];

//       const [A,B,C] = await Promise.allSettled(calls);

//       if (mode==='lot'){
//         if (A.status==='fulfilled') lots.push(...(A.value.data.CarParks||[]));
//         if (B.status==='fulfilled') lots.push(...(B.value.data.ParkingFacilities||[]));
//         if (C.status==='fulfilled'){
//           const a=C.value.data.ParkingAvailabilities||[];
//           liveMap=new Map(a.map(p=>[p.ParkingFacilityID||p.CarParkID, p.AvailableSpaces??'—']));
//         }
//       }else{
//         if (A.status==='fulfilled') lots.push(...(A.value.data.ParkingSpaces||[]));
//         if (B.status==='fulfilled'){
//           const a=B.value.data.ParkingAvailabilities||[];
//           liveMap=new Map(a.map(p=>[p.ParkingSpaceID, p.AvailableSpaces??'—']));
//         }
//       }
//     }catch(err){ console.warn('TDX fetch error:',err.response?.status||err.message); }
//   }

//   /* 5-3 OpenData Fallback（僅示範台北 Off-Street） */
//   if (!lots.length && mode==='lot') lots = await taipeiOpenData(lat,lng);
//   if (!lots.length){
//     return { plain:`🙈 附近查無${mode==='lot'?'停車場':'停車格'}資料。`, flex:null };
//   }

//   /* 5-4 整理 + 距離排序 */
//   const cand = lots.map(p=>{
//       const pos = mode==='lot'
//         ? (p.CarParkPosition||p.OffStreetMapPosition||{}) : p;
//       const φ=+pos.PositionLat, λ=+pos.PositionLon;
//       if (Number.isNaN(φ)||Number.isNaN(λ)) return null;

//       const name = mode==='lot'
//         ? ((p.CarParkName||p.ParkingFacilityName||{}).Zh_tw||p.CarParkName||p.ParkingFacilityName)
//         : `路邊格 #${p.ParkingSpaceID||p.SpaceID}`;

//       const addr = mode==='lot'
//         ? (p.Address||p.CarParkAddress||'—')
//         : `${p.RoadSection||''}${p.SideName||''}` || '—';

//       return { id:(p.CarParkID||p.ParkingFacilityID||p.ParkingSpaceID),
//                name, addr, lat:φ, lng:λ,
//                dist:haversine(lat,lng,φ,λ) };
//     })
//     .filter(Boolean)
//     .sort((a,b)=>a.dist-b.dist)
//     .slice(0,10);

//   /* 5-5 Google 距離矩陣（選擇性） */
//   if (GOOGLE_MAPS_KEY){
//     try{
//       const dest=cand.map(c=>`${c.lat},${c.lng}`).join('|');
//       const {data}=await axios.get(
//         'https://maps.googleapis.com/maps/api/distancematrix/json',
//         { params:{ origins:`${lat},${lng}`, destinations:dest, mode:'driving',
//                    key:GOOGLE_MAPS_KEY }, timeout:8000 });
//       if (data.status==='OK'){
//         data.rows[0].elements.forEach((e,i)=>{
//           cand[i].road=e.status==='OK'?(e.distance.value/1000).toFixed(1)+' km':null;
//           cand[i].time=e.status==='OK'?e.duration.text:null;
//         });
//       }
//     }catch{/* ignore */}
//   }

//   /* 5-6 純文字備援 */
//   const plainLines = cand.slice(0,5).map(c=>{
//     const avail = liveMap.get(c.id);
//     return [
//       `${mode==='lot'?'🅿️':'🚗'} ${c.name}`,
//       `地址：${c.addr}`,
//       avail!==undefined ? `剩餘：${avail}` : null,
//       c.road ? `開車：${c.road}，約 ${c.time}` : `直線距離：${c.dist.toFixed(2)} km`
//     ].filter(Boolean).join('\n');
//   });
//   const srcNote = liveMap.size
//       ? `📊 資料來源：TDX ${mode==='lot'?'Off-Street':'On-Street'}`
//       : '📊 資料來源：地方政府 OpenData';
//   const plain = (originLabel?`📍 ${originLabel}\n\n`:'') +
//                 plainLines.join('\n\n') + '\n\n' + srcNote;

//   /* 5-7 Flex */
//   const flex = buildParkingFlex(cand, liveMap, mode);
//   return { plain, flex };
// }

// /* =================================================
//  *  6. Flex 產生器
//  * =================================================*/
// function buildParkingFlex(cand, live, mode){
//   const bubbles = cand.slice(0,5).map(c=>{
//     const heroURL = 'https://your.cdn.com/parking-hero.png';      // 固定圖示
//     const nav = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
//     const avail = live.get(c.id);
//     const dist  = c.road || `${c.dist.toFixed(2)} km`;

//     return {
//       type:'bubble',
//       hero:{ type:'image', url:heroURL, size:'full', aspectRatio:'3:2',
//              aspectMode:'cover', action:{ type:'uri', uri:nav }},
//       body:{ type:'box', layout:'vertical', spacing:'sm', contents:[
//         { type:'text', text:`${mode==='lot'?'🅿️':'🚗'} ${c.name}`, weight:'bold', size:'lg', wrap:true },
//         { type:'text', text:`地址：${c.addr}`, size:'sm', color:'#666666', wrap:true },
//         avail!==undefined ? { type:'text', text:`剩餘：${avail}`, size:'sm', color:'#666666' } : null,
//         { type:'text', text:`距離：約 ${dist}`, size:'sm', color:'#666666' }
//       ].filter(Boolean)},
//       footer:{ type:'box', layout:'vertical', contents:[
//         { type:'button', style:'primary', color:'#D14124',
//           action:{ type:'uri', label:'一鍵導航', uri:nav }}
//       ]}
//     };
//   });

//   return { type:'flex', altText:'附近停車列表', contents:{ type:'carousel', contents:bubbles }};
// }

// /* =================================================
//  *  7. 支援函式：TDX / Google / OpenData
//  * =================================================*/
// async function getTDXAccessToken(){
//   if (TDX_TOKEN) return TDX_TOKEN;
//   if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET)
//     throw new Error('缺少 TDX_TOKEN 或 TDX_CLIENT_ID / SECRET');

//   if (global.tdxToken && Date.now() < global.tdxTokenExpiry)
//     return global.tdxToken;

//   const url='https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
//   const body=new URLSearchParams({
//     grant_type   :'client_credentials',
//     client_id    :TDX_CLIENT_ID,
//     client_secret:TDX_CLIENT_SECRET
//   });
//   const {data}=await axios.post(url, body,
//     { headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, timeout:8000 });

//   global.tdxToken=data.access_token;
//   global.tdxTokenExpiry=Date.now()+(data.expires_in-60)*1000;
//   return global.tdxToken;
// }

// function makeCityURL(base, city){
//   const qs=new URLSearchParams({ '$format':'JSON' }).toString(); // %24format=JSON
//   return `${base}/City/${encodeURIComponent(city)}?${qs}`;
// }

// async function geocode(addr){
//   if (!GOOGLE_MAPS_KEY) return null;
//   try{
//     const {data}=await axios.get(
//       'https://maps.googleapis.com/maps/api/geocode/json',
//       { params:{ address:addr, key:GOOGLE_MAPS_KEY, language:'zh-TW' }, timeout:8000 });
//     if (data.status!=='OK') return null;
//     const r=data.results[0];
//     return { lat:r.geometry.location.lat, lng:r.geometry.location.lng,
//              formatted:r.formatted_address };
//   }catch{ return null; }
// }

// async function getCityCode(lat,lng){
//   if (!GOOGLE_MAPS_KEY) return 'ALL';
//   try{
//     const {data}=await axios.get(
//       'https://maps.googleapis.com/maps/api/geocode/json',
//       { params:{ latlng:`${lat},${lng}`, key:GOOGLE_MAPS_KEY, language:'zh-TW' },
//         timeout:8000 });
//     if (data.status!=='OK') return 'ALL';
//     const tw=data.results[0]?.address_components
//                   .find(c=>c.types.includes('administrative_area_level_1'))?.long_name;
//     const map={
//       '臺北市':'Taipei','台北市':'Taipei','新北市':'NewTaipei','桃園市':'Taoyuan',
//       '臺中市':'Taichung','台中市':'Taichung','臺南市':'Tainan','台南市':'Tainan',
//       '高雄市':'Kaohsiung','基隆市':'Keelung','新竹市':'Hsinchu','新竹縣':'HsinchuCounty',
//       '苗栗縣':'MiaoliCounty','彰化縣':'ChanghuaCounty','南投縣':'NantouCounty',
//       '雲林縣':'YunlinCounty','嘉義市':'Chiayi','嘉義縣':'ChiayiCounty',
//       '屏東縣':'PingtungCounty','宜蘭縣':'YilanCounty','花蓮縣':'HualienCounty',
//       '臺東縣':'TaitungCounty','澎湖縣':'PenghuCounty','金門縣':'KinmenCounty',
//       '連江縣':'LienchiangCounty'
//     };
//     return map[tw] || 'ALL';
//   }catch{ return 'ALL'; }
// }

// /* 只有台北示範；要其他縣市請自行擴充 */
// async function taipeiOpenData(lat,lng){
//   try{
//     const url='https://data.taipei/api/v1/dataset/37e1efb9-909b-463f-aac5-076ff107d970?scope=resourceAquire';
//     const {data}=await axios.get(url,{timeout:10000});
//     return (data.result?.results||[])
//       .map(r=>({ id:r._id, name:r.name, addr:r.address, lat:+r.lat, lng:+r.lng }))
//       .filter(p=>!Number.isNaN(p.lat)&&!Number.isNaN(p.lng)&&haversine(lat,lng,p.lat,p.lng)<=RADIUS_KM);
//   }catch(e){
//     console.warn('Taipei OpenData error:',e.message);
//     return [];
//   }
// }

//上面停車格/停車場版本
/* -------------------------------------------------
 *  Parking-bot 2025 — 停車場 + 路邊停車格 (Segment 版)
 * ------------------------------------------------*/

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const line = require('@line/bot-sdk');
const rateLimit = require('express-rate-limit');

/* ---------- 1. ENV ---------- */
const {
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  GOOGLE_MAPS_KEY = '',
  TDX_TOKEN = '',
  TDX_CLIENT_ID = '',
  TDX_CLIENT_SECRET = '',
  PORT = 3450,
} = process.env;

/* ---------- 2. LINE / Express ---------- */
const lineConfig = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: LINE_CHANNEL_SECRET,
};
const client = new line.Client(lineConfig);

const app = express();

// --- 防刷流量控管 ---
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 每 IP 每分鐘最多 10 次
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 429,
    message: '⚠️ 請勿過度頻繁操作，請稍後再試。',
  },
});

// 只針對 /webhook 路徑加嚴格限制
app.use('/webhook', limiter);

app.get('/', (_, res) => res.send('🚗 Parking-bot is running!'));

// 新增 getCityCode API 路由
app.get('/getCityCode', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat/lng required' });
  try {
    const code = await getCityCode(Number(lat), Number(lng));
    res.json({ cityCode: code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post('/webhook', line.middleware(lineConfig), async (req, res) => {
  try {
    const r = await Promise.all(req.body.events.map(handleEvent));
    res.json(r);
  } catch (e) {
    console.error('Webhook error:', e);
    res.status(500).end();
  }
});
app.listen(PORT, () => console.log(`🚀 Listening on :${PORT}`));

/* ---------- 3. 指令 ---------- */
const MODE_KEYWORDS = {
  lot: ['停車場', '查詢附近停車場'],
  slot: ['停車格', '路邊停車格', '查詢附近停車格'],
};
function detectMode(t) {
  if (MODE_KEYWORDS.slot.some((k) => t.includes(k))) return 'slot';
  if (MODE_KEYWORDS.lot.some((k) => t.includes(k))) return 'lot';
  return null;
}
const lastMode = new Map(); // userId → 'lot'|'slot'

/* ---------- 4. 事件 ---------- */
async function handleEvent(e) {
  /* 4-1 位置訊息 */
  if (e.type === 'message' && e.message.type === 'location') {
    const mode = lastMode.get(e.source.userId) || 'lot';
    const r = await findParking(
      e.message.latitude,
      e.message.longitude,
      '',
      mode
    );
    return client.replyMessage(
      e.replyToken,
      [{ type: 'text', text: r.plain }, r.flex].filter(Boolean)
    );
  }

  /* 4-2 文字訊息 */
  if (e.type === 'message' && e.message.type === 'text') {
    const q = e.message.text.trim();
    const mode = detectMode(q);

    /* 指令 */
    if (mode) {
      if (e.source.userId) lastMode.set(e.source.userId, mode);
      return client.replyMessage(e.replyToken, {
        type: 'text',
        text: `請點下方「傳送我的位置」或直接分享定位，即可查詢附近${
          mode === 'lot' ? '停車場' : '停車格'
        }。`,
        quickReply: {
          items: [
            {
              type: 'action',
              action: { type: 'location', label: '傳送我的位置' },
            },
          ],
        },
      });
    }

    /* 地址→停車場 */
    const geo = await geocode(q);
    if (!geo)
      return client.replyMessage(e.replyToken, {
        type: 'text',
        text: '❓ 找不到此地址，請再確認或直接分享「位置資訊」。',
      });
    const r = await findParking(geo.lat, geo.lng, geo.formatted, 'lot');
    return client.replyMessage(
      e.replyToken,
      [{ type: 'text', text: r.plain }, r.flex].filter(Boolean)
    );
  }
  return null;
}

/* =================================================
 *  5. 主功能
 * =================================================*/
function toRad(x) {
  return (x * Math.PI) / 180;
}
function haversine(φ1, λ1, φ2, λ2) {
  const R = 6371,
    dφ = toRad(φ2 - φ1),
    dλ = toRad(λ2 - λ1);
  const a =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(toRad(φ1)) * Math.cos(toRad(φ2)) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); // km
}
const RADIUS_KM = 2.5; // 篩選半徑

async function findParking(lat, lng, originLabel = '', mode = 'lot') {
  // 取出所有常見費率欄位
  function extractRates(r) {
    let allRates = [];
    if (Array.isArray(r.ParkingRates))
      allRates = allRates.concat(r.ParkingRates);
    if (Array.isArray(r.HourlyRates)) allRates = allRates.concat(r.HourlyRates);
    if (Array.isArray(r.FlatRates)) allRates = allRates.concat(r.FlatRates);
    if (Array.isArray(r.RentRates)) allRates = allRates.concat(r.RentRates);
    if (Array.isArray(r.FreeRates)) allRates = allRates.concat(r.FreeRates);
    return allRates;
  }
  const token = await getTDXAccessToken();
  const headers = { Authorization: `Bearer ${token}` };
  const cityCode = await getCityCode(lat, lng);

  let rows = [],
    liveMap = new Map(),
    rateMap = new Map(),
    chargeTimeMap = new Map();

  // 5-1 Off-Street 停車場
  if (mode === 'lot') {
    if (cityCode !== 'ALL') {
      const base =
        'https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet';
      const [car, fac, ava, rate] = await Promise.allSettled([
        axios.get(makeCityURL(`${base}/CarPark`, cityCode), {
          headers,
          timeout: 10000,
        }),
        axios.get(makeCityURL(`${base}/ParkingFacility`, cityCode), {
          headers,
          timeout: 10000,
        }),
        axios.get(makeCityURL(`${base}/ParkingAvailability`, cityCode), {
          headers,
          timeout: 10000,
        }),
        axios.get(makeCityURL(`${base}/ParkingRate`, cityCode), {
          headers,
          timeout: 10000,
        }),
      ]);
      if (car.status === 'fulfilled') {
        const carParks = car.value.data.CarParks || [];
        console.log('cityCode:', cityCode, 'CarParks.length:', carParks.length);
        // 只保留有 CarParkID 的資料
        rows.push(...carParks.filter((p) => p.CarParkID));
      }
      // 不再合併 ParkingFacilities，避免 ID 對不起來
      if (ava.status === 'fulfilled')
        (ava.value.data.ParkingAvailabilities || []).forEach((a) => {
          const key = String(a.ParkingFacilityID || a.CarParkID);
          liveMap.set(key, a.AvailableSpaces ?? '—');
        });
      if (rate.status === 'fulfilled')
        (rate.value.data.ParkingRates || []).forEach((r) => {
          const key = String(r.ParkingFacilityID || r.CarParkID);
          rateMap.set(key, r);
        });
    }
    if (!rows.length) rows = await taipeiOpenData(lat, lng);
    if (!rows.length) return noData(mode);
  }

  // 5-2 On-Street 停車格 (Segment)
  if (mode === 'slot') {
    if (cityCode === 'ALL') return noData(mode);

    const base = 'https://tdx.transportdata.tw/api/basic/v1/Parking/OnStreet';
    const [seg, ava, rate, chargeTime] = await Promise.allSettled([
      axios.get(makeCityURL(`${base}/ParkingSegment`, cityCode), {
        headers,
        timeout: 10000,
      }),
      axios.get(makeCityURL(`${base}/ParkingSegmentAvailability`, cityCode), {
        headers,
        timeout: 10000,
      }),
      axios.get(makeCityURL(`${base}/ParkingSegmentRate`, cityCode), {
        headers,
        timeout: 10000,
      }),
      axios.get(makeCityURL(`${base}/ParkingSegmentChargeTime`, cityCode), {
        headers,
        timeout: 10000,
      }),
    ]);
    if (seg.status === 'fulfilled') rows = seg.value.data.ParkingSegments || [];
    if (!rows.length) return noData(mode);

    if (ava.status === 'fulfilled')
      (ava.value.data.CurbParkingSegmentAvailabilities || []).forEach((a) => {
        const key = String(a.ParkingSegmentID);
        liveMap.set(key, a.AvailableSpaces ?? '—');
      });
    if (rate.status === 'fulfilled')
      (rate.value.data.ParkingSegmentRates || []).forEach((r) => {
        const key = String(r.ParkingSegmentID);
        rateMap.set(key, r);
      });
    if (chargeTime.status === 'fulfilled')
      (chargeTime.value.data.ParkingSegmentChargeTimes || []).forEach((r) => {
        const key = String(r.ParkingSegmentID);
        chargeTimeMap.set(key, r);
      });
  }

  // 5-3 組合 / 排序
  // Debug: 印出主資料與費率 Map 的 key
  console.log('rows:', rows);
  console.log(
    '主資料 IDs:',
    rows.map((p) => String(p.CarParkID))
  );
  console.log('費率 Map keys:', Array.from(rateMap.keys()));

  const list = rows
    .map((p) => {
      const pos =
        mode === 'lot'
          ? p.CarParkPosition || p.OffStreetMapPosition || {}
          : p.ParkingSegmentPosition || {};
      const φ = +pos.PositionLat,
        λ = +pos.PositionLon;
      if (Number.isNaN(φ) || Number.isNaN(λ)) return null;
      // slot 模式下 id 應用 ParkingSegmentID
      const id =
        mode === 'lot' ? String(p.CarParkID) : String(p.ParkingSegmentID);
      const name =
        mode === 'lot'
          ? (p.CarParkName || {}).Zh_tw || p.CarParkName || `停車場 ${id}`
          : p.ParkingSegmentName?.Zh_tw || `路段 ${id}`;
      // slot 地址組合 RoadSection
      const addr =
        mode === 'lot'
          ? p.Address || p.CarParkAddress || '—'
          : (typeof p.RoadSection === 'object'
              ? [p.RoadSection.Start, p.RoadSection.End]
                  .filter(Boolean)
                  .join('~')
              : p.RoadSection) ||
            (typeof p.SideName === 'object' ? p.SideName?.Zh_tw : p.SideName) ||
            '—';

      // slot 模式優先顯示主資料的 FareDescription
      let rateInfo = '暫無資料',
        chargeTimeInfo = null;
      if (mode === 'lot') {
        const r = rateMap.get(id);
        if (!r) console.log('找不到費率資料 id:', id);
        else console.log('費率資料:', r);
        if (r) {
          const allRates = extractRates(r);
          if (allRates.length > 0) {
            // 優先顯示 RateDescription，其次 RateName，再組合金額
            const descs = allRates
              .map((x) => x.RateDescription || x.RateName)
              .filter(Boolean);
            if (descs.length > 0) {
              rateInfo = descs.join('；');
            } else {
              const prices = allRates
                .map((x) => {
                  if (x.RatePrice && x.RateQualifier)
                    return `${x.RatePrice}元/${x.RateQualifier}分`;
                  if (x.RatePrice) return `${x.RatePrice}元`;
                  return null;
                })
                .filter(Boolean);
              if (prices.length > 0) rateInfo = prices.join('；');
            }
          }
        }
      } else {
        // slot: 優先主資料的 FareDescription
        if (
          p.FareDescription &&
          typeof p.FareDescription === 'string' &&
          p.FareDescription.trim()
        ) {
          rateInfo = p.FareDescription.trim();
        } else {
          // fallback: rateMap
          const r = rateMap.get(id);
          if (!r) console.log('找不到費率資料 id:', id);
          else console.log('費率資料:', r);
          if (
            r &&
            Array.isArray(r.ParkingSegmentRates) &&
            r.ParkingSegmentRates.length > 0
          ) {
            const descs = r.ParkingSegmentRates.map(
              (x) => x.Description
            ).filter(Boolean);
            if (descs.length > 0) {
              rateInfo = descs.join('；');
            } else {
              const rates = r.ParkingSegmentRates.map((x) => {
                if (x.ChargeAmount && x.ChargeType)
                  return `${x.ChargeAmount}元/${x.ChargeType}`;
                if (x.ChargeAmount) return `${x.ChargeAmount}元`;
                return null;
              }).filter(Boolean);
              if (rates.length > 0) rateInfo = rates.join('；');
            }
          }
        }
        const t = chargeTimeMap.get(id);
        if (
          t &&
          Array.isArray(t.ParkingSegmentChargeTimes) &&
          t.ParkingSegmentChargeTimes.length > 0
        ) {
          const timeDescs = t.ParkingSegmentChargeTimes.map(
            (x) => x.ChargeTimeDescription
          ).filter(Boolean);
          if (timeDescs.length > 0) chargeTimeInfo = timeDescs.join('；');
        }
      }
      return {
        id,
        name,
        addr,
        lat: φ,
        lng: λ,
        avail: liveMap.get(id),
        dist: haversine(lat, lng, φ, λ),
        rateInfo,
        chargeTimeInfo,
        source: 'TDX',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 10);

  // 5-3.1 Google Places API (補充私有/民營停車場)
  let googlePlaces = [];
  const GOOGLE_RADIUS = 2500; // 2.5 公里
  if (mode === 'lot' && GOOGLE_MAPS_KEY) {
    try {
      const { data } = await axios.get(
        'https://maps.googleapis.com/maps/api/place/nearbysearch/json',
        {
          params: {
            location: `${lat},${lng}`,
            radius: GOOGLE_RADIUS,
            type: 'parking',
            key: GOOGLE_MAPS_KEY,
            language: 'zh-TW',
          },
        }
      );
      googlePlaces = (data.results || [])
        .map((p) => ({
          id: p.place_id,
          name: p.name,
          addr: p.vicinity || p.formatted_address || '—',
          lat: p.geometry.location.lat,
          lng: p.geometry.location.lng,
          dist: haversine(
            lat,
            lng,
            p.geometry.location.lat,
            p.geometry.location.lng
          ),
          source: 'Google',
          photoRef:
            p.photos && p.photos.length > 0
              ? p.photos[0].photo_reference
              : null,
        }))
        .filter((p) => p.dist <= RADIUS_KM); // 只保留2.5公里內
    } catch (e) {
      if (e.response && e.response.data) {
        console.warn(
          'Google Places API error:',
          JSON.stringify(e.response.data),
          e.response.status
        );
      } else {
        console.warn('Google Places API error:', e.message);
      }
    }
  }

  // 合併 TDX/OD 與 Google 結果，Google 結果優先，且都過濾距離
  const allList = [
    ...googlePlaces.filter(
      (g) =>
        !list.some(
          (t) =>
            Math.abs(t.lat - g.lat) < 0.0002 && Math.abs(t.lng - g.lng) < 0.0002
        )
    ),
    ...list,
  ]
    .filter((p) => p.dist <= RADIUS_KM)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 10);

  /* ---------- 5-4 Google 距離 (可選) ---------- */
  if (GOOGLE_MAPS_KEY && allList.length) {
    try {
      const dest = allList.map((c) => `${c.lat},${c.lng}`).join('|');
      const { data } = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        {
          params: {
            origins: `${lat},${lng}`,
            destinations: dest,
            mode: 'driving',
            key: GOOGLE_MAPS_KEY,
          },
          timeout: 8000,
        }
      );
      if (data.status === 'OK')
        data.rows[0].elements.forEach((e, i) => {
          allList[i].road =
            e.status === 'OK'
              ? (e.distance.value / 1000).toFixed(1) + ' km'
              : null;
          allList[i].time = e.status === 'OK' ? e.duration.text : null;
        });
    } catch {}
  }

  // 5-5 純文字
  const plain =
    (originLabel ? `📍 ${originLabel}\n\n` : '') +
    allList
      .slice(0, 5)
      .map((c) =>
        [
          `${mode === 'lot' ? '🅿️' : '🚗'} ${c.name}`,
          `地址：${c.addr}`,
          c.avail !== undefined ? `剩餘：${c.avail}` : null,
          c.rateInfo ? `收費：${c.rateInfo}` : null,
          c.chargeTimeInfo ? `時段：${c.chargeTimeInfo}` : null,
          c.source ? `來源：${c.source}` : null,
          c.road
            ? `開車：${c.road}，約 ${c.time}`
            : `直線距離：${c.dist.toFixed(2)} km`,
        ]
          .filter(Boolean)
          .join('\n')
      )
      .join('\n\n') +
    `\n\n⚠️ 請注意行車安全`;

  return { plain, flex: buildFlex(allList, mode) };
}
function noData(mode) {
  return {
    plain: `🙈 目前該地區尚無${mode === 'lot' ? '停車場' : '路邊停車格'}資料。`,
    flex: null,
  };
}

/* ---------- 6. Flex ---------- */
function buildFlex(arr, mode) {
  return {
    type: 'flex',
    altText: '附近停車列表',
    contents: {
      type: 'carousel',
      contents: arr.slice(0, 5).map((c) => {
        const nav = `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
        // 圖片優先順序：Google 停車場用 Google 圖片，否則用 hero.png
        let img = 'https://meee.com.tw/QbyEYCO';
        if (c.source === 'Google' && c.id) {
          img = c.photoRef
            ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=600&photoreference=${c.photoRef}&key=${process.env.GOOGLE_MAPS_KEY}`
            : 'https://maps.gstatic.com/mapfiles/place_api/icons/v1/png_71/parking-71.png';
        }
        return {
          type: 'bubble',
          hero: {
            type: 'image',
            url: img,
            size: 'full',
            aspectRatio: '3:2',
            aspectMode: 'cover',
            action: { type: 'uri', uri: nav },
          },
          body: {
            type: 'box',
            layout: 'vertical',
            spacing: 'sm',
            contents: [
              {
                type: 'text',
                text: `${mode === 'lot' ? '🅿️' : '🚗'} ${c.name}`,
                weight: 'bold',
                size: 'lg',
                wrap: true,
              },
              {
                type: 'text',
                text: c.addr ? `地址：${c.addr}` : '',
                size: 'sm',
                color: '#666666',
                wrap: true,
              },
              c.road
                ? {
                    type: 'text',
                    text: `開車：約 ${c.road}`,
                    size: 'sm',
                    color: '#666666',
                  }
                : {
                    type: 'text',
                    text: `距離：約 ${c.dist.toFixed(2)} km`,
                    size: 'sm',
                    color: '#666666',
                  },
              c.avail !== undefined
                ? {
                    type: 'text',
                    text: `剩餘：${c.avail}`,
                    size: 'sm',
                    color: '#666666',
                  }
                : null,
              c.rateInfo
                ? {
                    type: 'text',
                    text: `收費：${c.rateInfo}`,
                    size: 'sm',
                    color: '#666666',
                  }
                : null,
              c.chargeTimeInfo
                ? {
                    type: 'text',
                    text: `時段：${c.chargeTimeInfo}`,
                    size: 'sm',
                    color: '#666666',
                  }
                : null,
              c.source
                ? {
                    type: 'text',
                    text: `來源：${c.source}`,
                    size: 'sm',
                    color: '#999999',
                  }
                : null,
            ].filter(Boolean),
          },
          footer: {
            type: 'box',
            layout: 'vertical',
            contents: [
              {
                type: 'button',
                style: 'primary',
                color: '#D14124',
                action: { type: 'uri', label: '一鍵導航', uri: nav },
              },
            ],
          },
        };
      }),
    },
  };
}

/* ---------- 7. TDX / Google / OpenData ---------- */
async function getTDXAccessToken() {
  if (TDX_TOKEN) return TDX_TOKEN;
  if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET)
    throw new Error('TDX creds missing');
  if (global.tdx && Date.now() < global.tdx.exp) return global.tdx.token;
  const { data } = await axios.post(
    'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token',
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: TDX_CLIENT_ID,
      client_secret: TDX_CLIENT_SECRET,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  global.tdx = {
    token: data.access_token,
    exp: Date.now() + (data.expires_in - 60) * 1000,
  };
  return data.access_token;
}
function makeCityURL(base, city) {
  return `${base}/City/${encodeURIComponent(city)}?%24format=JSON`;
}

async function geocode(addr) {
  if (!GOOGLE_MAPS_KEY) return null;
  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      { params: { address: addr, key: GOOGLE_MAPS_KEY, language: 'zh-TW' } }
    );
    if (data.status !== 'OK') return null;
    const r = data.results[0];
    return {
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formatted: r.formatted_address,
    };
  } catch {
    return null;
  }
}
async function getCityCode(lat, lng) {
  if (!GOOGLE_MAPS_KEY) return 'ALL';
  try {
    const { data } = await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      {
        params: {
          latlng: `${lat},${lng}`,
          key: GOOGLE_MAPS_KEY,
          language: 'zh-TW',
        },
      }
    );
    if (data.status !== 'OK') return 'ALL';
    const tw = data.results[0]?.address_components.find((c) =>
      c.types.includes('administrative_area_level_1')
    )?.long_name;
    const map = {
      臺北市: 'Taipei',
      台北市: 'Taipei',
      新北市: 'NewTaipei',
      桃園市: 'Taoyuan',
      臺中市: 'Taichung',
      台中市: 'Taichung',
      臺南市: 'Tainan',
      台南市: 'Tainan',
      高雄市: 'Kaohsiung',
      基隆市: 'Keelung',
      新竹市: 'Hsinchu',
      新竹縣: 'HsinchuCounty',
      苗栗縣: 'MiaoliCounty',
      彰化縣: 'ChanghuaCounty',
      南投縣: 'NantouCounty',
      雲林縣: 'YunlinCounty',
      嘉義市: 'Chiayi',
      嘉義縣: 'ChiayiCounty',
      屏東縣: 'PingtungCounty',
      宜蘭縣: 'YilanCounty',
      花蓮縣: 'HualienCounty',
      臺東縣: 'TaitungCounty',
      澎湖縣: 'PenghuCounty',
      金門縣: 'KinmenCounty',
      連江縣: 'LienchiangCounty',
    };
    return map[tw] || 'ALL';
  } catch {
    return 'ALL';
  }
}
async function taipeiOpenData(lat, lng) {
  try {
    const url =
      'https://data.taipei/api/v1/dataset/37e1efb9-909b-463f-aac5-076ff107d970?scope=resourceAquire';
    const { data } = await axios.get(url, { timeout: 10000 });
    return (data.result?.results || [])
      .map((r) => ({
        id: r._id,
        name: r.name,
        addr: r.address,
        lat: +r.lat,
        lng: +r.lng,
      }))
      .filter(
        (p) =>
          !Number.isNaN(p.lat) && haversine(lat, lng, p.lat, p.lng) <= RADIUS_KM
      );
  } catch {
    return [];
  }
}
