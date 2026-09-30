import * as THREE from './three.module.min.js';

const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);

/* ページのスクロール・拡大・長押しメニューを完全に止める */
['touchmove', 'gesturestart', 'contextmenu', 'dblclick'].forEach((n) =>
  document.addEventListener(n, (e) => e.preventDefault(), { passive: false })
);

/* ---------- Three.js 基本セットアップ ---------- */
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1424);
scene.fog = new THREE.Fog(0x0a1424, 22, 55);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
scene.add(new THREE.HemisphereLight(0x99ddff, 0x112233, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(6, 12, 6);
scene.add(sun);
scene.add(new THREE.GridHelper(80, 40, 0x00e5ff, 0x16405f));
const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: 0x0f2238 }));
floor.position.y = -0.02;
scene.add(floor);
const arena = new THREE.Mesh(new THREE.RingGeometry(17.4, 17.7, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x00e5ff }));
arena.position.y = 0.02;
scene.add(arena);

let U = 1; // 画面サイズに応じたUI倍率
function fit() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  U = Math.max(0.55, Math.min(1.5, Math.min(w / 760, h / 360)));
  const st = document.documentElement.style;
  st.setProperty('--vw', w + 'px');
  st.setProperty('--vh', h + 'px');
  st.setProperty('--u', U.toFixed(3));
  const dbg = document.getElementById('dbg');
  if (dbg) dbg.textContent = 'v6  ' + w + 'x' + h + '  x' + U.toFixed(2);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
const refit = () => { fit(); setTimeout(fit, 250); };
window.addEventListener('resize', refit);
window.addEventListener('orientationchange', refit);
document.addEventListener('fullscreenchange', refit);
if (window.visualViewport) window.visualViewport.addEventListener('resize', refit);
fit();
camera.position.set(0, 9, 9.5);
camera.lookAt(0, 0.5, 0);

/* 仮モデル(後でglTFに差し替え: GLTFLoaderで読み込み、userData.matの代わりに各メッシュのemissiveを操作) */
function makeBody(color, s = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ color, emissive: 0x000000 });
  const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.4 * s, 0.8 * s, 4, 10), mat);
  b.position.y = 0.9 * s;
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.32 * s, 12, 10), mat);
  h.position.y = 1.85 * s;
  const n = new THREE.Mesh(new THREE.BoxGeometry(0.2 * s, 0.2 * s, 0.5 * s), new THREE.MeshToonMaterial({ color: 0xffffff }));
  n.position.set(0, 1.0 * s, 0.5 * s);
  g.add(b, h, n);
  g.userData.mat = mat;
  return g;
}

/* ---------- データ ---------- */
const DEFS = [
  { name: 'アカリ', role: '近接', color: 0xff6a3d, el: 'fire', hp: 130, atk: 14, range: 2.8, arc: 2.0, cd: 5 },
  { name: 'ノア', role: '遠距離/バフ', color: 0xffe14d, el: 'volt', hp: 90, atk: 11, range: 9, arc: 0.4, cd: 7 },
  { name: 'ミオ', role: '回復/補助', color: 0x7dff8a, el: 'wind', hp: 105, atk: 9, range: 5, arc: 0.8, cd: 8 },
];
const party = DEFS.map((d) => ({ ...d, cur: d.hp, alive: true, cdT: 0 }));

let mode = 'title';
let cur = 0, energy = 0, buffT = 0, shieldT = 0, slow = 0, inv = 0, face = 0;
let combo = 0, comboT = 0, swapCd = 0, dodgeCd = 0, parryCd = 0, flashP = 0, msgT = 0;
let wave = 0, time = 0, holdAtk = false, hitstop = 0, shake = 0;
let act = { type: '', t: 0 };
let lock = null, yaw = 0, pitch = 0.75;
const dash = new THREE.Vector3();
const cam = new THREE.Vector3(0, 0, 0);
const lockMark = new THREE.Mesh(
  new THREE.RingGeometry(0.7, 0.9, 24).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
);
lockMark.visible = false;
scene.add(lockMark);
/* カメラ向き基準の移動方向(スティック入力 → ワールド座標) */
const wdir = (x, y) => ({ x: x * Math.cos(yaw) + y * Math.sin(yaw), z: -x * Math.sin(yaw) + y * Math.cos(yaw) });
const mv = { x: 0, y: 0 };
const enemies = [];
const fxs = [];
const player = new THREE.Group();
scene.add(player);
let body;

function setBody() {
  if (body) player.remove(body);
  body = makeBody(party[cur].color);
  player.add(body);
}
setBody();

/* ---------- 入力 ---------- */
const zone = $('zone'), stick = $('stick'), knob = $('knob');
let sid = null, ox = 0, oy = 0, sx = 0, sy = 0;
function stickMove(e) {
  const R = 60 * U;
  let dx = e.clientX - ox, dy = e.clientY - oy;
  const l = Math.hypot(dx, dy);
  if (l > R) { dx = (dx / l) * R; dy = (dy / l) * R; }
  sx = dx / R; sy = dy / R;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}
zone.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (sid !== null) return;
  sid = e.pointerId;
  zone.setPointerCapture(sid);
  ox = e.clientX; oy = e.clientY;
  stick.style.left = ox - 70 * U + 'px';
  stick.style.top = oy - 70 * U + 'px';
  stick.style.bottom = 'auto';
  stick.classList.add('on');
  stickMove(e);
});
zone.addEventListener('pointermove', (e) => { if (e.pointerId === sid) stickMove(e); });
const stickEnd = (e) => {
  if (e.pointerId !== sid) return;
  sid = null; sx = 0; sy = 0;
  knob.style.transform = '';
  stick.classList.remove('on');
  stick.style.left = ''; stick.style.top = ''; stick.style.bottom = '';
};
zone.addEventListener('pointerup', stickEnd);
zone.addEventListener('pointercancel', stickEnd);

const look = $('look');
let lid = null, lx = 0, ly = 0;
look.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (lid !== null) return;
  lid = e.pointerId;
  look.setPointerCapture(lid);
  lx = e.clientX; ly = e.clientY;
});
look.addEventListener('pointermove', (e) => {
  if (e.pointerId !== lid) return;
  const dx = e.clientX - lx, dy = e.clientY - ly;
  lx = e.clientX; ly = e.clientY;
  if (!lock) yaw -= dx * 0.008;
  pitch = Math.max(0.25, Math.min(1.3, pitch + dy * 0.006));
});
const lookEnd = (e) => { if (e.pointerId === lid) lid = null; };
look.addEventListener('pointerup', lookEnd);
look.addEventListener('pointercancel', lookEnd);

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.repeat) return;
  const a = { KeyJ: 'atk', KeyK: 'dodge', KeyL: 'lock', KeyU: 'skill', KeyI: 'ult', KeyQ: 'swap' }[e.code];
  if (a) ACT[a](true);
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.querySelectorAll('.b').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (b.dataset.a === 'atk') holdAtk = true;
    ACT[b.dataset.a](true);
  });
});
const relAtk = () => { holdAtk = false; };
window.addEventListener('pointerup', relAtk);
window.addEventListener('pointercancel', relAtk);

/* ---------- 属性・反応・演出 ---------- */
const EL = {
  fire: { n: '炎', c: 0xff6a3d }, ice: { n: '氷', c: 0x6fe6ff }, volt: { n: '雷', c: 0xffe14d },
  wind: { n: '風', c: 0x7dff8a }, light: { n: '光', c: 0xfff3b0 }, dark: { n: '闇', c: 0xb06bff },
};
const WEAK = { ice: 'fire', volt: 'wind', wind: 'volt', light: 'dark', dark: 'light' };
const RX = [
  ['fire', 'ice', '融解', 'melt'], ['fire', 'volt', '過負荷', 'over'], ['ice', 'volt', '超伝導', 'super'],
  ['light', 'dark', '崩壊', 'collapse'], ['ice', 'dark', '凍結', 'freeze'],
];
function react(a, b) {
  for (const [x, y, n, k] of RX) if ((a === x && b === y) || (a === y && b === x)) return { n, k };
  if (a === 'wind' || b === 'wind') {
    const o = a === 'wind' ? b : a;
    if (o === 'fire' || o === 'ice' || o === 'volt') return { n: '拡散', k: 'spread', el: o };
  }
  return null;
}

let AC = null;
function sfx(f, d = 0.1, type = 'square', v = 0.08, f2 = f) {
  if (!AC) return;
  const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime;
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + d);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + d);
  o.connect(g);
  g.connect(AC.destination);
  o.start(t);
  o.stop(t + d);
}

function popup(p, text, color, big) {
  const v = new THREE.Vector3(p.x + rnd(-0.3, 0.3), 2.4, p.z).project(camera);
  const app = $('app'), d = document.createElement('div');
  d.className = 'dmg' + (big ? ' big' : '');
  d.textContent = text;
  d.style.color = '#' + color.toString(16).padStart(6, '0');
  d.style.left = (v.x * 0.5 + 0.5) * app.clientWidth + 'px';
  d.style.top = (-v.y * 0.5 + 0.5) * app.clientHeight + 'px';
  app.appendChild(d);
  setTimeout(() => d.remove(), 800);
}

function clearTg(e) { if (e.tg) { scene.remove(e.tg); e.tg = null; } }

/* 予兆: 赤い円=回避のみ / 光の輪=縮んで重なる瞬間に攻撃ボタンでパリィ */
function makeTg(e, kind) {
  if (kind === 'parry') {
    const g = new THREE.Group();
    const mk = (col, op) => new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 40), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, depthTest: false, side: THREE.DoubleSide }));
    const fix = mk(0xffffff, 0.9), mov = mk(0x88ddff, 1);
    fix.renderOrder = mov.renderOrder = 10;
    g.add(fix, mov);
    g.position.set(e.m.position.x, e.boss ? 3.2 : 1.6, e.m.position.z);
    scene.add(g);
    return g;
  }
  const rng = e.boss ? 3.4 : 2.3;
  const m = new THREE.Mesh(new THREE.CircleGeometry(rng + 0.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({
    color: 0xff2020, transparent: true, opacity: 0.35, side: THREE.DoubleSide,
  }));
  m.position.set(e.m.position.x, 0.05, e.m.position.z);
  scene.add(m);
  return m;
}

/* ---------- 戦闘 ---------- */
const mul = () => (buffT > 0 ? 1.5 : 1);
const angTo = (p) => Math.atan2(p.x - player.position.x, p.z - player.position.z);
const free = () => mode === 'play' && act.t <= 0;
const say = (t) => { $('msg').textContent = t; msgT = 1.2; };

function fx(r, color) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(r * 0.8, r, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
  );
  m.position.copy(player.position);
  m.position.y = 0.1;
  scene.add(m);
  fxs.push({ m, t: 0.3 });
}

function hurt(e, dmg, el, big) {
  if (e.stun > 0) dmg *= 1.5;
  if (e.vuln > 0) dmg *= 1.3;
  e.hp -= dmg;
  e.flash = 0.12;
  energy = Math.min(100, energy + dmg * 0.25);
  popup(e.m.position, Math.round(dmg), EL[el].c, big);
  hitstop = big ? 0.09 : 0.04;
  shake = Math.max(shake, big ? 0.35 : 0.12);
  sfx(big ? 260 : 180, 0.08, 'square', 0.06, 90);
  if (e.hp <= 0) { e.dead = true; clearTg(e); scene.remove(e.m); }
}

/* 属性ダメージ: 耐性/弱点 → 付着 → 反応 */
function hit(e, dmg, el) {
  if (e.dead) return;
  if (el === e.el) dmg *= 0.5;
  else if (el === WEAK[e.el]) dmg *= 1.3;
  hurt(e, dmg, el, false);
  if (e.dead) return;
  const a = e.aura;
  if (!a) { e.aura = el; e.auraT = 6; return; }
  if (a === el) { e.auraT = 6; return; }
  const r = react(a, el);
  if (!r) return;
  e.aura = null;
  popup(e.m.position, r.n + '!', 0xffffff, true);
  sfx(400, 0.25, 'sawtooth', 0.08, 900);
  shake = 0.5;
  const p = e.m.position;
  if (r.k === 'melt') hurt(e, dmg * 2, 'fire', true);
  else if (r.k === 'over') {
    hurt(e, dmg, 'fire', true);
    for (const o of enemies) {
      if (o.dead || o === e) continue;
      const dx = o.m.position.x - p.x, dz = o.m.position.z - p.z, d = Math.hypot(dx, dz) || 1;
      if (d < 3.5) {
        hurt(o, dmg * 0.8, 'fire', false);
        if (!o.dead) { o.m.position.x += (dx / d) * 1.5; o.m.position.z += (dz / d) * 1.5; }
      }
    }
  } else if (r.k === 'super') e.vuln = 8;
  else if (r.k === 'collapse') hurt(e, 60, 'dark', true);
  else if (r.k === 'freeze') { e.stun = 2.5; clearTg(e); e.state = 'chase'; e.t = 1.5; }
  else if (r.k === 'spread') {
    for (const o of enemies) {
      if (o.dead || o === e) continue;
      if (Math.hypot(o.m.position.x - p.x, o.m.position.z - p.z) < 4.5) {
        if (!o.aura) { o.aura = r.el; o.auraT = 6; }
        hurt(o, dmg * 0.5, r.el, false);
      }
    }
  }
}

function strike(range, arc, dmg, el = party[cur].el) {
  for (const e of enemies) {
    if (e.dead) continue;
    const p = e.m.position;
    const d = Math.hypot(p.x - player.position.x, p.z - player.position.z);
    if (d > range + e.r) continue;
    if (arc < 6.2) {
      const a = angTo(p) - face;
      const diff = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
      if (diff > arc / 2 + e.r / Math.max(d, 0.5)) continue;
    }
    hit(e, dmg, el);
  }
}

function nearest(maxD = 40) {
  let best = null, bd = maxD;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.m.position.distanceTo(player.position);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

function aim() {
  const t = lock && !lock.dead ? lock : nearest(10);
  if (t) face = angTo(t.m.position);
}

/* 光の輪がほぼ重なった瞬間に攻撃ボタンを押すとパリィ成功 */
function tryParry() {
  if (mode !== 'play' || act.type === 'ult') return false;
  for (const e of enemies) {
    if (e.dead || e.state !== 'wind' || e.kind !== 'parry' || e.t > 0.25 || e.t <= 0) continue;
    if (e.m.position.distanceTo(player.position) > (e.boss ? 6 : 5)) continue;
    e.stun = e.boss ? 1.6 : 2.5;
    e.state = 'chase';
    e.t = 1.5;
    clearTg(e);
    energy = Math.min(100, energy + 25);
    act = { type: 'parry', t: 0.25 };
    inv = 0.4;
    hitstop = 0.12;
    shake = 0.4;
    face = angTo(e.m.position);
    fx(2.5, 0xffffff);
    say('パリィ!');
    sfx(1200, 0.12, 'triangle', 0.1, 1800);
    return true;
  }
  return false;
}

const ACT = {
  atk(fresh) {
    if (fresh && tryParry()) return;
    if (!free()) return;
    aim();
    const c = party[cur];
    combo = comboT > 0 ? (combo + 1) % 3 : 0;
    comboT = 0.9;
    const last = combo === 2;
    act = { type: 'atk', t: last ? 0.5 : 0.3 };
    fx(Math.min(c.range, 5), c.color);
    strike(c.range, c.arc, c.atk * (last ? 2 : 1) * mul());
  },
  dodge() {
    if (mode !== 'play' || dodgeCd > 0 || act.type === 'ult') return;
    const l = Math.hypot(mv.x, mv.y);
    if (l > 0.2) { const w = wdir(mv.x, mv.y); dash.set(w.x / l, 0, w.z / l); }
    else dash.set(Math.sin(face), 0, Math.cos(face));
    face = Math.atan2(dash.x, dash.z);
    act = { type: 'dodge', t: 0.3 };
    dodgeCd = 0.5;
  },
  lock() {
    if (lock) { lock = null; return; }
    lock = nearest();
    if (!lock) say('敵がいません');
  },
  skill() {
    const c = party[cur];
    if (!free() || c.cdT > 0) return;
    aim();
    c.cdT = c.cd;
    act = { type: 'skill', t: 0.45 };
    if (cur === 0) {
      fx(4.5, c.color);
      strike(4.5, 7, 34 * mul());
    } else if (cur === 1) {
      buffT = 10;
      fx(9, c.color);
      strike(9, 0.5, 28 * mul());
      say('攻撃力UP!');
    } else {
      party.forEach((p) => { if (p.alive) p.cur = Math.min(p.hp, p.cur + p.hp * 0.3); });
      shieldT = 6;
      fx(5, c.color);
      say('回復 & シールド');
    }
  },
  ult() {
    if (!free() || energy < 100) return;
    energy = 0;
    act = { type: 'ult', t: 0.8 };
    inv = 0.9;
    slow = 0.5;
    fx(12, 0xffffff);
    strike(12, 7, 90 * mul());
    say('必殺!');
    sfx(100, 0.6, 'sawtooth', 0.12, 400);
  },
  swap(idx) {
    if (mode !== 'play' || swapCd > 0) return;
    let n = -1;
    if (typeof idx === 'number') {
      if (idx !== cur && party[idx].alive) n = idx;
    } else {
      for (let i = 1; i < 3; i++) {
        const k = (cur + i) % 3;
        if (party[k].alive) { n = k; break; }
      }
    }
    if (n < 0) return;
    cur = n;
    setBody();
    swapCd = 0.8;
    inv = 0.4;
    comboT = 0;
    fx(3, party[n].color);
    strike(6, 7, 16 * mul());
  },
};

function playerHit(dmg, e, kind) {
  if (inv > 0) return;
  if (act.type === 'dodge') {
    slow = 1.4;
    inv = 0.3;
    energy = Math.min(100, energy + 20);
    say('ジャスト回避!');
    sfx(600, 0.15, 'sine', 0.06, 200);
    return;
  }
  if (shieldT > 0) dmg *= 0.4;
  const c = party[cur];
  c.cur -= dmg;
  inv = 0.6;
  flashP = 0.15;
  shake = 0.4;
  sfx(120, 0.2, 'sawtooth', 0.1, 60);
  body.userData.mat.emissive.setHex(0xff0000);
  if (c.cur <= 0) {
    c.cur = 0;
    c.alive = false;
    const n = party.findIndex((p) => p.alive);
    if (n < 0) { finish(false); return; }
    cur = n;
    setBody();
    say(c.name + ' 戦闘不能');
  }
}

/* ---------- 敵 ---------- */
function spawn(boss) {
  const el = boss ? (Math.random() < 0.5 ? 'fire' : 'volt') : wave === 1 ? 'ice' : ['ice', 'ice', 'fire', 'volt', 'wind'][Math.floor(rnd(0, 5))];
  const a = rnd(0, Math.PI * 2);
  const m = makeBody(EL[el].c, boss ? 2 : 1);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshBasicMaterial({ color: EL[el].c }));
  orb.position.y = boss ? 4.3 : 2.5;
  m.add(orb);
  m.position.set(Math.cos(a) * 14, 0, Math.sin(a) * 14);
  scene.add(m);
  const hp = boss ? 420 : 45;
  enemies.push({ m, orb, el, aura: el, auraT: 9999, vuln: 0, kind: 'red', tg: null, hp, boss, r: boss ? 1.2 : 0.5, state: 'chase', t: rnd(1, 2), stun: 0, flash: 0, dead: false });
}

function nextWave() {
  wave++;
  if (wave > 3) { finish(true); return; }
  const n = [0, 3, 5, 2][wave];
  for (let i = 0; i < n; i++) spawn(false);
  if (wave === 3) spawn(true);
  say(wave === 3 ? 'BOSS 出現!' : 'WAVE ' + wave);
}

function updEnemies(dt) {
  for (const e of enemies) {
    if (e.dead) continue;
    const p = e.m.position, mat = e.m.userData.mat;
    e.flash -= dt;
    e.vuln -= dt;
    if (e.aura && e.auraT < 900) { e.auraT -= dt; if (e.auraT <= 0) e.aura = null; }
    e.orb.visible = !!e.aura;
    if (e.aura) e.orb.material.color.setHex(EL[e.aura].c);
    const dx = player.position.x - p.x, dz = player.position.z - p.z;
    const d = Math.hypot(dx, dz) || 0.001;
    const rng = e.boss ? 3.4 : 2.3;
    if (e.stun > 0) { e.stun -= dt; mat.emissive.setHex(0x2255ff); continue; }
    e.m.rotation.y = Math.atan2(dx, dz);
    if (e.state === 'chase') {
      mat.emissive.setHex(e.flash > 0 ? 0xffffff : 0x000000);
      if (d > rng * 0.8) {
        const s = (e.boss ? 2.4 : 3.2) * dt;
        p.x += (dx / d) * s;
        p.z += (dz / d) * s;
      } else {
        e.t -= dt;
      }
      if (e.t <= 0 && d <= rng * 1.2) { e.state = 'wind'; e.kind = Math.random() < (e.boss ? 0.5 : 0.35) ? 'parry' : 'red'; e.T = e.kind === 'parry' ? (e.boss ? 1.2 : 1.0) : (e.boss ? 0.9 : 0.7); e.t = e.T; e.tg = makeTg(e, e.kind); }
    } else {
      e.t -= dt;
      mat.emissive.setHex(e.kind === 'red' ? 0xff0000 : 0x88ddff);
      if (e.kind === 'parry' && e.tg) {
        e.tg.quaternion.copy(camera.quaternion);
        e.tg.children[1].scale.setScalar(1 + 1.6 * Math.max(0, e.t) / e.T);
      }
      if (e.t <= 0) {
        clearTg(e);
        if (d <= rng + 0.5) playerHit(e.boss ? 26 : 12, e, e.kind);
        e.state = 'chase';
        e.t = rnd(1, 2);
      }
    }
  }
}

/* ---------- 進行 ---------- */
function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存不可でも続行 */ } }
function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

function finish(win) {
  mode = 'over';
  holdAtk = false;
  let txt = '';
  if (win) {
    const best = parseFloat(load('neonrift-best')) || 0;
    if (!best || time < best) store('neonrift-best', time.toFixed(1));
    txt = `クリアタイム ${time.toFixed(1)}秒<br>ベスト ${Math.min(best || time, time).toFixed(1)}秒`;
  } else {
    txt = '全員が戦闘不能になりました。';
  }
  $('ovh').textContent = win ? 'MISSION CLEAR' : 'MISSION FAILED';
  $('ovt').innerHTML = txt;
  $('go').textContent = 'もう一度';
  $('ov').style.display = 'flex';
}

function start() {
  try { AC = AC || new (window.AudioContext || window.webkitAudioContext)(); AC.resume(); } catch (err) { AC = null; }
  enemies.forEach((e) => { clearTg(e); scene.remove(e.m); });
  enemies.length = 0;
  party.forEach((p) => { p.cur = p.hp; p.alive = true; p.cdT = 0; });
  cur = 0;
  setBody();
  player.position.set(0, 0, 0);
  cam.set(0, 0, 0);
  yaw = 0; pitch = 0.75; lock = null;
  face = 0; energy = 0; buffT = 0; shieldT = 0; slow = 0; inv = 0; combo = 0; comboT = 0;
  wave = 0; time = 0;
  act = { type: '', t: 0 };
  $('ov').style.display = 'none';
  mode = 'play';
  try {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {});
    }
  } catch (err) { /* 非対応端末は無視 */ }
}
$('go').addEventListener('click', start);

function update(dtReal) {
  if (hitstop > 0) { hitstop -= dtReal; return; }
  slow = Math.max(0, slow - dtReal);
  const dt = slow > 0 ? dtReal * 0.3 : dtReal;
  time += dtReal;
  inv -= dtReal; comboT -= dtReal; swapCd -= dtReal; dodgeCd -= dtReal; parryCd -= dtReal;
  buffT -= dtReal; shieldT -= dtReal; msgT -= dtReal; flashP -= dtReal;
  party.forEach((p) => { p.cdT = Math.max(0, p.cdT - dtReal); });
  act.t -= dtReal;
  if (act.t <= 0) act.type = '';

  mv.x = sx + (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  mv.y = sy + (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
  const l = Math.hypot(mv.x, mv.y);
  if (holdAtk || keys.KeyJ) ACT.atk();

  if (act.type === 'dodge') {
    player.position.addScaledVector(dash, 14 * dtReal);
  } else if (l > 0.15) {
    const f = act.type === 'ult' ? 0 : act.type ? 0.35 : 1;
    const s = 6.5 * f * Math.min(l, 1) * dtReal;
    const w = wdir(mv.x, mv.y);
    player.position.x += (w.x / l) * s;
    player.position.z += (w.z / l) * s;
    if (!act.type) face = Math.atan2(w.x, w.z);
  }
  const r = Math.hypot(player.position.x, player.position.z);
  if (r > 17) { player.position.x *= 17 / r; player.position.z *= 17 / r; }
  player.rotation.y = face;
  body.rotation.x = act.type === 'atk' ? 0.35 : 0;
  body.position.y = l > 0.15 && !act.type ? Math.abs(Math.sin(time * 12)) * 0.08 : 0;
  if (flashP <= 0) body.userData.mat.emissive.setHex(buffT > 0 ? 0x442200 : 0x000000);

  updEnemies(dt);
  if (mode === 'play' && enemies.every((e) => e.dead)) { enemies.length = 0; nextWave(); }

  for (let i = fxs.length - 1; i >= 0; i--) {
    const f = fxs[i];
    f.t -= dtReal;
    f.m.material.opacity = Math.max(0, (f.t / 0.3) * 0.8);
    f.m.scale.setScalar(1 + (0.3 - f.t) * 1.5);
    if (f.t <= 0) { scene.remove(f.m); fxs.splice(i, 1); }
  }

  const k = 1 - Math.exp(-6 * dtReal);
  cam.x += (player.position.x - cam.x) * k;
  cam.z += (player.position.z - cam.z) * k;
  if (lock && lock.dead) lock = nearest();
  if (lock) {
    const ty = Math.atan2(player.position.x - lock.m.position.x, player.position.z - lock.m.position.z);
    yaw += Math.atan2(Math.sin(ty - yaw), Math.cos(ty - yaw)) * Math.min(1, 5 * dtReal);
    lockMark.position.set(lock.m.position.x, 0.1, lock.m.position.z);
    lockMark.rotation.y += dtReal * 2;
    lockMark.scale.setScalar(lock.boss ? 2 : 1);
  }
  lockMark.visible = !!lock;
  shake = Math.max(0, shake - dtReal * 1.5);
  const cp = Math.cos(pitch) * 13;
  camera.position.set(
    cam.x + Math.sin(yaw) * cp + rnd(-shake, shake),
    Math.sin(pitch) * 13 + rnd(-shake, shake) * 0.5,
    cam.z + Math.cos(yaw) * cp + rnd(-shake, shake)
  );
  camera.lookAt(cam.x, 0.8, cam.z);
}

/* ---------- HUD ---------- */
const cards = party.map((p, i) => {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.setProperty('--c', '#' + p.color.toString(16).padStart(6, '0'));
  c.innerHTML = `<b>${p.name}</b><small>${p.role}・${EL[p.el].n}</small><i><u></u></i>`;
  c.addEventListener('pointerdown', (e) => { e.preventDefault(); ACT.swap(i); });
  $('party').appendChild(c);
  return { c, u: c.querySelector('u') };
});

function hud() {
  party.forEach((p, i) => {
    cards[i].c.classList.toggle('on', i === cur);
    cards[i].c.classList.toggle('dead', !p.alive);
    cards[i].u.style.width = (p.cur / p.hp) * 100 + '%';
  });
  $('engf').style.width = energy + '%';
  $('hpf').style.width = (party[cur].cur / party[cur].hp) * 100 + '%';
  $('hpn').textContent = party[cur].name + '  ' + Math.ceil(party[cur].cur) + '/' + party[cur].hp;
  const cd = party[cur].cdT;
  $('b-ult').classList.toggle('off', energy < 100);
  $('b-lock').classList.toggle('on', !!lock);
  $('b-skill').classList.toggle('off', cd > 0);
  $('b-skill').textContent = cd > 0 ? Math.ceil(cd) : 'スキル';
  $('msg').style.opacity = msgT > 0 ? 1 : 0;
  const alive = enemies.filter((e) => !e.dead);
  const boss = alive.find((e) => e.boss);
  $('wave').textContent =
    `WAVE ${Math.min(wave, 3)}/3  敵 ${alive.length}` +
    (boss ? `  BOSS ${Math.ceil(boss.hp)}` : '') +
    (buffT > 0 ? '  攻撃UP' : '') +
    (shieldT > 0 ? '  シールド' : '');
}

/* ---------- ループ ---------- */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (mode === 'play') update(dt);
  hud();
  renderer.render(scene, camera);
}
requestAnimationFrame(loop);
