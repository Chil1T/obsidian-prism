import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const rig = require('../dual-mascot-rig.js');

test('dual-mascot-rig aligns strictly with official Claude Clawd PX=3 TICK=100 DOZE_TICK=400 open geometry', () => {
  assert.equal(rig.PX, 3);
  assert.equal(rig.TICK, 100);
  assert.equal(rig.DOZE_TICK, 400);
  const grid = rig.resolveClawdStandGrid();
  assert.deepEqual(grid, rig.OFFICIAL_OPEN_REF);
});

test('Gemini purple cat shares official blocky grammar without outlines or highlight noise', () => {
  const allowedChars = new Set(['#', 's', 'o', '.', ' ']);
  for (const partName of ['ears', 'body', 'eyes', 'legs', 'paws', 'tail']) {
    const group = rig.CAT_PARTS[partName];
    assert.ok(group && typeof group === 'object', `Expected CAT_PARTS.${partName}`);
    for (const [poseKey, layer] of Object.entries(group)) {
      if (!layer || !Array.isArray(layer.rows)) continue;
      for (const row of layer.rows) {
        for (const ch of row) {
          assert.ok(
            allowedChars.has(ch),
            `Unexpected char '${ch}' in CAT_PARTS.${partName}.${poseKey}`
          );
        }
      }
    }
  }
  assert.strictEqual(rig.CAT_PARTS.legs, rig.CLAWD_PARTS.legs);
});

test('buildClipLayers supports full theater, eggs, poke/sulk, and punctuation reactions', () => {
  const theaterPoses = [
    'idle',
    'happy',
    'groom',
    'pet',
    'write',
    'peek',
    'flat',
    'polish',
    'eat',
    'eatFish',
    'chaseDot',
    'catStretch',
    'letter',
    'plant',
    'butterfly',
    'stretch',
    'spinHop',
    'chatGreet',
    'tilt',
    'wow',
    'sulk',
    'onFire',
    'cheerSticks',
    'rickroll',
    'siren',
  ];
  for (const kind of ['clawd', 'cat']) {
    for (const pose of theaterPoses) {
      const layers = rig.buildClipLayers(kind, pose, 6, { clipTick: 6, dir: 'right', blink: false });
      assert.ok(Array.isArray(layers) && layers.length >= 3, `Expected rich layers for ${kind}:${pose}`);
    }
  }

  const fireLayers = rig.buildClipLayers('clawd', 'onFire', 12, { clipTick: 12 });
  assert.ok(fireLayers.includes(rig.PROPS.mug), 'onFire should include coffee mug');
  assert.ok(fireLayers.some((l) => l && l.grounded === true && l.rows.length > 5), 'onFire should include back fire layer');

  const cheerLayers = rig.buildClipLayers('cat', 'cheerSticks', 5, { clipTick: 5 });
  assert.ok(
    cheerLayers.some((l) => l === rig.PROPS.stickLT || l === rig.PROPS.stickUp || l === rig.PROPS.stickRT),
    'cheerSticks should include glowing stick prop'
  );

  const sirenLayers = rig.buildClipLayers('clawd', 'siren', 1, { clipTick: 1 });
  assert.ok(sirenLayers.includes(rig.PROPS.sirenF), 'siren phase 1 should mount front red siren');

  assert.deepEqual(Object.keys(rig.MINI_SPRITES).sort(), ['cowboy', 'shades', 'wizard']);
  for (const id of ['cowboy', 'shades', 'wizard']) {
    assert.ok(rig.MINI_ANIM_FRAMES[id]?.walkB?.rows?.length >= 6, `Missing walkB for ${id}`);
    assert.ok(rig.MINI_ANIM_FRAMES[id]?.trick?.rows?.length >= 6, `Missing trick for ${id}`);
  }
});

test('ecosystem poses, orchestrator ice crystal, doze Zzz, and mouth layers follow blocky grammar', () => {
  const allowedChars = new Set(['#', 's', 'o', '.', ' ']);
  for (const group of [rig.CLAWD_PARTS.mouth, rig.CAT_PARTS.mouth]) {
    assert.ok(group && typeof group === 'object', 'Expected mouth parts');
    for (const layer of Object.values(group)) {
      for (const row of layer.rows) {
        for (const ch of row) {
          assert.ok(allowedChars.has(ch), `Unexpected mouth char '${ch}'`);
        }
      }
    }
  }
  assert.ok(rig.PROPS.iceCrystal?.rows?.length >= 5, 'Expected iceCrystal prop');
  assert.ok(rig.SYMS.dozeZ1?.rows?.length >= 3, 'Expected dozeZ1 symbol');

  for (const pose of ['yawn', 'wave', 'salute', 'worry', 'carry']) {
    for (const kind of ['clawd', 'cat']) {
      const layers = rig.buildClipLayers(kind, pose, 4, { clipTick: 4, crystal: kind === 'clawd' });
      assert.ok(Array.isArray(layers) && layers.length >= 3, `Expected layers for ${kind}:${pose}`);
    }
  }
  const idleCrystal = rig.buildClipLayers('clawd', 'idle', 2, { crystal: true });
  assert.ok(idleCrystal.includes(rig.PROPS.iceCrystal), 'Clawd idle with crystal=true should mount iceCrystal');
});

test('classifyPairEncounter and stepMiniCrabCorridor model bump and pass-by mechanics deterministically', () => {
  assert.equal(typeof rig.classifyPairEncounter, 'function');
  assert.equal(typeof rig.stepMiniCrabCorridor, 'function');

  const headOn = rig.classifyPairEncounter({
    xA: 100,
    yA: 0,
    walkingA: true,
    dirA: 1,
    xB: 130,
    yB: 0,
    walkingB: true,
    dirB: -1,
    contactDist: 42,
  });
  assert.deepEqual(headOn, { kind: 'bump', sign: 1 });

  const soloPass = rig.classifyPairEncounter({
    xA: 100,
    yA: 0,
    walkingA: true,
    dirA: 1,
    xB: 126,
    yB: 0,
    walkingB: false,
    dirB: -1,
    contactDist: 42,
  });
  assert.deepEqual(soloPass, { kind: 'passBy', mover: 'A', stationary: 'B', dir: 1 });

  const overtake = rig.classifyPairEncounter({
    xA: 110,
    yA: 0,
    walkingA: true,
    dirA: 1,
    xB: 124,
    yB: 0,
    walkingB: true,
    dirB: 1,
    contactDist: 42,
  });
  assert.deepEqual(overtake, { kind: 'passBy', mover: 'A', stationary: 'B', dir: 1 });

  assert.equal(
    rig.classifyPairEncounter({ xA: 100, yA: 0, walkingA: true, dirA: 1, xB: 200, yB: 0, walkingB: true, dirB: -1 }),
    null
  );

  const boundaryCrabs = [{ id: 'cowboy', x: 3, px: 3, dir: -1, speed: 5 }];
  rig.stepMiniCrabCorridor(boundaryCrabs, { minX: 2, maxX: 120, nowTick: 1 });
  assert.equal(boundaryCrabs[0].px, 2);
  assert.equal(boundaryCrabs[0].dir, 1);

  const pairCrabs = [
    { id: 'cowboy', px: 50, dir: 1, speed: 2, blinkAt: -99 },
    { id: 'shades', px: 70, dir: -1, speed: 2, blinkAt: -99 },
  ];
  const ev1 = rig.stepMiniCrabCorridor(pairCrabs, { minX: 2, maxX: 220, contactDist: 26, nowTick: 10 });
  assert.equal(ev1.length, 1);
  assert.equal(ev1[0].type, 'crabBump');

  pairCrabs[0].px = 50;
  pairCrabs[0].dir = 1;
  pairCrabs[0].cooldownTick = -1;
  pairCrabs[0].bumpUntilTick = -1;
  pairCrabs[1].px = 70;
  pairCrabs[1].dir = -1;
  pairCrabs[1].cooldownTick = -1;
  pairCrabs[1].bumpUntilTick = -1;
  const ev2 = rig.stepMiniCrabCorridor(pairCrabs, { minX: 2, maxX: 220, contactDist: 26, nowTick: 25 });
  assert.equal(ev2.length, 1);
  assert.equal(ev2[0].type, 'crabPass');
});

test('static frame cache & adaptive heartbeat: skips redundant clearRect + style.transform writes, widens doze timer to 400ms, and pauses 100% when document.hidden', async () => {
  let clearRectCount = 0;
  let transformAssignCount = 0;
  const docListeners = new Map();

  function makeElem(tag, docRef) {
    const attrs = new Map();
    const listeners = new Map();
    const children = [];
    let _transform = '';
    const style = {
      display: '',
      zIndex: '',
      get transform() {
        return _transform;
      },
      set transform(v) {
        _transform = String(v);
        transformAssignCount += 1;
      },
    };
    const el = {
      tagName: String(tag).toUpperCase(),
      ownerDocument: docRef,
      clientWidth: 720,
      width: 96,
      height: 84,
      className: '',
      dataset: {},
      style,
      children,
      get firstChild() {
        return children[0] || null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
      },
      getAttribute(k) {
        return attrs.get(k) ?? null;
      },
      appendChild(ch) {
        children.push(ch);
        return ch;
      },
      removeChild(ch) {
        const i = children.indexOf(ch);
        if (i >= 0) children.splice(i, 1);
        return ch;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 96, bottom: 84, width: 720, height: 84 };
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      dispatch(type, evt = {}) {
        for (const fn of [...(listeners.get(type) || [])]) fn({ type, button: 0, preventDefault() {}, stopPropagation() {}, ...evt });
      },
      getContext(kind) {
        if (kind !== '2d') return null;
        return {
          imageSmoothingEnabled: false,
          fillStyle: '',
          save() {},
          restore() {},
          setTransform() {},
          clearRect() {
            clearRectCount += 1;
          },
          beginPath() {},
          rect() {},
          clip() {},
          translate() {},
          scale() {},
          rotate() {},
          fillRect() {},
          drawImage() {},
        };
      },
    };
    return el;
  }

  const mockDoc = {
    hidden: false,
    defaultView: {
      devicePixelRatio: 1,
      matchMedia: () => ({ matches: false }),
    },
    createElement(tag) {
      return makeElem(tag, mockDoc);
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
    dispatchDoc(type) {
      for (const fn of [...(docListeners.get(type) || [])]) fn({ type });
    },
  };

  const host = makeElem('div', mockDoc);
  const stage = rig.mountDualMascotStage(host, {
    camp: 'gemini',
    streaming: false,
    reducedMotion: true, // 关闭随机眨眼/微抖干扰，纯测帧缓存命中
  });

  try {
    const snap0 = stage.getLayoutSnapshot();
    assert.equal(snap0.perf.timerIntervalMs, 100, 'Active heartbeat must run at 100ms');
    assert.equal(clearRectCount, 2, 'Initial mount draws both mascots once');
    assert.equal(transformAssignCount, 2, 'Initial mount writes initial style.transform once per mascot');

    // 等待 260ms（跨过 2 拍心跳）：因姿态、帧签名与坐标完全未变，必须 0 次 clearRect、0 次 style.transform 写入！
    await new Promise((r) => setTimeout(r, 260));
    const snapIdle = stage.getLayoutSnapshot();
    assert.equal(clearRectCount, 2, 'Unchanged idle frames must completely skip Canvas clearRect/redraw');
    assert.equal(transformAssignCount, 2, 'Stationary mascots must completely skip DOM style.transform writes');
    assert.ok(snapIdle.perf.canvasSkips >= 2, 'Must record skipped canvas redraws');
    assert.ok(snapIdle.perf.domTransformSkips >= 2, 'Must record skipped DOM transform writes');

    // 进入 dozing 打盹态 -> 定时器自动拉宽至 400ms！
    stage.triggerDemo('doze');
    const snapDoze = stage.getLayoutSnapshot();
    assert.equal(snapDoze.dozing, true);
    assert.equal(snapDoze.perf.timerIntervalMs, 400, 'Dozing state must widen heartbeat timer to 400ms');

    // 鼠标靠近舞台 -> 0ms 立即唤醒恢复 100ms 灵敏心跳！
    host.dispatch('pointerenter');
    const snapWoke = stage.getLayoutSnapshot();
    assert.equal(snapWoke.dozing, false);
    assert.equal(snapWoke.perf.timerIntervalMs, 100, 'Pointer approach must restore 100ms heartbeat in 0ms');

    // 再次进入打盹，验证打字同样瞬间唤醒 100ms
    stage.triggerDemo('doze');
    assert.equal(stage.getLayoutSnapshot().perf.timerIntervalMs, 400);
    stage.onUserType('hello!');
    assert.equal(stage.getLayoutSnapshot().perf.timerIntervalMs, 100, 'User typing must restore 100ms heartbeat in 0ms');

    // document.hidden = true -> 100% 暂停定时器（timerIntervalMs === 0）
    mockDoc.hidden = true;
    mockDoc.dispatchDoc('visibilitychange');
    const snapHidden = stage.getLayoutSnapshot();
    assert.equal(snapHidden.perf.timerPaused, true, 'document.hidden must pause heartbeat 100%');
    assert.equal(snapHidden.perf.timerIntervalMs, 0);

    const tickAtHide = snapHidden.actors[0].tick;
    await new Promise((r) => setTimeout(r, 240));
    assert.equal(stage.getLayoutSnapshot().actors[0].tick, tickAtHide, 'Zero ticks may fire while document.hidden');

    // 标签页恢复可见 -> 自动重启心跳
    mockDoc.hidden = false;
    mockDoc.dispatchDoc('visibilitychange');
    assert.equal(stage.getLayoutSnapshot().perf.timerPaused, false);
    assert.equal(stage.getLayoutSnapshot().perf.timerIntervalMs, 100);
  } finally {
    stage.dispose();
  }
});

function createInteractiveStageHarness(opts = {}) {
  const store = new Map(Object.entries(opts.initialStore || {}));
  const fillColors = new Map();

  function makeElem(tag, docRef) {
    const attrs = new Map();
    const listeners = new Map();
    const children = [];
    const style = {
      display: '',
      zIndex: '',
      transform: '',
      pointerEvents: '',
      cursor: '',
      touchAction: '',
    };
    const el = {
      tagName: String(tag).toUpperCase(),
      ownerDocument: docRef,
      clientWidth: opts.width || 720,
      width: 96,
      height: 84,
      className: '',
      dataset: {},
      style,
      children,
      get firstChild() {
        return children[0] || null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
      },
      getAttribute(k) {
        return attrs.get(k) ?? null;
      },
      appendChild(ch) {
        children.push(ch);
        return ch;
      },
      removeChild(ch) {
        const i = children.indexOf(ch);
        if (i >= 0) children.splice(i, 1);
        return ch;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, right: 96, bottom: 84, width: opts.width || 720, height: 84 };
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      dispatch(type, evt = {}) {
        for (const fn of [...(listeners.get(type) || [])]) {
          fn({ type, button: 0, pointerId: 1, preventDefault() {}, stopPropagation() {}, ...evt });
        }
      },
      getContext(kind) {
        if (kind !== '2d') return null;
        return {
          imageSmoothingEnabled: false,
          _fill: '',
          get fillStyle() {
            return this._fill;
          },
          set fillStyle(v) {
            this._fill = String(v);
          },
          save() {},
          restore() {},
          setTransform() {},
          clearRect() {},
          beginPath() {},
          rect() {},
          clip() {},
          translate() {},
          scale() {},
          rotate() {},
          fillRect() {
            const key = el.dataset.miniCrab || el.className || 'canvas';
            if (!fillColors.has(key)) fillColors.set(key, new Set());
            fillColors.get(key).add(this._fill);
          },
          drawImage() {},
        };
      },
    };
    return el;
  }

  const localStorage = {
    getItem(k) {
      return store.has(k) ? store.get(k) : null;
    },
    setItem(k, v) {
      store.set(String(k), String(v));
    },
    removeItem(k) {
      store.delete(String(k));
    },
  };

  const mockDoc = {
    hidden: false,
    defaultView: {
      devicePixelRatio: 1,
      localStorage,
      matchMedia: () => ({ matches: false }),
    },
    createElement(tag) {
      return makeElem(tag, mockDoc);
    },
    addEventListener() {},
    removeEventListener() {},
  };

  const host = makeElem('div', mockDoc);
  const stage = rig.mountDualMascotStage(host, {
    camp: 'gemini',
    miniPileEnabled: opts.miniPileEnabled ?? true,
    reducedMotion: opts.reducedMotion ?? false,
  });

  const findActorEl = (id) => host.children.find((c) => c.getAttribute?.('data-mascot-id') === id);
  const findMiniEl = (id) => {
    const group = host.children.find((c) => c.className === 'ag-v2-mini-pile');
    return group?.children.find((c) => c.dataset?.miniCrab === id) || null;
  };

  return { host, stage, store, fillColors, findActorEl, findMiniEl };
}

test('resolveGroundSeparation enforces >= 6px rigid-body clear gap across all 5 pets without overlap', () => {
  const crowded = [
    { id: 'cat', cx: 300, halfW: 22 },
    { id: 'clawd', cx: 300, halfW: 22 },
    { id: 'cowboy', cx: 300, halfW: 13 },
    { id: 'shades', cx: 301, halfW: 13 },
    { id: 'wizard', cx: 299, halfW: 13 },
  ];
  rig.resolveGroundSeparation(crowded, 14, 706, 6);
  const sorted = [...crowded].sort((a, b) => a.cx - b.cx);
  for (let i = 0; i < sorted.length; i++) {
    assert.ok(sorted[i].cx - sorted[i].halfW >= 13.99, 'Must stay inside left stage bound');
    assert.ok(sorted[i].cx + sorted[i].halfW <= 706.01, 'Must stay inside right stage bound');
    if (i < sorted.length - 1) {
      const gap = sorted[i + 1].cx - sorted[i].cx - (sorted[i].halfW + sorted[i + 1].halfW);
      assert.ok(gap >= 5.95, `Expected >= 6px clear gap between ${sorted[i].id} and ${sorted[i + 1].id}, got ${gap}`);
    }
  }

  // 验证真实 5 宠舞台拖拽同位松手后自动刚体推挤防重叠
  const { stage, findActorEl } = createInteractiveStageHarness({ miniPileEnabled: true, reducedMotion: true });
  try {
    const snap0 = stage.getLayoutSnapshot();
    const clawdCx = snap0.actors.find((a) => a.id === 'clawd').worldCx;
    const catCx = snap0.actors.find((a) => a.id === 'cat').worldCx;
    const catEl = findActorEl('cat');
    // 将 cat 直接拖到与 clawd 完全重合的地面位置松手
    catEl.dispatch('pointerdown', { clientX: catCx, clientY: 80 });
    catEl.dispatch('pointermove', { clientX: clawdCx, clientY: 80 });
    catEl.dispatch('pointerup', { clientX: clawdCx, clientY: 80 });

    const snap1 = stage.getLayoutSnapshot();
    const grounded = [
      ...snap1.actors.map((a) => ({ id: a.id, cx: a.worldCx, hw: 22 })),
      ...snap1.minis.map((m) => ({ id: m.id, cx: m.worldCx, hw: 13 })),
    ].sort((a, b) => a.cx - b.cx);
    for (let i = 0; i < grounded.length - 1; i++) {
      const clearGap = grounded[i + 1].cx - grounded[i].cx - (grounded[i].hw + grounded[i + 1].hw);
      assert.ok(clearGap >= 5.5, `Grounded pets ${grounded[i].id} & ${grounded[i + 1].id} must not overlap (gap=${clearGap})`);
    }
  } finally {
    stage.dispose();
  }
});

test('obstacle encounters support parabolic leapfrog (~26px peak), autoPerch hitchhike, and greetTurn reversal', async () => {
  assert.equal(rig.chooseObstacleAction({ canLeap: true, canPerch: true, roll: 0.2 }), 'leapfrog');
  assert.equal(rig.chooseObstacleAction({ canLeap: true, canPerch: true, roll: 0.55 }), 'autoPerch');
  assert.equal(rig.chooseObstacleAction({ canLeap: true, canPerch: true, roll: 0.9 }), 'greetTurn');
  assert.equal(rig.chooseObstacleAction({ canLeap: false, canPerch: false, roll: 0.1 }), 'greetTurn');

  const { stage } = createInteractiveStageHarness({ miniPileEnabled: true, reducedMotion: false });
  try {
    // (a) 抛物线撑跳越过（leapfrog）：跃起峰值约 ~26px，落地到伙伴另一侧
    stage.triggerDemo('leapfrog');
    let minArcY = 0;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 95));
      const cat = stage.getLayoutSnapshot().actors.find((a) => a.id === 'cat');
      if (cat.y < minArcY) minArcY = cat.y;
    }
    assert.ok(minArcY <= -20 && minArcY >= -30, `Leapfrog parabolic arc peak should be ~26px, observed ${-minArcY}px`);
    const afterLeap = stage.getLayoutSnapshot();
    const catAfter = afterLeap.actors.find((a) => a.id === 'cat');
    const clawdAfter = afterLeap.actors.find((a) => a.id === 'clawd');
    assert.ok(catAfter.worldCx > clawdAfter.worldCx + 44, 'Cat must land cleanly on the far side of Clawd after leapfrog');

    // (b) 顺势跳上头顶搭便车（autoPerch）：底座散步驮着上层同步位移
    stage.triggerDemo('autoPerch');
    await new Promise((r) => setTimeout(r, 680));
    const perched = stage.getLayoutSnapshot();
    const catP = perched.actors.find((a) => a.id === 'cat');
    const clawdP = perched.actors.find((a) => a.id === 'clawd');
    assert.equal(catP.stackedOn, 'clawd', 'AutoPerch must land cat onto Clawd head');
    const startBaseCx = clawdP.worldCx;
    await new Promise((r) => setTimeout(r, 320));
    const movedSnap = stage.getLayoutSnapshot();
    const catMoved = movedSnap.actors.find((a) => a.id === 'cat');
    const clawdMoved = movedSnap.actors.find((a) => a.id === 'clawd');
    assert.notEqual(clawdMoved.worldCx, startBaseCx, 'Walking base must carry the stack forward');
    assert.equal(catMoved.worldCx, clawdMoved.worldCx, 'Perched rider must move in lockstep with walking base');

    // (c) 驻足礼貌互动后转身（greetTurn）
    stage.triggerDemo('unstack');
    const act = stage.triggerObstacle('cowboy', 'clawd', 'greetTurn');
    assert.equal(act, 'greetTurn');
    assert.equal(stage.getLayoutSnapshot().lastInteraction.type, 'greetTurn');
  } finally {
    stage.dispose();
  }
});

test('multi-tier totem stack (up to 5 tiers), pointer drag stacking, pull-out gravity settle, and vigorous side-hop dismount', async () => {
  const { stage, findMiniEl } = createInteractiveStageHarness({ miniPileEnabled: true, reducedMotion: false });
  try {
    // 1. 构建 4 层混搭图腾塔：clawd -> cowboy -> cat -> shades，再用鼠标指针拖拽 wizard 叠上第 5 层！
    assert.equal(stage.stackOnto('cowboy', 'clawd'), true);
    assert.equal(stage.stackOnto('cat', 'cowboy'), true);
    assert.equal(stage.stackOnto('shades', 'cat'), true);

    const snap4 = stage.getLayoutSnapshot();
    const shadesSnap = snap4.minis.find((m) => m.id === 'shades');
    const wizSnap0 = snap4.minis.find((m) => m.id === 'wizard');
    const wizEl = findMiniEl('wizard');

    // 模拟真实鼠标拖拽第 5 只迷你蟹 wizard 到塔顶 shades 头顶（perchY = shades.y - 16）悬停稳放松手
    const targetDropY = shadesSnap.y - 16;
    wizEl.dispatch('pointerdown', { clientX: wizSnap0.worldCx, clientY: 100 });
    wizEl.dispatch('pointermove', { clientX: shadesSnap.worldCx, clientY: 100 + targetDropY });
    await new Promise((r) => setTimeout(r, 45));
    wizEl.dispatch('pointerup', { clientX: shadesSnap.worldCx, clientY: 100 + targetDropY });

    const snap5 = stage.getLayoutSnapshot();
    assert.deepEqual(snap5.towers, [['clawd', 'cowboy', 'cat', 'shades', 'wizard']], '5-pet mode must support full 5-tier mixed totem stack');

    // 2. 抽走中间层 'cowboy'：上方 ['cat', 'shades', 'wizard'] 受重力顺滑下落补位，扣合在 'clawd' 头顶重组为 4 层塔！
    stage.pullFromStack('cowboy', 'settle');
    await new Promise((r) => setTimeout(r, 340));
    const snapSettledMid = stage.getLayoutSnapshot();
    assert.deepEqual(
      snapSettledMid.towers,
      [['clawd', 'cat', 'shades', 'wizard']],
      'Upper sub-tower must smoothly gravity-settle onto lower holder after middle pet is pulled out'
    );

    // 3. 抽走最底层底座 'clawd'：上方子塔 ['cat', 'shades', 'wizard'] 顺滑落回地面 y=0！
    stage.pullFromStack('clawd', 'settle');
    await new Promise((r) => setTimeout(r, 360));
    const snapSettledBottom = stage.getLayoutSnapshot();
    assert.deepEqual(
      snapSettledBottom.towers,
      [['cat', 'shades', 'wizard']],
      'Upper sub-tower must remain intact and settle smoothly onto ground when base is pulled out'
    );
    const catBase = snapSettledBottom.actors.find((a) => a.id === 'cat');
    assert.equal(catBase.y, 0, 'New root cat must settle cleanly on ground y=0');

    // 4. 剧烈动作（如 onFire）触发上方骑乘者轻巧侧跳落地解绑
    stage.triggerDemo('fire');
    await new Promise((r) => setTimeout(r, 450));
    const snapAfterFire = stage.getLayoutSnapshot();
    assert.deepEqual(snapAfterFire.towers, [], 'Vigorous action on base must dismount riders safely to ground');
  } finally {
    stage.dispose();
  }
});

test('three-stage chromaResonance state machine, diagonal spectrum flow, crystal ear glints, persistence, and 4-tap toggle', () => {
  // 验证对角线色相梯度与暗部体块阴影插值
  const cA = rig.evalChromaColorAt(2, 2, 0.1, false);
  const cB = rig.evalChromaColorAt(9, 6, 0.1, false);
  const cShadow = rig.evalChromaColorAt(2, 2, 0.1, true);
  assert.match(cA, /^#[0-9a-f]{6}$/);
  assert.notEqual(cA, cB, 'Chroma coat must vary diagonally across (gx + gy)');
  assert.notEqual(cA, cShadow, 'Shadow pixels must use darkened matching hue for blocky volume');

  const h1 = createInteractiveStageHarness({ miniPileEnabled: true, reducedMotion: false });
  try {
    // 搭起 3 层塔（clawd -> cowboy -> cat），但在前置编码门禁达成前连点 4 次绝不误触发
    h1.stage.stackOnto('cowboy', 'clawd');
    h1.stage.stackOnto('cat', 'cowboy');
    for (let i = 0; i < 4; i++) h1.stage.poke('cat');
    assert.equal(h1.stage.getLayoutSnapshot().chromaResonance.active, false, 'Must not awaken before both session gates');

    // 达成 Gate 1（算力调谐）+ Gate 2（编码锻造）
    h1.stage.notify('model-shift');
    h1.stage.notify('code-copied');
    const gated = h1.stage.getLayoutSnapshot().chromaResonance;
    assert.equal(gated.tuned, true);
    assert.equal(gated.forged, true);
    assert.equal(gated.active, false);

    // Gate 3：在 >=3 层叠塔态 1.8s 内连点小紫猫 4 次 -> 迸发 12 粒棱镜像素星屑并觉醒！
    for (let i = 0; i < 4; i++) h1.stage.poke('cat');
    const awakened = h1.stage.getLayoutSnapshot();
    assert.equal(awakened.chromaResonance.active, true, '4 taps in 3-tier tower after gates must awaken chromaResonance');
    assert.ok(awakened.chromaResonance.sparkCount >= 12, 'Awakening must burst >= 12 four-color prismatic sparks');
    assert.equal(h1.store.get('__op_chroma_v1'), '1', 'Must persist unlocked state to __op_chroma_v1');

    const catCanvasColors = h1.fillColors.get('ag-v2-mascot-canvas') || new Set();
    assert.ok(
      [...catCanvasColors].some((c) => c.toUpperCase() === '#FFFFFF'),
      'Chroma cat must paint pure #FFFFFF crystal ear glints'
    );

    // 验证跨会话重挂载自动恢复炫彩形态，且叠塔连点 4 次可自由切回原色紫猫
    const h2 = createInteractiveStageHarness({
      miniPileEnabled: false,
      reducedMotion: false,
      initialStore: { __op_chroma_v1: '1' },
    });
    try {
      assert.equal(h2.stage.getLayoutSnapshot().chromaResonance.active, true, 'Saved __op_chroma_v1=1 must restore on mount');
      // 双宠模式下叠成 2 层塔，连点 4 次切回原色紫猫
      h2.stage.stackOnto('cat', 'clawd');
      for (let i = 0; i < 4; i++) h2.stage.poke('cat');
      assert.equal(h2.stage.getLayoutSnapshot().chromaResonance.active, false, '4 taps in tower must toggle off back to classic purple coat');
      assert.equal(h2.store.has('__op_chroma_v1'), false, 'Toggling off must clear __op_chroma_v1');
    } finally {
      h2.stage.dispose();
    }
  } finally {
    h1.stage.dispose();
  }
});

test('high-rate pointer dragging of mini-crabs and main actors disables CSS transition lag and writes subpixel GPU transforms directly', () => {
  const { host, stage, findMiniEl, findActorEl } = createInteractiveStageHarness({ miniPileEnabled: true, reducedMotion: false });
  try {
    let rectReadsDuringMove = 0;
    const origRect = host.getBoundingClientRect;
    host.getBoundingClientRect = () => {
      rectReadsDuringMove += 1;
      return origRect();
    };

    const miniEl = findMiniEl('cowboy');
    const snap0 = stage.getLayoutSnapshot().minis.find((m) => m.id === 'cowboy');
    miniEl.dispatch('pointerdown', { clientX: snap0.worldCx, clientY: 100 });
    rectReadsDuringMove = 0;

    // 模拟 1000Hz 电竞鼠标连续亚像素微移
    miniEl.dispatch('pointermove', { clientX: snap0.worldCx + 8.37, clientY: 91.64 });
    miniEl.dispatch('pointermove', { clientX: snap0.worldCx + 14.73, clientY: 84.28 });
    assert.equal(rectReadsDuringMove, 0, 'pointermove must perform 0 synchronous getBoundingClientRect reflows');
    assert.equal(miniEl.getAttribute('data-direct'), '1', 'Dragging mini-crab must lock data-direct="1" to bypass 180ms steps(2,end) CSS transition');
    assert.equal(miniEl.style.transition, 'none', 'Inline transition must be none during drag');
    assert.match(miniEl.style.transform, /\d+\.\d+px/, 'Subpixel coordinates must stream directly without coarse integer rounding lag');

    miniEl.dispatch('pointerup', { clientX: snap0.worldCx + 14.73, clientY: 84.28 });

    // Mascot elements must never expose hover title tooltips
    const clawdEl = findActorEl('clawd');
    const catEl = findActorEl('cat');
    assert.equal(clawdEl.getAttribute('title'), null, 'Clawd must never show hover title tooltip');
    assert.equal(catEl.getAttribute('title'), null, 'Cat must never show hover title tooltip');
    assert.equal(miniEl.getAttribute('title'), null, 'Mini crabs must never show hover title tooltip');

    // 主宠同步验证零重排与直通锁
    const catCx0 = stage.getLayoutSnapshot().actors.find((a) => a.id === 'cat').worldCx;
    catEl.dispatch('pointerdown', { clientX: catCx0, clientY: 100 });
    rectReadsDuringMove = 0;
    catEl.dispatch('pointermove', { clientX: catCx0 - 12.42, clientY: 88.15 });
    assert.equal(rectReadsDuringMove, 0, 'Actor pointermove must also perform 0 getBoundingClientRect reflows');
    assert.equal(catEl.getAttribute('data-direct'), '1');
    assert.equal(catEl.style.transition, 'none');
    catEl.dispatch('pointerup', { clientX: catCx0 - 12.42, clientY: 88.15 });
  } finally {
    stage.dispose();
  }
});
