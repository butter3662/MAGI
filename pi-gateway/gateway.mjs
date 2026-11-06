// MAGI 파이 문지기 (pi-gateway)
//
// 인터넷(Tailscale Funnel) → 이 문지기(127.0.0.1:PORT) → FreeLLMAPI(127.0.0.1:3001)
//
// 하는 일
// - 채팅 요청(POST /v1/chat/completions)과 모델 목록(GET /v1/models)만 FreeLLMAPI로 넘긴다.
//   관리 화면(대시보드)을 포함한 나머지 주소는 모두 404로 막는다.
// - 브라우저가 보낸 Supabase 로그인 토큰을 Supabase에 물어 확인하고,
//   ALLOWED_USER_IDS에 있는 계정만 통과시킨다. 회원가입은 누구나 할 수 있으므로 "로그인했다"만으로는 통과시키지 않는다.
// - FreeLLMAPI 통합 키(FREELLMAPI_KEY)는 여기서만 붙인다. 브라우저에는 어떤 키도 가지 않는다.
// - 허용한 사이트 주소(ALLOWED_ORIGINS)에서 온 브라우저 요청만 받는다.
// - 계정당 분당 요청 수(RATE_PER_MIN)와 요청 크기(MAX_BODY_MB)를 제한한다.
//
// 외부 패키지 없이 Node.js 20 이상만 있으면 돈다.

import http from 'node:http';
import { Readable } from 'node:stream';

const env = process.env;
const PORT = Number(env.PORT || 8787);
const UPSTREAM = (env.UPSTREAM || 'http://127.0.0.1:3001').replace(/\/+$/, '');
const FREELLMAPI_KEY = env.FREELLMAPI_KEY || '';
const SUPABASE_URL = (env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY || '';
const ALLOWED_USER_IDS = new Set(list(env.ALLOWED_USER_IDS));
const ALLOWED_ORIGINS = new Set(list(env.ALLOWED_ORIGINS || 'https://butter3662.github.io'));
const RATE_PER_MIN = Number(env.RATE_PER_MIN || 60);
const MAX_BODY = Math.round(Number(env.MAX_BODY_MB || 20) * 1024 * 1024);
const UPSTREAM_TIMEOUT_MS = Number(env.UPSTREAM_TIMEOUT_MS || 330000);
const TOKEN_CACHE_MS = 60 * 1000;

function list(v){ return String(v || '').split(',').map(s => s.trim()).filter(Boolean); }

const missing = [];
if(!FREELLMAPI_KEY) missing.push('FREELLMAPI_KEY');
if(!SUPABASE_URL) missing.push('SUPABASE_URL');
if(!SUPABASE_ANON_KEY) missing.push('SUPABASE_ANON_KEY');
if(missing.length){
  console.error('[gateway] 설정값이 없습니다: ' + missing.join(', ') + ' — /etc/magi-gateway.env를 확인하세요.');
  process.exit(1);
}
if(!ALLOWED_USER_IDS.size){
  console.warn('[gateway] ALLOWED_USER_IDS가 비어 있어 모든 요청을 거절합니다. 거절 로그에 찍히는 내 사용자 ID를 넣으세요.');
}

/* ---------- 로그인 확인 ---------- */
// token -> { uid, email, until }
const tokenCache = new Map();

async function whoIs(token){
  const now = Date.now();
  const hit = tokenCache.get(token);
  if(hit && hit.until > now) return hit;

  const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + token },
    signal: AbortSignal.timeout(10000)
  });
  if(r.status === 401 || r.status === 403) return null;
  if(!r.ok) throw new Error('Supabase 확인 실패 HTTP ' + r.status);
  const u = await r.json();
  if(!u || !u.id) return null;

  const info = { uid: u.id, email: u.email || '', until: now + TOKEN_CACHE_MS };
  if(tokenCache.size > 200) tokenCache.clear();
  tokenCache.set(token, info);
  return info;
}

/* ---------- 요청 수 제한 ---------- */
const hits = new Map(); // uid -> 최근 1분 요청 시각들

function allowRate(uid){
  const now = Date.now();
  const arr = (hits.get(uid) || []).filter(t => now - t < 60000);
  if(arr.length >= RATE_PER_MIN){ hits.set(uid, arr); return false; }
  arr.push(now);
  hits.set(uid, arr);
  return true;
}

/* ---------- 응답 도우미 ---------- */
function cors(req, res){
  const origin = req.headers.origin;
  if(origin && ALLOWED_ORIGINS.has(origin)){
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

function fail(res, status, message){
  if(res.headersSent){ res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: { message: message, code: status } }));
}

function readBody(req){
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if(size > MAX_BODY){ reject(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------- FreeLLMAPI로 넘기기 ---------- */
async function forward(req, res, path, body){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  // 브라우저가 연결을 끊으면 FreeLLMAPI 요청도 멈춘다 (무료 한도 낭비 방지).
  res.on('close', () => { if(!res.writableEnded) ctrl.abort(); });

  try{
    const up = await fetch(UPSTREAM + path, {
      method: req.method,
      headers: {
        'Authorization': 'Bearer ' + FREELLMAPI_KEY,
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body || undefined,
      signal: ctrl.signal
    });
    const headers = { 'Content-Type': up.headers.get('content-type') || 'application/json' };
    // 어떤 모델이 실제로 답했는지는 넘겨준다 (MAGI 화면 표시용으로 쓸 수 있음).
    for(const h of ['x-served-model', 'x-served-provider', 'x-fallback-trail']){
      const v = up.headers.get(h);
      if(v) headers[h] = v;
    }
    res.writeHead(up.status, headers);
    if(up.body) Readable.fromWeb(up.body).pipe(res);
    else res.end();
  }catch(e){
    if(ctrl.signal.aborted && res.writableEnded) return;
    if(ctrl.signal.aborted) return fail(res, 504, '파이 서버(FreeLLMAPI)가 제한 시간 안에 답하지 않았습니다.');
    console.error('[gateway] FreeLLMAPI 연결 실패:', e.message);
    fail(res, 502, '파이 서버 안의 FreeLLMAPI에 연결하지 못했습니다. FreeLLMAPI가 켜져 있는지 확인하세요.');
  }finally{
    clearTimeout(timer);
  }
}

/* ---------- 서버 ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const path = url.pathname;
  const origin = req.headers.origin;

  // 허용하지 않은 사이트에서 온 브라우저 요청은 바로 거절한다.
  if(origin && !ALLOWED_ORIGINS.has(origin)) return fail(res, 403, '허용되지 않은 사이트에서 온 요청입니다.');
  cors(req, res);

  if(req.method === 'OPTIONS'){ res.writeHead(204); return res.end(); }
  if(req.method === 'GET' && path === '/health'){
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end('{"ok":true}');
  }

  const isChat = req.method === 'POST' && path === '/v1/chat/completions';
  const isModels = req.method === 'GET' && path === '/v1/models';
  if(!isChat && !isModels) return fail(res, 404, '없는 주소입니다.');

  // 1) 로그인 확인
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if(!token) return fail(res, 401, '파이 서버를 쓰려면 MAGI에 로그인해야 합니다. 로그인 정보가 유효하지 않습니다.');
  let who;
  try{ who = await whoIs(token); }
  catch(e){
    console.error('[gateway]', e.message);
    return fail(res, 503, '로그인 서버(Supabase)를 확인하지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  if(!who) return fail(res, 401, '로그인 정보가 유효하지 않습니다. MAGI에서 다시 로그인하세요.');
  if(!ALLOWED_USER_IDS.has(who.uid)){
    console.warn('[gateway] 거절: 허용 목록에 없는 계정 id=' + who.uid + ' email=' + who.email);
    return fail(res, 403, '이 파이 서버를 쓸 수 있는 계정이 아닙니다 (유효하지 않은 사용자).');
  }

  // 2) 요청 수 제한
  if(!allowRate(who.uid)) return fail(res, 429, '파이 서버 요청 한도(분당 ' + RATE_PER_MIN + '회)를 넘었습니다. 잠시 후 다시 시도하세요.');

  // 3) 넘기기
  if(isModels){
    const q = new URLSearchParams();
    const avail = url.searchParams.get('available');
    if(avail) q.set('available', avail);
    return forward(req, res, '/v1/models' + (q.toString() ? '?' + q : ''), null);
  }

  let raw;
  try{ raw = await readBody(req); }
  catch(e){ return fail(res, e.status || 400, e.status === 413 ? '요청이 너무 큽니다.' : '요청 본문을 읽지 못했습니다.'); }
  let obj;
  try{ obj = JSON.parse(raw.toString('utf8')); }catch(e){ return fail(res, 400, '요청 본문이 JSON이 아닙니다.'); }
  if(!obj || typeof obj.model !== 'string' || !Array.isArray(obj.messages)){
    return fail(res, 400, '요청 형식이 잘못되었습니다 (model, messages 필요).');
  }
  return forward(req, res, '/v1/chat/completions', JSON.stringify(obj));
});

// 문지기는 파이 내부(127.0.0.1)에서만 연다. 바깥 연결은 Tailscale Funnel만 이 포트로 넘겨준다.
server.listen(PORT, '127.0.0.1', () => {
  console.log('[gateway] 127.0.0.1:' + PORT + ' 에서 대기 중 → ' + UPSTREAM +
    ' (허용 계정 ' + ALLOWED_USER_IDS.size + '개, 허용 사이트 ' + [...ALLOWED_ORIGINS].join(' ') + ')');
});
