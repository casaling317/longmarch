/* ============================================================
 * audio.js —— 《60 秒》环境氛围音（Web Audio 实时合成，无外部素材）
 * ------------------------------------------------------------
 * 声音构成：
 *  - 风声：白噪声 -> 低通滤波，LFO 缓慢调制滤波频率
 *  - 脚步：周期性低频“咚”声（振荡器 + 快速衰减包络）
 *  - 呼吸：对噪声做缓慢幅度 LFO（吸/呼）
 *  - 水声（湘江幕）：白噪声 -> 低通 ~320Hz，LFO 缓慢幅度调制（波浪起伏），独立于 60 秒氛围音
 * 全部音量偏低，仅作氛围。需在用户手势后启动（浏览器策略）。
 * ============================================================ */
(function () {
  let ctx = null;
  let master = null;
  let nodes = [];
  let footTimer = null;
  let running = false;
  let muted = false;
  const MASTER_VOL = 0.5;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOL;
    master.connect(ctx.destination);
  }

  function makeNoiseSource() {
    const size = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.start();
    return src;
  }

  function start() {
    if (running) return;
    ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    running = true;

    /* --- 风声 --- */
    const wind = makeNoiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    lp.Q.value = 0.8;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start();
    wind.connect(lp);
    lp.connect(windGain);
    windGain.connect(master);
    nodes.push(wind, lp, windGain, lfo, lfoGain);

    /* --- 呼吸（对另一路噪声做缓慢幅度调制） --- */
    const breath = makeNoiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 0.6;
    const breathGain = ctx.createGain();
    breathGain.gain.value = 0.0;
    const breathLfo = ctx.createOscillator();
    breathLfo.frequency.value = 0.16; // 约 6 秒一次呼吸
    const breathLfoGain = ctx.createGain();
    breathLfoGain.gain.value = 0.05;
    breathLfo.connect(breathLfoGain);
    breathLfoGain.connect(breathGain.gain);
    breathLfo.start();
    breath.connect(bp);
    bp.connect(breathGain);
    breathGain.connect(master);
    nodes.push(breath, bp, breathGain, breathLfo, breathLfoGain);

    /* --- 脚步 --- */
    let step = 0;
    footTimer = setInterval(function () {
      if (!running) return;
      thump(step % 2 === 0 ? 0.07 : 0.05);
      step++;
    }, 850);
  }

  function thump(vol) {
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = "sine";
    const g = ctx.createGain();
    o.connect(g);
    g.connect(master);
    const t = ctx.currentTime;
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    o.start(t);
    o.stop(t + 0.32);
  }

  function stop() {
    running = false;
    if (footTimer) { clearInterval(footTimer); footTimer = null; }
    nodes.forEach(function (n) {
      try { if (n.stop) n.stop(); } catch (e) {}
      try { n.disconnect(); } catch (e) {}
    });
    nodes = [];
  }

  /* ---------- 水声层（湘江幕，独立于 60 秒氛围音，受总开关控制） ---------- */
  let waterNodes = [];
  let waterRunning = false;

  function startWater() {
    if (waterRunning) return;
    ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    waterRunning = true;

    const water = makeNoiseSource();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.value = 0;
    /* 波浪起伏：LFO 缓慢调制幅度 */
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.04;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    lfo.start();
    water.connect(lp);
    lp.connect(g);
    g.connect(master);
    /* 1.2 秒淡入，音量克制 */
    g.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 1.2);
    waterNodes.push(water, lp, g, lfo, lfoGain);
  }

  function stopWater() {
    if (!waterRunning) return;
    waterRunning = false;
    const list = waterNodes;
    waterNodes = [];
    const g = list[2];
    if (g && ctx) {
      try {
        g.gain.cancelScheduledValues(ctx.currentTime);
        g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
      } catch (e) {}
    }
    setTimeout(function () {
      list.forEach(function (n) {
        try { if (n.stop) n.stop(); } catch (e) {}
        try { n.disconnect(); } catch (e) {}
      });
    }, 700);
  }

  /* 牺牲瞬间：电影级"重击/boom"（三层叠加），营造"心头一震"
     ① 低频 sub-bass 正弦：心脏一沉
     ② 低通白噪声 burst：闷雷/冲击质感（纯正弦缺的"轰"）
     ③ 三角波 boom：中低频厚度 */
  function playSacrifice() {
    ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    var t = ctx.currentTime;

    /* ① 低频"咚"：58→24Hz，极快起音，长衰减 */
    var o = ctx.createOscillator();
    o.type = "sine";
    var g = ctx.createGain();
    o.connect(g);
    g.connect(master);
    o.frequency.setValueAtTime(58, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.6);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.7, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    o.start(t);
    o.stop(t + 1.35);

    /* ② 噪声"轰"：低通白噪声 burst（500→70Hz），给冲击质感 */
    var dur = 1.0;
    var buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.8);
    }
    var noise = ctx.createBufferSource();
    noise.buffer = buf;
    var nf = ctx.createBiquadFilter();
    nf.type = "lowpass";
    nf.frequency.setValueAtTime(500, t);
    nf.frequency.exponentialRampToValueAtTime(70, t + 0.9);
    var ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(master);
    noise.start(t);
    noise.stop(t + dur);

    /* ③ 中低频"boom"：三角波 88→38Hz，给厚度 */
    var o2 = ctx.createOscillator();
    o2.type = "triangle";
    var g2 = ctx.createGain();
    o2.connect(g2);
    g2.connect(master);
    o2.frequency.setValueAtTime(88, t);
    o2.frequency.exponentialRampToValueAtTime(38, t + 0.45);
    g2.gain.setValueAtTime(0, t);
    g2.gain.linearRampToValueAtTime(0.35, t + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    o2.start(t);
    o2.stop(t + 0.75);
  }

  /* ===== 分幕配乐（外部 MP3，页面加载即预缓冲 + 交叉淡入淡出 + 循环） =====
     可靠性设计：
     ① preloadBGM() 页面加载时创建所有幕的 Audio 并 load()，提前缓冲、提前暴露加载错误
     ② startSceneBGM(scene) 在用户手势内 play()；被浏览器拒绝则 150ms 后重试一次
     ③ 每幕独立 Audio 实例（bgmPool），切幕时交叉淡入淡出，同一时间只播一首
     ④ 淡入淡出用“每实例代际”计数，交叉渐变互不打架
     ⑤ 停止只 pause+归零，不销毁实例（复用预缓冲，下次秒播）
     ⑥ 兼容旧接口：startBGM/stopBGM 等价于湘江幕 */
  var BGM_SCENES = {
    xianghe: "audio/cyberwave-orchestra-dramatic.mp3", /* 湘江·悲壮管弦（已有） */
    turning: "audio/turning-hope.mp3",                  /* 遵义·希望/破晓（待提供） */
    stars:   "audio/stars-expansive.mp3"                /* 星辰·开阔/传承（待提供） */
  };
  var BGM_VOL = 0.6;        /* 配乐音量（相对 0-1） */
  var bgmPool = {};         /* sceneName -> Audio */
  var bgmReady = {};        /* sceneName -> bool（canplaythrough 后置 true） */
  var bgmCurrent = null;    /* 当前播放的 sceneName */

  function fadeBgmTo(a, target, ms, done) {
    if (!a) { if (done) done(); return; }
    var from = a.volume;
    var startT = performance.now();
    var gen = (a._fadeGen || 0) + 1;
    a._fadeGen = gen;
    (function step(now) {
      if (!a || a._fadeGen !== gen) return; /* 被更新的渐变取代 */
      /* k 夹在 [0,1]：rAF 时间戳可能略早于 startT，否则负 k 会算出负音量 → IndexSizeError 中断淡入 */
      var k = Math.max(0, Math.min(1, (now - startT) / ms));
      a.volume = Math.max(0, Math.min(1, from + (target - from) * k));
      if (k < 1) {
        requestAnimationFrame(step);
      } else {
        if (done) done();
      }
    })(performance.now());
  }

  function ensureBGM(scene) {
    if (bgmPool[scene]) return bgmPool[scene];
    var src = BGM_SCENES[scene];
    if (!src) return null;
    try {
      var a = new Audio(src);
      a.loop = true;      /* 循环到退场 */
      a.volume = 0;
      a.preload = "auto"; /* 立即缓冲 */
      a.addEventListener("canplaythrough", function () {
        bgmReady[scene] = true;
        console.log("【配乐】已缓冲就绪：" + scene + " → " + src);
      });
      a.addEventListener("error", function () {
        console.log("【配乐】文件加载失败（路径或格式问题）：" + scene + " → " + src);
      });
      if (a.load) a.load();
      bgmPool[scene] = a;
    } catch (e) {
      console.log("【配乐】创建 Audio 失败：" + scene, e);
    }
    return bgmPool[scene];
  }

  function preloadBGM() {
    Object.keys(BGM_SCENES).forEach(function (s) { ensureBGM(s); });
  }

  /* 播放某幕 BGM：未就绪/被拒时自动重试（最多 6 次、每次 200ms），
     覆盖“文件还没缓冲好”导致的间歇性无声 */
  function tryPlayBGM(scene, a, attempt) {
    attempt = attempt || 0;
    var p;
    try { p = a.play(); } catch (e) { p = null; }
    if (p && p.then) {
      p.then(function () {
        console.log("【配乐】" + scene + " 开始播放（第 " + (attempt + 1) + " 次尝试）");
      }).catch(function (e) {
        if (attempt < 6) {
          setTimeout(function () { tryPlayBGM(scene, a, attempt + 1); }, 200);
        } else {
          console.log("【配乐】" + scene + " 播放失败（已重试 6 次）：" + (e && e.name) + " readyState=" + a.readyState);
        }
      });
    }
  }

  function startSceneBGM(scene) {
    var a = ensureBGM(scene);
    if (!a) { console.log("【配乐】无此幕音频：" + scene); return; }
    /* 交叉淡出当前幕（若不同） */
    if (bgmCurrent && bgmCurrent !== scene) {
      var old = bgmPool[bgmCurrent];
      if (old) fadeBgmTo(old, 0, 900, function () {
        try { old.pause(); old.currentTime = 0; } catch (e) {}
      });
    }
    bgmCurrent = scene;
    /* 确保已发起加载（readyState=0 时重新 load，避免“还没开始加载”导致 play 失败） */
    if (a.readyState === 0 && a.load) { try { a.load(); } catch (e) {} }
    if (a.paused || a.ended) {
      tryPlayBGM(scene, a, 0);
    }
    if (!muted) {
      console.log("【配乐】启动 " + scene + "（淡入 2.5s）readyState=" + a.readyState + " paused=" + a.paused + " t=" + a.currentTime.toFixed(1) + "s");
      fadeBgmTo(a, BGM_VOL, 2500);
    }
  }

  function stopSceneBGM() {
    if (!bgmCurrent) return;
    var a = bgmPool[bgmCurrent];
    if (a) fadeBgmTo(a, 0, 900, function () {
      try { a.pause(); a.currentTime = 0; } catch (e) {}
      /* 不销毁：保留预缓冲实例，下次秒播 */
    });
    bgmCurrent = null;
  }

  /* 兼容旧接口：湘江高潮用 */
  function startBGM() { startSceneBGM("xianghe"); }
  function stopBGM() { stopSceneBGM(); }

  function setBgmMuted(m) {
    if (!bgmCurrent) return;
    var a = bgmPool[bgmCurrent];
    if (a) a.volume = m ? 0 : BGM_VOL;
  }

  function setMuted(m) {
    muted = m;
    if (master) master.gain.value = m ? 0 : MASTER_VOL;
    setBgmMuted(m);
  }

  window.AudioAmbient = {
    start: start,
    stop: stop,
    startWater: startWater,
    stopWater: stopWater,
    playSacrifice: playSacrifice,
    preloadBGM: preloadBGM,
    startBGM: startBGM,
    stopBGM: stopBGM,
    startSceneBGM: startSceneBGM,
    stopSceneBGM: stopSceneBGM,
    setMuted: setMuted,
    isMuted: function () { return muted; }
  };
})();
