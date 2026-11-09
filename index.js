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

const crypto = require('crypto');

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

/* ---------- 2. LINE / Express 基礎啟動 ---------- */
const lineConfig = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: LINE_CHANNEL_SECRET || ''
};
let client = null;
try {
  if (LINE_CHANNEL_ACCESS_TOKEN && LINE_CHANNEL_SECRET) {
    client = new line.Client(lineConfig);
  } else {
    console.warn('⚠️ 缺少 LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET，將以本地模式執行，不處理 webhook。');
  }
} catch (e) {
  console.warn('建立 LINE Client 失敗：', e.message);
}


const app = express();
// 若部署在反向代理 (例如 Render / Heroku / Nginx) 且會加上 X-Forwarded-*，需啟用 trust proxy；
// 本地測試若出現 express-rate-limit 的 X-Forwarded-For 警告，也可透過此設定移除。
app.set('trust proxy', 1);
// 保存 LINE Webhook 原始請求體以通過簽章驗證
const rawBodySaver = (req, res, buf) => { if (req.originalUrl === '/webhook') req.rawBody = buf; };
app.use(express.json({ verify: rawBodySaver }));
const rateLimit = require('express-rate-limit');
const limiter = rateLimit({ windowMs:60*1000, max:30, standardHeaders:true, legacyHeaders:false });
if (client) app.use('/webhook', limiter);

// 使用者狀態暫存
const lastMode = new Map(); // userId -> 'lot'|'slot'
const lastResults = new Map(); // userId -> 最近查詢結果
if(!global.userProfiles) global.userProfiles = new Map();
if(!global.parkingEvents) global.parkingEvents = []; // {id,name,lat,lng,radius,start,end,notice}

function getUserProfile(userId){
  if(!userId) return null;
  if(!global.userProfiles.has(userId)){
    global.userProfiles.set(userId, {
      favorites:new Set(),
      reports:[],
      timers:[],
      activeTimer:null,
      parkedLocation:null,
      prefs:{ distance:0.5, avail:0.3, price:0.2, evOnly:false },
      stats:{ searches:0, found:0 }
    });
  }
  return global.userProfiles.get(userId);
}
// 查詢模式關鍵字與偵測 (lot=停車場 / slot=路邊停車格)
const MODE_KEYWORDS = {
  lot : ['停車場','查詢附近停車場','找停車場','附近停車場'],
  slot: ['停車格','路邊停車格','查詢附近停車格','找停車格','附近停車格']
};
function detectMode(t){
  if(!t) return null;
  if(MODE_KEYWORDS.slot.some(k=>t.includes(k))) return 'slot';
  if(MODE_KEYWORDS.lot.some(k=>t.includes(k))) return 'lot';
  return null;
}
function activeEvents(lat,lng,now=Date.now()){
  return global.parkingEvents.filter(e=> now>=e.start && now<=e.end && haversine(lat,lng,e.lat,e.lng) <= (e.radius/1000));
}

app.get('/', (_,res)=>res.send('🚗 Parking-bot server 已啟動')); 
app.get('/health', (_,res)=>res.json({ ok:true, time:new Date().toISOString() }));
app.get('/getCityCode', async (req,res)=>{
  const {lat,lng} = req.query; if(!lat||!lng) return res.status(400).json({error:'lat/lng required'});
  try{ const c = await getCityCode(+lat,+lng); res.json({cityCode:c}); }catch(e){ res.status(500).json({error:e.message}); }
});
// 簡易活動列出（之後可加認證）
app.get('/events', (_,res)=> res.json(global.parkingEvents));

if (client){
  app.post('/webhook', line.middleware(lineConfig), async (req,res)=>{
    try{
      const result = await Promise.all(req.body.events.map(handleEvent));
      res.json(result);
    }catch(e){ console.error('Webhook error:', e); res.status(500).end(); }
  });
}

app.listen(PORT, ()=> console.log(`🚀 停車服務啟動於 :${PORT}`));

/* ---------- 4. 事件 ---------- */
async function handleEvent(e) {
  const userId = e.source?.userId;
  const profile = getUserProfile(userId);
  /* 4-1 位置訊息 */
  if (e.type === 'message' && e.message.type === 'location') {
    const latMsg = e.message.latitude;
    const lngMsg = e.message.longitude;
    // 若正在計時且尚未記錄停車位置 => 只記錄，不觸發查詢以節省 API
    if(profile && profile.activeTimer && !profile.parkedLocation){
      const candidates = lastResults.get(userId) || [];
      let nearest = null, minD = Infinity;
      for(const c of candidates){
        const d = haversine(latMsg, lngMsg, c.lat, c.lng);
        if(d < minD){ minD = d; nearest = c; }
      }
      if(nearest && minD <= 0.25){ // 250 公尺內視為停在該停車場/路段
        profile.parkedLocation = { lat:latMsg, lng:lngMsg, lotId:nearest.id, lotName:nearest.name, ts:Date.now(), distToLot:minD };
        if(profile.activeTimer) profile.activeTimer.lotId = nearest.id;
        return client.replyMessage(e.replyToken,{ type:'text', text:`✅ 已記錄停車位置：${nearest.name}\n距離結果座標 ${minD.toFixed(2)} km\n輸入「找車」可導航回車，或「更新停車位置」重新設定。` });
      }else{
        profile.parkedLocation = { lat:latMsg, lng:lngMsg, lotId:null, lotName:null, ts:Date.now() };
        return client.replyMessage(e.replyToken,{ type:'text', text:'✅ 已記錄停車座標 (未匹配附近停車場)。輸入「找車」可導航回車，或再次分享位置覆蓋。' });
      }
    }
    // 否則執行一般查詢流程
    const mode = lastMode.get(e.source.userId) || 'lot';
    const r = await findParking(latMsg, lngMsg, '', mode, userId);
    lastResults.set(userId, r.rawList);
    if(profile){ profile.stats.searches++; profile.lastSearchOrigin = { lat:latMsg,lng:lngMsg,mode,ts:Date.now() }; }
    const acts = activeEvents(latMsg, lngMsg);
    const actMsg = acts.length ? [{ type:'text', text: '🎪 附近活動：\n' + acts.map(a=>`${a.name} - ${a.notice||''}`).join('\n') }] : [];
    return client.replyMessage(e.replyToken,[ { type: 'text', text: r.plain }, r.flex, ...actMsg ].filter(Boolean));
  }

  /* 4-2 文字訊息 */
  if (e.type === 'message' && e.message.type === 'text') {
    const q = e.message.text.trim();
    // --- 系統指令處理 (簡易) ---
    const lower = q.toLowerCase();
    if(lower === '我的收藏' && profile){
      const favIds = Array.from(profile.favorites);
      if(!favIds.length) return client.replyMessage(e.replyToken,{ type:'text', text:'⭐ 尚未收藏。可在查詢結果後用「收藏 ID」指令收藏。'});
      const list = (lastResults.get(userId)||[]).filter(x=>profile.favorites.has(x.id));
      if(list.length){
        return client.replyMessage(e.replyToken,{ type:'text', text:'⭐ 我的收藏：\n'+ list.map(c=>`${c.id} ${c.name} (${c.dist.toFixed(2)}km)`).join('\n') });
      }else{
        return client.replyMessage(e.replyToken,{ type:'text', text:'⭐ 收藏 ID：'+favIds.join(', ')+' (如需詳細請再次分享目前位置查詢)' });
      }
    }
    if(/^收藏\s+\S+/.test(q) && profile){
      const id = q.split(/\s+/)[1];
      profile.favorites.add(id);
      return client.replyMessage(e.replyToken,{ type:'text', text:`已收藏 ${id}。` });
    }
    if(/^取消收藏\s+\S+/.test(q) && profile){
      const id = q.split(/\s+/)[1];
      profile.favorites.delete(id);
      return client.replyMessage(e.replyToken,{ type:'text', text:`已取消收藏 ${id}。` });
    }
  if(/^回報\s+\S+\s+\S+/.test(q) && profile){
      const [, targetId, statusRaw] = q.split(/\s+/);
      const statusMap = { '有位':'AVAILABLE','滿':'FULL','關閉':'CLOSED' };
      const status = statusMap[statusRaw] || statusRaw.toUpperCase();
      profile.reports.push({ id:crypto.randomUUID(), targetId, status, ts:Date.now() });
      return client.replyMessage(e.replyToken,{ type:'text', text:`✅ 已回報 ${targetId} 狀態：${status}` });
    }
  if(q === '只看EV' && profile){ profile.prefs.evOnly = true; return client.replyMessage(e.replyToken,{ type:'text', text:'🔌 已啟用只看 EV/充電停車場。'}); }
  if(q === '取消EV' && profile){ profile.prefs.evOnly = false; return client.replyMessage(e.replyToken,{ type:'text', text:'🔌 已取消只看 EV 篩選。'}); }
    if(/^(開始計時|我停好了)(\s+\S+)?$/.test(q) && profile){
      if(profile.activeTimer) return client.replyMessage(e.replyToken,{ type:'text', text:'⏱ 已在計時中。用「結束計時」停止。'});
      profile.activeTimer = { start:Date.now(), lotId:null };
      // 若有附帶 ID 直接綁定
      const m = q.split(/\s+/);
      if(m.length>=2){
        const targetId = m[1];
        const list = lastResults.get(userId)||[];
        const found = list.find(x=>x.id===targetId);
        if(found){
          profile.parkedLocation = { lat:found.lat, lng:found.lng, lotId:found.id, lotName:found.name, ts:Date.now(), distToLot:0 };
          profile.activeTimer.lotId = found.id;
          return client.replyMessage(e.replyToken,{ type:'text', text:`⏱ 已開始計時並記錄：${found.name}\n(可輸入「找車」導航，或分享位置覆蓋)` });
        }
      }
      return client.replyMessage(e.replyToken,{ type:'text', text:'⏱ 已開始停車計時。請在實際停妥位置「分享位置」一次以記錄停車點，或輸入「開始計時 停車場ID」。'});
    }
    if(/^(結束計時|我離開了)$/.test(q) && profile){
      if(!profile.activeTimer) return client.replyMessage(e.replyToken,{ type:'text', text:'尚未開始計時。'});
      const session = profile.activeTimer; profile.activeTimer = null;
      session.end = Date.now();
      const mins = Math.ceil((session.end - session.start)/60000);
      // 簡易費用估算：抓最近結果第一筆 rateInfo 中第一個數字/每小時
      let estFee = 0;
      const res = lastResults.get(userId);
      if(res && res.length){
        const rate = res[0].rateInfo || '';
        const m = rate.match(/(\d+)(?:元|\$)/);
        if(m){
          const per = parseInt(m[1],10);
          // 假設為每小時
          estFee = Math.round(per * (mins/60));
        }
      }
      session.estFee = estFee;
      profile.timers.push(session);
      return client.replyMessage(e.replyToken,{ type:'text', text:`⏱ 本次停車 ${mins} 分鐘，預估費用約 ${estFee} 元。` });
    }
    if(q === '找車' && profile){
      if(!profile.parkedLocation) return client.replyMessage(e.replyToken,{ type:'text', text:'尚未記錄停車位置。請先「開始計時」再分享位置一次。'});
      const {lat,lng,lotName} = profile.parkedLocation;
      const nav = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
      return client.replyMessage(e.replyToken,{ type:'text', text:`🚶 導航回車：${lotName?lotName+'\n':''}${nav}` });
    }
    if(q === '更新停車位置' && profile){
      profile.parkedLocation = null;
      return client.replyMessage(e.replyToken,{ type:'text', text:'🔄 請於車旁再次分享位置以重新記錄。'});
    }
    if(q === '我的本週摘要' && profile){
      const weekAgo = Date.now()-7*86400000;
      const reports = profile.reports.filter(r=>r.ts>=weekAgo).length;
      const sessions = profile.timers.filter(t=>t.end && t.end>=weekAgo);
      const totalMins = sessions.reduce((a,s)=>a+Math.ceil((s.end-s.start)/60000),0);
      const totalFee = sessions.reduce((a,s)=>a+(s.estFee||0),0);
      return client.replyMessage(e.replyToken,{ type:'text', text:`📊 七日摘要\n查詢次數：${profile.stats.searches}\n回報次數：${reports}\n停車次數：${sessions.length}\n累計時數：${(totalMins/60).toFixed(1)} 小時\n預估費用：${totalFee} 元` });
    }

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
  const r = await findParking(geo.lat, geo.lng, geo.formatted, 'lot', userId);
  lastResults.set(userId, r.rawList);
  if(profile) profile.stats.searches++;
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

async function findParking(lat, lng, originLabel = '', mode = 'lot', userId=null) {
  const profile = getUserProfile(userId);
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
  console.warn('Google Places API error:', e.message);
    }
  }
  // ---- 合併與去重 ----
  const allList = [
    ...googlePlaces.filter(g=> !list.some(t=> Math.abs(t.lat-g.lat)<0.0002 && Math.abs(t.lng-g.lng)<0.0002)),
    ...list
  ].filter(p=> p.dist <= RADIUS_KM);

  // Google 距離矩陣（可選）
  if(GOOGLE_MAPS_KEY && allList.length){
    try{
      const dest = allList.map(c=>`${c.lat},${c.lng}`).join('|');
      const {data} = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', { params:{ origins:`${lat},${lng}`, destinations:dest, mode:'driving', key:GOOGLE_MAPS_KEY }, timeout:8000 });
      if(data.status==='OK') data.rows[0].elements.forEach((el,i)=>{
        allList[i].road = el.status==='OK' ? (el.distance.value/1000).toFixed(1)+' km' : null;
        allList[i].time = el.status==='OK' ? el.duration.text : null;
      });
    }catch{/* ignore */}
  }

  // EV 篩選
  if(profile?.prefs?.evOnly){
    for(let i=allList.length-1;i>=0;i--){
      const txt = (allList[i].name + ' ' + (allList[i].rateInfo||'')).toLowerCase();
      if(!/ev|充電|電動/.test(txt)) allList.splice(i,1);
    }
  }

  // 可用數歷史 + 簡易預測
  if(!global.availHistory) global.availHistory = new Map();
  allList.forEach(item=>{
    const val = parseInt(item.avail,10);
    if(Number.isFinite(val)){
      if(!global.availHistory.has(item.id)) global.availHistory.set(item.id,[]);
      const arr = global.availHistory.get(item.id);
      arr.push({ts:Date.now(), v:val});
      while(arr.length>20) arr.shift();
      const avg = arr.reduce((a,b)=>a+b.v,0)/arr.length;
      item.predictedAvail = Math.max(0, Math.round(avg*0.95));
    }
  });

  // 智慧排序 (距離 / 剩餘 / 預測 / 價格 / 收藏 / 來源)
  const maxDist = Math.max(...allList.map(x=>x.dist),1);
  allList.forEach(item=>{
    const distScore = 1 - (item.dist / maxDist);
    const availNum = parseInt(item.avail,10);
    const availScore = Number.isFinite(availNum)? Math.min(availNum/50,1):0;
    const predScore = Number.isFinite(item.predictedAvail)? Math.min(item.predictedAvail/50,1):availScore;
    let priceScore = 0.5;
    if(item.rateInfo){
      const nums = [...item.rateInfo.matchAll(/(\d{1,4})/g)].map(m=>+m[1]).filter(n=>n>0);
      if(nums.length){ const min = Math.min(...nums); priceScore = 1 - Math.min(min/100,1); }
    }
    const favBoost = profile && profile.favorites.has(item.id) ? 0.15 : 0;
    const sourceBoost = item.source==='Google'?0.02:0;
    const w = profile?profile.prefs:{ distance:0.5, avail:0.3, price:0.2 };
    item.score = distScore*w.distance + ((availScore+predScore)/2)*w.avail + priceScore*w.price + favBoost + sourceBoost;
  });
  // 排序：先距離 (近到遠)，同距離再以智慧分數由高到低
  allList.sort((a,b)=>{
    const d = a.dist - b.dist;
    if(Math.abs(d) > 1e-6) return d; // 距離不同
    return b.score - a.score;        // 距離相近再比智慧分
  });

  const plain = (originLabel?`📍 ${originLabel}\n\n`:'') + allList.slice(0,5).map(c=>[
    `${mode==='lot'?'🅿️':'🚗'} ${c.name}`,
    `ID：${c.id}`,
    `地址：${c.addr}`,
    c.avail!==undefined?`剩餘：${c.avail}`:null,
    c.predictedAvail!==undefined?`預測：${c.predictedAvail}`:null,
    c.rateInfo?`收費：${c.rateInfo}`:null,
    c.chargeTimeInfo?`時段：${c.chargeTimeInfo}`:null,
    c.source?`來源：${c.source}`:null,
    c.score!==undefined?`智慧分：${c.score.toFixed(2)}`:null,
    c.road?`開車：${c.road}，約 ${c.time}`:`直線距離：${c.dist.toFixed(2)} km`
  ].filter(Boolean).join('\n')).join('\n\n') + `\n\n🔧 指令：收藏 ID｜取消收藏 ID｜回報 ID 狀態(有位/滿/關閉)｜開始計時｜結束計時｜找車｜我的收藏｜我的本週摘要｜只看EV｜取消EV\n⚠️ 請注意行車安全`;

  return { plain, flex: buildFlex(allList, mode), rawList: allList };
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
