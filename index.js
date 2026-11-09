/* -------------------------------------------------
 *  Parking-bot 2025 — lot + slot 版
 *  Node 18+
 * ------------------------------------------------*/
require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const line    = require('@line/bot-sdk');

/* ---------- 1. ENV ---------- */
const {
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET,
  GOOGLE_MAPS_KEY   = '',
  TDX_TOKEN         = '',
  TDX_CLIENT_ID     = '',
  TDX_CLIENT_SECRET = '',
  PORT              = 3450,
} = process.env;

/* ---------- 2. LINE SDK ---------- */
const lineConfig = {
  channelAccessToken: LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret     : LINE_CHANNEL_SECRET
};
const client = new line.Client(lineConfig);

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
const MODE_KEYWORDS = {
  lot : ['停車場','查詢附近停車場'],
  slot: ['停車格','路邊停車格','查詢附近停車格']
};

function detectMode(text){
  if (MODE_KEYWORDS.slot.some(k=>text.includes(k))) return 'slot';
  if (MODE_KEYWORDS.lot .some(k=>text.includes(k))) return 'lot';
  return null;
}

async function handleEvent(e){

  /* ========== 位置訊息（lot or slot 由 quick reply 傳回文字決定） ========== */
  if (e.type==='message' && e.message.type==='location'){
    const { latitude, longitude } = e.message;
    // 最後一次指令若沒存，可預設查停車場
    const mode = e.modeHint || 'lot';
    const { plain, flex } = await findParking(latitude, longitude,'', mode);
    return client.replyMessage(e.replyToken,[ {type:'text',text:plain}, flex ]);
  }

  /* ========== 文字訊息（指令 / 地址） ========== */
  if (e.type==='message' && e.message.type==='text'){
    const q = e.message.text.trim();
    const mode = detectMode(q);

    /* 指令：引導使用者上傳位置 */
    if (mode){
      return client.replyMessage(e.replyToken,{
        type:'text',
        text:`請點下方「傳送我的位置」或直接分享定位，即可查詢附近${mode==='lot'?'停車場':'停車格'}。`,
        quickReply:{ items:[
          { type:'action', action:{ type:'location', label:'傳送我的位置' } },
          { type:'action', action:{ type:'message', label:'台北車站', text:'台北車站' } },
          { type:'action', action:{ type:'message', label:'台北101', text:'台北101' } },
          { type:'action', action:{ type:'message', label:'板橋車站', text:'板橋車站' } }
        ]}
      });
    }

    /* 當成地址處理 */
    const geo = await geocode(q);
    if (!geo){
      return client.replyMessage(e.replyToken,{ type:'text',
        text:'❓ 找不到此地址，請再確認或直接分享「位置資訊」。'});
    }
    const { plain, flex } = await findParking(
      geo.lat, geo.lng, geo.formatted, 'lot');     // 地址查預設查停車場
    return client.replyMessage(e.replyToken,[ {type:'text',text:plain}, flex ]);
  }
  return null;
}

/* =================================================
 *  5. 主功能
 * =================================================*/
function toRad(x){ return x*Math.PI/180 }
function haversine(φ1,λ1,φ2,λ2){
  const R=6371, dφ=toRad(φ2-φ1), dλ=toRad(λ2-λ1);
  const a=Math.sin(dφ/2)**2 + Math.cos(toRad(φ1))*Math.cos(toRad(φ2))*Math.sin(dλ/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));   // km
}

const RADIUS_KM = 2.5;

/** mode: 'lot' | 'slot' */
async function findParking(lat,lng,originLabel='', mode='lot'){
  const cityCode = await getCityCode(lat,lng);

  let lots=[], liveMap=new Map();
  if (cityCode!=='ALL'){
    try{
      const token   = await getTDXAccessToken();
      const headers = { Authorization:`Bearer ${token}` };
      const base    = mode==='lot'
        ? 'https://tdx.transportdata.tw/api/basic/v1/Parking/OffStreet'
        : 'https://tdx.transportdata.tw/api/basic/v1/Parking/OnStreet';

      let apiCalls;
      if (mode==='lot'){
        apiCalls = [
          axios.get(makeCityURL(`${base}/CarPark`,            cityCode),{headers,timeout:10000}),
          axios.get(makeCityURL(`${base}/ParkingFacility`,    cityCode),{headers,timeout:10000}),
          axios.get(makeCityURL(`${base}/ParkingAvailability`,cityCode),{headers,timeout:10000})
        ];
      }else{
        apiCalls = [
          axios.get(makeCityURL(`${base}/ParkingSpace`,       cityCode),{headers,timeout:10000}),
          axios.get(makeCityURL(`${base}/ParkingAvailability`,cityCode),{headers,timeout:10000})
        ];
      }
      const [resA,resB,resC] = await Promise.allSettled(apiCalls);

      if (mode==='lot'){
        if (resA.status==='fulfilled') lots.push(...(resA.value.data.CarParks||[]));
        if (resB.status==='fulfilled') lots.push(...(resB.value.data.ParkingFacilities||[]));
        if (resC.status==='fulfilled'){
          const a=resC.value.data.ParkingAvailabilities||[];
          liveMap=new Map(a.map(p=>[p.ParkingFacilityID||p.CarParkID, p.AvailableSpaces??'—']));
        }
      }else{
        if (resA.status==='fulfilled') lots.push(...(resA.value.data.ParkingSpaces||[]));
        if (resB.status==='fulfilled'){
          const a=resB.value.data.ParkingAvailabilities||[];
          liveMap=new Map(a.map(p=>[p.ParkingSpaceID, p.AvailableSpaces??'—']));
        }
      }
    }catch(err){ console.warn('TDX fetch error:',err.response?.status||err.message); }
  }

  /* OpenData Fallback 只示範 lot，如需 On-Street 請自行補 */
  if (!lots.length && mode==='lot') lots = await taipeiOpenData(lat,lng);
  if (!lots.length){
    return { plain:`🙈 附近查無${mode==='lot'?'停車場':'停車格'}資料。`, flex:null };
  }

  /* 整理座標 / 名稱 */
  const cand = lots.map(p=>{
      // 取得座標
      const pos = mode==='lot'
        ? (p.CarParkPosition||p.OffStreetMapPosition||{})
        : p;
      const φ=+pos.PositionLat, λ=+pos.PositionLon;
      if (Number.isNaN(φ)||Number.isNaN(λ)) return null;

      const name = mode==='lot'
        ? ((p.CarParkName||p.ParkingFacilityName||{}).Zh_tw||p.CarParkName||p.ParkingFacilityName)
        : `路邊格 #${p.ParkingSpaceID||p.SpaceID}`;

      const addr = mode==='lot'
        ? (p.Address||p.CarParkAddress||'—')
        : `${p.RoadSection||''}${p.SideName||''}` || '—';

      return { id:(p.CarParkID||p.ParkingFacilityID||p.ParkingSpaceID),
               name, addr, lat:φ, lng:λ,
               dist:haversine(lat,lng,φ,λ) };
    })
    .filter(Boolean)
    .sort((a,b)=>a.dist-b.dist)
    .slice(0,10);

  /* Google Distance Matrix (可選) */
  if (GOOGLE_MAPS_KEY){
    try{
      const dest=cand.map(c=>`${c.lat},${c.lng}`).join('|');
      const {data}=await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        { params:{ origins:`${lat},${lng}`, destinations:dest, mode:'driving',
                   key:GOOGLE_MAPS_KEY }, timeout:8000 });
      if (data.status==='OK'){
        data.rows[0].elements.forEach((e,i)=>{
          cand[i].road=e.status==='OK'?(e.distance.value/1000).toFixed(1)+' km':null;
          cand[i].time=e.status==='OK'?e.duration.text:null;
        });
      }
    }catch{/* ignore */}
  }

  /* 純文字備援 */
  const textLines=cand.slice(0,5).map(c=>{
    const avail=liveMap.get(c.id);
    return [
      `${mode==='lot'?'🅿️':'🚗'} ${c.name}`,
      `地址：${c.addr}`,
      avail!==undefined ? `剩餘：${avail}` : null,
      c.road ? `開車：${c.road}，約 ${c.time}` : `直線距離：${c.dist.toFixed(2)} km`
    ].filter(Boolean).join('\n');
  });
  const srcNote = liveMap.size
      ? `📊 資料來源：TDX ${mode==='lot'?'Off-Street':'On-Street'}`
      : '📊 資料來源：地方政府 OpenData';
  const plain=(originLabel?`📍 ${originLabel}\n\n`:'')+
              textLines.join('\n\n')+'\n\n'+srcNote;

  /* Flex */
  const flex = buildParkingFlex(cand, liveMap, mode);
  return { plain, flex };
}

/* =================================================
 *  6. Flex 產生器
 * =================================================*/
function buildParkingFlex(cand, live, mode){
  const bubbles=cand.slice(0,5).map(c=>{
    const heroURL = 'https://your.cdn.com/parking-hero.png';  // 固定圖
    const nav=`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}`;
    const avail=live.get(c.id);
    const distance=c.road ? c.road : `${c.dist.toFixed(2)} km`;

    return {
      type:'bubble',
      hero:{ type:'image', url:heroURL, size:'full', aspectRatio:'3:2', aspectMode:'cover',
             action:{ type:'uri', uri:nav }},
      body:{ type:'box', layout:'vertical', spacing:'sm', contents:[
        { type:'text', text:`${mode==='lot'?'🅿️':'🚗'} ${c.name}`, weight:'bold',
          size:'lg', wrap:true },
        { type:'text', text:`地址：${c.addr}`, size:'sm', color:'#666666', wrap:true },
        avail!==undefined ? { type:'text', text:`剩餘：${avail}`, size:'sm',
                              color:'#666666' } : null,
        { type:'text', text:`距離：約 ${distance}`, size:'sm', color:'#666666' }
      ].filter(Boolean)},
      footer:{ type:'box', layout:'vertical', contents:[
        { type:'button', style:'primary', color:'#D14124',
          action:{ type:'uri', label:'一鍵導航', uri:nav }}
      ]}
    };
  });

  return { type:'flex', altText:'附近停車列表', contents:{ type:'carousel', contents:bubbles }};
}

/* =================================================
 *  7. 支援函式 (TDX / Google / OpenData) — 與前版相同
 * =================================================*/
async function getTDXAccessToken(){
  if (TDX_TOKEN) return TDX_TOKEN;
  if (!TDX_CLIENT_ID || !TDX_CLIENT_SECRET)
    throw new Error('缺少 TDX_TOKEN 或 TDX_CLIENT_ID / SECRET');

  if (global.tdxToken && Date.now() < global.tdxTokenExpiry)
    return global.tdxToken;

  const url='https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
  const body=new URLSearchParams({
    grant_type   :'client_credentials',
    client_id    :TDX_CLIENT_ID,
    client_secret:TDX_CLIENT_SECRET
  });
  const {data}=await axios.post(url, body,
    { headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, timeout:8000 });

  global.tdxToken=data.access_token;
  global.tdxTokenExpiry=Date.now()+(data.expires_in-60)*1000;
  return global.tdxToken;
}

function makeCityURL(base, city){
  const qs=new URLSearchParams({ '$format':'JSON' }).toString(); // %24format=JSON
  return `${base}/City/${encodeURIComponent(city)}?${qs}`;
}

async function geocode(addr){
  if (!GOOGLE_MAPS_KEY) return null;
  try{
    const {data}=await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      { params:{ address:addr, key:GOOGLE_MAPS_KEY, language:'zh-TW' }, timeout:8000 });
    if (data.status!=='OK') return null;
    const r=data.results[0];
    return { lat:r.geometry.location.lat, lng:r.geometry.location.lng,
             formatted:r.formatted_address };
  }catch{ return null; }
}

async function getCityCode(lat,lng){
  if (!GOOGLE_MAPS_KEY) return 'ALL';
  try{
    const {data}=await axios.get(
      'https://maps.googleapis.com/maps/api/geocode/json',
      { params:{ latlng:`${lat},${lng}`, key:GOOGLE_MAPS_KEY, language:'zh-TW' },
        timeout:8000 });
    if (data.status!=='OK') return 'ALL';
    const tw=data.results[0]?.address_components
                  .find(c=>c.types.includes('administrative_area_level_1'))?.long_name;
    const map={
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

/* 只有台北示範；要別縣市可自行換 API */
async function taipeiOpenData(lat,lng){
  try{
    const url='https://data.taipei/api/v1/dataset/37e1efb9-909b-463f-aac5-076ff107d970?scope=resourceAquire';
    const {data}=await axios.get(url,{timeout:10000});
    return (data.result?.results||[])
      .map(r=>({ id:r._id, name:r.name, addr:r.address, lat:+r.lat, lng:+r.lng }))
      .filter(p=>!Number.isNaN(p.lat)&&!Number.isNaN(p.lng)&&haversine(lat,lng,p.lat,p.lng)<=RADIUS_KM);
  }catch(e){
    console.warn('Taipei OpenData error:',e.message);
    return [];
  }
}
