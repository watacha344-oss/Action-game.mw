import * as THREE from './three.module.min.js';

const $ = (id) => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a);

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

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();
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
  { name: 'アカリ', role: '近接', color: 0x00e5ff, hp: 130, atk: 14, range: 2.8, arc: 2.0, cd: 5 },
  { name: 'ノア', role: '遠距離/バフ', color: 0xff5ad1, hp: 90, atk: 11, range: 9, arc: 0.4, cd: 7 },
  { name: 'ミオ', role: '回復/補助', color: 0x7dff8a, hp: 105, atk: 9, range: 5, arc: 0.8, cd: 8 },
];
const party = DEFS.map((d) => ({ ...d, cur: d.hp, alive: true, cdT: 0 }));

let mode = 'title';
let cur = 0, energy = 0, buffT = 0, shieldT = 0, slow = 0, inv = 0, face = 0;
let combo = 0, comboT = 0, swapCd = 0, dodgeCd = 0, parryCd = 0, flashP = 0, msgT = 0;
let wave = 0, time = 0, holdAtk = false;
let act = { type: '', t: 0 };
const dash = new THREE.Vector3();
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
const stick = $('stick'), knob = $('knob');
let sid = null, sx = 0, sy = 0;
function stickMove(e) {
  const r = stick.getBoundingClientRect();
  const m = r.width / 2;
  let dx = e.clientX - (r.left + m), dy = e.clientY - (r.top + m);
  const l = Math.hypot(dx, dy);
  if (l > m) { dx = (dx / l) * m; dy = (dy / l) * m; }
  sx = dx / m; sy = dy / m;
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
}
stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(sid); stickMove(e); });
stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) stickMove(e); });
const stickEnd = (e) => { if (e.pointerId === sid) { sid = null; sx = sy = 0; knob.style.transform = ''; } };
stick.addEventListener('pointerup', stickEnd);
stick.addEventListener('pointercancel', stickEnd);

const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.repeat) return;
  const a = { KeyJ: 'atk', KeyK: 'dodge', KeyL: 'parry', KeyU: 'skill', KeyI: 'ult', KeyQ: 'swap' }[e.code];
  if (a) ACT[a]();
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });

document.querySelectorAll('.b').forEach((b) => {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (b.dataset.a === 'atk') holdAtk = true;
    ACT[b.dataset.a]();
  });
});
const relAtk = () => { holdAtk = false; };
window.addEventListener('pointerup', relAtk);
window.addEventListener('pointercancel', relAtk);

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

function hurt(e, dmg) {
  if (e.stun > 0) dmg *= 1.5;
  e.hp -= dmg;
  e.flash = 0.12;
  energy = Math.min(100, energy + dmg * 0.25);
  if (e.hp <= 0) { e.dead = true; scene.remove(e.m); }
}

function strike(range, arc, dmg) {
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
    hurt(e, dmg);
  }
}

function aim() {
  let best = null, bd = 10;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.m.position.distanceTo(player.position);
    if (d < bd) { bd = d; best = e; }
  }
  if (best) face = angTo(best.m.position);
}

const ACT = {
  atk() {
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
    if (l > 0.2) dash.set(mv.x / l, 0, mv.y / l);
    else dash.set(Math.sin(face), 0, Math.cos(face));
    face = Math.atan2(dash.x, dash.z);
    act = { type: 'dodge', t: 0.3 };
    dodgeCd = 0.5;
  },
  parry() {
    if (!free() || parryCd > 0) return;
    act = { type: 'parry', t: 0.3 };
    parryCd = 0.8;
    fx(1.6, 0xffffff);
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
  },
  swap() {
    if (mode !== 'play' || swapCd > 0) return;
    for (let i = 1; i <= 3; i++) {
      const n = (cur + i) % 3;
      if (!party[n].alive) continue;
      if (n === cur) return;
      cur = n;
      setBody();
      swapCd = 0.8;
      inv = 0.4;
      comboT = 0;
      fx(3, party[n].color);
      strike(3, 7, 16 * mul());
      return;
    }
  },
};

function playerHit(dmg, e) {
  if (inv > 0) return;
  if (act.type === 'dodge') {
    slow = 1.4;
    inv = 0.3;
    energy = Math.min(100, energy + 20);
    say('ジャスト回避!');
    return;
  }
  if (act.type === 'parry') {
    e.stun = e.boss ? 1.4 : 2.2;
    e.state = 'chase';
    e.t = 1.5;
    energy = Math.min(100, energy + 25);
    fx(2.5, 0xffffff);
    say('パリィ!');
    return;
  }
  if (shieldT > 0) dmg *= 0.4;
  const c = party[cur];
  c.cur -= dmg;
  inv = 0.6;
  flashP = 0.15;
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
  const a = rnd(0, Math.PI * 2);
  const m = makeBody(boss ? 0xff3355 : 0xff8a3d, boss ? 2 : 1);
  m.position.set(Math.cos(a) * 14, 0, Math.sin(a) * 14);
  scene.add(m);
  const hp = boss ? 420 : 45;
  enemies.push({ m, hp, boss, r: boss ? 1.2 : 0.5, state: 'chase', t: rnd(1, 2), stun: 0, flash: 0, dead: false });
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
      if (e.t <= 0 && d <= rng * 1.2) { e.state = 'wind'; e.t = e.boss ? 0.9 : 0.7; }
    } else {
      e.t -= dt;
      mat.emissive.setHex(0xffcc00);
      if (e.t <= 0) {
        if (d <= rng + 0.5) playerHit(e.boss ? 26 : 12, e);
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
  enemies.forEach((e) => scene.remove(e.m));
  enemies.length = 0;
  party.forEach((p) => { p.cur = p.hp; p.alive = true; p.cdT = 0; });
  cur = 0;
  setBody();
  player.position.set(0, 0, 0);
  face = 0; energy = 0; buffT = 0; shieldT = 0; slow = 0; inv = 0; combo = 0; comboT = 0;
  wave = 0; time = 0;
  act = { type: '', t: 0 };
  $('ov').style.display = 'none';
  mode = 'play';
}
$('go').addEventListener('click', start);

function update(dtReal) {
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
    player.position.x += (mv.x / l) * s;
    player.position.z += (mv.y / l) * s;
    if (!act.type) face = Math.atan2(mv.x, mv.y);
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
  camera.position.x += (player.position.x - camera.position.x) * k;
  camera.position.z += (player.position.z + 9.5 - camera.position.z) * k;
  camera.position.y = 9;
  camera.lookAt(camera.position.x, 0.5, camera.position.z - 9.5);
}

/* ---------- HUD ---------- */
const cards = party.map((p) => {
  const c = document.createElement('div');
  c.className = 'card';
  c.style.setProperty('--c', '#' + p.color.toString(16).padStart(6, '0'));
  c.innerHTML = `<b>${p.name}</b><small>${p.role}</small><i><u></u></i>`;
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
  const cd = party[cur].cdT;
  $('b-ult').classList.toggle('off', energy < 100);
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
