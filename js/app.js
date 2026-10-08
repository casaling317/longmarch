/* ============================================================
 * app.js —— 场景管理 / 交互 / 60 秒 / 烽火→星辰转场 / 返回重玩
 * 依赖：content.js（数据）、audio.js（氛围音）
 * ------------------------------------------------------------
 * 设计铁律：用户的选择 = 模拟；事实卡 = 历史；两者不混。
 * 全程无“正确 / 错误”判定。
 * ============================================================ */
(function () {
  "use strict";

  var SCENES = ["prologue", "obstacles", "xianghe", "turning", "sixty", "stars"];
  var PHASE_MAP = {
    prologue: "prologue",
    obstacles: "paper",
    xianghe: "map",
    turning: "map",
    sixty: "dark",
    stars: "space"
  };
  /* 路线推进比例（占位视觉，非精确里程） */
  var ROUTE_PROG = {
    prologue: 0.06,
    obstacles: 0.09,
    xianghe: 0.25,
    turning: 0.25, /* 进入转折幕时路线停在湘江位置；玩家选择后推进至 0.45（遵义） */
    sixty: null,   /* 60 秒内由 JS 驱动 0.45 -> 1.0 */
    stars: 1.0
  };

  var current = 0;
  var routeEl = null;
  var routeLen = 0;
  var mapEl = null;

  /* 行囊状态 */
  var selected = {};
  var selectedCount = 0;
  var lastAddedId = null;  /* 最近放入的物品，用于 chip 落入反馈（渲染后即清空） */
  var lastPickedId = null; /* 最后放入行囊的物品（持久，供后续幕“行囊回声”使用） */

  /* 湘江沉浸式场景状态 */
  var xhTimeStep = 0;        /* 时间线步数 0-3（0 = 未开始） */
  var xhTerrainOn = false;   /* 地形放大 */
  var xhMaterialsOn = false; /* 史料图版 */
  var xhPeopleOn = false;    /* 人物图版 */
  var xhClimaxDone = false;  /* 高潮已触发 */
  var xhDecoded = false;     /* 史实已解码 */
  var xhTimers = [];         /* 本场景定时器 */
  var xhClimaxTimer = null;  /* 高潮显示定时器（模块被取消时可撤回） */
  var xhSacrificeTimer = null; /* 牺牲瞬间低沉重击定时器 */
  var xhRouteEl = null;      /* 场景专属行军路线 */
  var xhRouteLen = 0;
  var xhTipArrowEl = null;   /* 路线前端箭头（随绘制进度移动） */
  var convergePlayed = false; /* 光线汇聚每次游玩只播一次 */
  var convergeTimer = null;
  var xhHintDismissed = false; /* 湘江首次提示已点掉（每次打开页面只提示一次） */

  /* 转折：玩家已选方向（null = 未选） */
  var turningChosen = null;
  var turningTimeouts = [];  /* 转折揭示定时器 */
  var znRouteEl = null;      /* 转折场景专属路线（湘江 → 遵义） */
  var znRouteLen = 0;

  /* 60 秒 · 历史现场 */
  var sixtyRaf = null;
  var sixtyStart = 0;
  var sixtyDone = false;
  var sixtyTimeouts = [];
  var sixtySayTimer = null; /* 反馈句淡入定时器（可重选时清掉上一条，避免竞态） */
  var sixtyHintDismissed = false; /* 30秒首次提示已点掉（每次打开页面只提示一次） */

  /* 90年后 状态机（S0 时空转场 → S1 问题+选择 → S2 一个词(必填) → S3 收束） */
  var starsTimeouts = [];
  var starsState = "s0";        /* 当前状态 s0/s1/s2/s3 */
  var starsChosen = null;       /* 已选方向 id（null = 未选） */
  var starsRouteEl = null;      /* #stars-route */
  var starsHistEl = null;       /* 历史路线 #sr-hist */
  var starsHistLen = 0;
  var starsFutures = {};        /* { id: { path, star, len } } */
  var starsRaf = null;          /* 数据流粒子 rAF */
  var starsConvergeRaf = null;  /* 收束光点 rAF */
  var starsParticles = [];      /* 粒子元素 */

  /* ---------- 工具 ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }

  /* ---------- 初始化 ---------- */
  function init() {
    routeEl = $("#route");
    mapEl = $(".bg-map");
    if (routeEl && routeEl.getTotalLength) {
      routeLen = routeEl.getTotalLength();
      routeEl.style.strokeDasharray = routeLen;
      routeEl.style.strokeDashoffset = routeLen * (1 - ROUTE_PROG.prologue);
    }

    /* 湘江场景专属行军路线（初始只显示出发段） */
    xhRouteEl = $("#xh-route");
    xhTipArrowEl = $("#xh-tip-arrow");
    if (xhRouteEl && xhRouteEl.getTotalLength) {
      xhRouteLen = xhRouteEl.getTotalLength();
      xhRouteEl.style.strokeDasharray = xhRouteLen;
      xhRouteEl.style.strokeDashoffset = xhRouteLen * (1 - XH_ROUTE_PROG[0]);
      xhUpdateTipArrow(XH_ROUTE_PROG[0]);
    }

    /* 转折场景专属路线（初始完全隐藏，选择后推进） */
    znRouteEl = $("#zn-route");
    if (znRouteEl && znRouteEl.getTotalLength) {
      znRouteLen = znRouteEl.getTotalLength();
      znRouteEl.style.strokeDasharray = znRouteLen;
      znRouteEl.style.strokeDashoffset = znRouteLen;
    }

    buildStarsField();
    buildObstacles();
    buildXianghe();
    buildTurning();
    buildStarsRoute();
    buildStarsLines();
    buildSources();
    bindNav();

    /* 预缓冲牺牲场景配乐：页面加载即 load()，提前暴露加载错误、高潮时秒播 */
    if (window.AudioAmbient && window.AudioAmbient.preloadBGM) window.AudioAmbient.preloadBGM();

    showScene(0);
  }

  /* ---------- 背景：随机星点 ---------- */
  function buildStarsField() {
    var dot = $(".star-dot");
    if (!dot) return;
    var shadows = [];
    for (var i = 0; i < 90; i++) {
      var x = (Math.random() * 100).toFixed(2);
      var y = (Math.random() * 100).toFixed(2);
      var r = (Math.random() * 1.4 + 0.3).toFixed(2);
      var o = (Math.random() * 0.6 + 0.25).toFixed(2);
      shadows.push(x + "vw " + y + "vh " + r + "px rgba(255,255,255," + o + ")");
    }
    dot.style.boxShadow = shadows.join(",");
  }

  /* ---------- 页面2 行囊 ---------- */
  function buildObstacles() {
    $("#obstacles-title").textContent = CONTENT.obstacles.title;
    $("#obstacles-hint").textContent = CONTENT.obstacles.hint;
    $("#pack-label").textContent = CONTENT.obstacles.packLabel;
    $("#obstacles-full-0").textContent = CONTENT.obstacles.full[0];
    $("#obstacles-full-1").textContent = CONTENT.obstacles.full[1];
    $("#obstacles-full-2").textContent = CONTENT.obstacles.full[2];
    $("#obstacles-simnote").textContent = CONTENT.obstacles.simNote;

    var pack = $("#pack");
    var wrap = $("#cards");
    wrap.innerHTML = "";
    CONTENT.obstacles.cards.forEach(function (c) {
      var el = document.createElement("button");
      el.className = "card";
      el.type = "button";
      el.dataset.id = c.id;
      el.setAttribute("draggable", "true");
      el.innerHTML = '<span class="card-label"></span><span class="card-desc"></span>';
      el.querySelector(".card-label").textContent = c.label;
      el.querySelector(".card-desc").textContent = c.desc;
      el.addEventListener("click", function () { toggleItem(c.id); });
      /* 拖拽反馈：拖起时卡片缩小半透明，行囊开始呼吸（装满 3 件后不再提示可放入） */
      el.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", c.id);
        e.dataTransfer.effectAllowed = "move";
        el.classList.add("dragging");
        if (selectedCount < 3) pack.classList.add("drag-breathing");
      });
      el.addEventListener("dragend", function () {
        el.classList.remove("dragging");
        pack.classList.remove("drag-breathing");
        pack.classList.remove("drag-over");
      });
      wrap.appendChild(el);
    });

    /* 拖拽放入行囊（桌面增强；移动端用点击） */
    pack.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      pack.classList.add("drag-over");
    });
    pack.addEventListener("dragleave", function (e) {
      if (!e.relatedTarget || !pack.contains(e.relatedTarget)) {
        pack.classList.remove("drag-over");
      }
    });
    pack.addEventListener("drop", function (e) {
      e.preventDefault();
      pack.classList.remove("drag-over");
      var id = e.dataTransfer.getData("text/plain");
      if (id) addToPack(id);
    });

    updatePack();
  }

  var packShakeTimer = null;

  function toggleItem(id) {
    if (selected[id]) {
      delete selected[id];
      selectedCount--;
      hidePackFullHint();
    } else {
      if (selectedCount >= 3) {
        showPackFullHint(); /* 第 4 件：抖动 + 提示，可点已选替换 */
        return;
      }
      selected[id] = true;
      selectedCount++;
      lastAddedId = id;
      lastPickedId = id;
      hidePackFullHint();
    }
    updatePack();
  }

  function addToPack(id) {
    if (selected[id] || selectedCount >= 3) return;
    selected[id] = true;
    selectedCount++;
    lastAddedId = id;
    lastPickedId = id;
    hidePackFullHint();
    updatePack();
  }

  /* 第 4 件反馈：行囊抖动 + 一行提示（体验式，不评判） */
  function showPackFullHint() {
    var hint = $("#pack-fullhint");
    if (hint) {
      hint.textContent = CONTENT.obstacles.fullHint;
      hint.hidden = false;
      hint.classList.remove("show");
      void hint.offsetWidth;
      hint.classList.add("show");
    }
    var pack = $("#pack");
    pack.classList.remove("shake");
    void pack.offsetWidth;
    pack.classList.add("shake");
    if (packShakeTimer) clearTimeout(packShakeTimer);
    packShakeTimer = setTimeout(function () {
      pack.classList.remove("shake");
      packShakeTimer = null;
    }, 500);
  }

  function hidePackFullHint() {
    var hint = $("#pack-fullhint");
    if (hint) hint.hidden = true;
  }

  function updatePack() {
    $("#pack-cap").textContent = selectedCount + "/3";
    var items = $("#pack-items");
    items.innerHTML = "";
    var labels = [];
    CONTENT.obstacles.cards.forEach(function (c) {
      if (selected[c.id]) {
        var chip = document.createElement("span");
        chip.className = "pack-chip" + (c.id === lastAddedId ? " pop" : "");
        chip.textContent = c.label;
        items.appendChild(chip);
        labels.push(c.label);
      }
    });
    lastAddedId = null;
    $$("#cards .card").forEach(function (el) {
      el.classList.toggle("selected", !!selected[el.dataset.id]);
    });
    /* 选满 3 件：显示“你的行囊”状态行 */
    var status = $("#pack-status");
    if (status) {
      if (selectedCount >= 3) {
        status.textContent = CONTENT.obstacles.packStateLabel + "：" + labels.join(" · ");
        status.hidden = false;
      } else {
        status.hidden = true;
      }
    }
    /* 装满 3 件才出现“取舍”提示与按钮 */
    $("#obstacles-result").hidden = selectedCount < 3;
  }

  /* ---------- 页面3 湘江（沉浸式历史场景） ---------- */
  /* 路线进度：初始 + 时间线 3 步（示意视觉，非精确里程） */
  var XH_ROUTE_PROG = [0.12, 0.45, 0.78, 1.0];
  /* 当前路线进度：由 rAF 逐帧更新，线段与箭头共用同一 p，保证严格同步 */
  var xhRouteProg = XH_ROUTE_PROG[0];
  /* 行军动画句柄：新动画/重置时先取消旧循环，防止两个 rAF 打架 */
  var xhMarchRaf = 0;

  function buildXianghe() {
    $("#xianghe-date").textContent = CONTENT.xianghe.date;
    $("#xianghe-node").textContent = CONTENT.xianghe.node;
    $("#xianghe-hint").textContent = CONTENT.xianghe.sceneHint;
    $("#xh-maphint").textContent = CONTENT.xianghe.mapHint;

    var wrap = $("#xh-modules");
    wrap.innerHTML = "";
    CONTENT.xianghe.modules.forEach(function (m) {
      var el = document.createElement("button");
      el.className = "xh-module";
      el.type = "button";
      el.dataset.id = m.id;
      el.innerHTML = '<span class="m-label"></span><span class="m-hint"></span>';
      el.querySelector(".m-label").textContent = m.label;
      el.querySelector(".m-hint").textContent = m.hint;
      el.addEventListener("click", function () { xhModule(m.id, el); });
      wrap.appendChild(el);
    });

    /* 行军点初始定位：路线 0.12 处（与初始路线进度一致），先隐藏 */
    xhMarcherReset();

    resetXianghe();
  }

  /* 湘江场景完整重置（初始化与重玩时调用） */
  function resetXianghe() {
    xhTimeStep = 0;
    xhTerrainOn = false;
    xhMaterialsOn = false;
    xhPeopleOn = false;
    xhClimaxDone = false;
    xhDecoded = false;
    xhTimers.forEach(clearTimeout);
    xhTimers = [];
    xhClimaxTimer = null;
    convergePlayed = false; /* 重置合围光线播放标志 */
    if (xhSacrificeTimer) { clearTimeout(xhSacrificeTimer); xhSacrificeTimer = null; }
    if (window.AudioAmbient && window.AudioAmbient.stopBGM) window.AudioAmbient.stopBGM(); /* 重置时配乐淡出 */

    var wrap = $("#xh-map-wrap");
    if (wrap) wrap.classList.remove("zoom", "shake", "climax");
    if (xhRouteEl && xhRouteLen) {
      setXhRoute(XH_ROUTE_PROG[0]);
    }
    $$(".xh-ford").forEach(function (f) { f.classList.remove("lit"); });
    var bridges = $("#xh-bridges");
    if (bridges) bridges.classList.remove("build");
    xhMarcherReset();
    xhUnitsReset();
    var m34 = $("#xh-34");
    if (m34) m34.classList.remove("flash");
    $("#xh-date").textContent = "逼近湘江";
    $("#xh-caption").textContent = "";
    $$("#xh-modules .xh-module").forEach(function (m) {
      m.classList.remove("lit");
      if (m.dataset.id === "timeline") {
        var h = m.querySelector(".m-hint");
        if (h) h.textContent = CONTENT.xianghe.modules[0].hint;
      }
    });
    $("#xh-lit").textContent = "0";
    var prog = $("#xh-progress");
    if (prog) prog.classList.add("is-empty");
    var phint = $("#xh-progress-hint");
    if (phint) phint.textContent = "还需点亮 4 个，集齐进入下一步";
    $("#xh-plate").hidden = true;
    $("#xh-climax").hidden = true;
    var xhEcho = $("#xh-pack-echo");
    if (xhEcho) {
      xhEcho.hidden = true;
      $$(".pack-echo-line", xhEcho).forEach(function (l) { l.textContent = ""; l.hidden = true; });
    }
    $("#decode").hidden = true;
    $("#xianghe-facts").innerHTML = "";
    $("#xianghe-date-note").textContent = "";
    if (mapEl) mapEl.classList.remove("map-decode");
  }

  /* 模块分发：每次点击都产生地图 / 图版上的可见变化 */
  /* 首次进入提示：淡入 + 呼吸，点任一模块后淡出（每次打开页面只提示一次） */
  function xhShowFirstHint() {
    var hint = $("#xh-firsthint");
    if (!hint) return;
    hint.hidden = false;
    void hint.offsetWidth; /* 强制重排，确保 opacity 0→1 过渡可见 */
    hint.classList.add("show");
  }
  function xhDismissFirstHint() {
    var hint = $("#xh-firsthint");
    if (!hint) return;
    hint.classList.remove("show");
    setTimeout(function () { hint.hidden = true; }, 650);
  }

  function xhModule(id, el) {
    if (!xhHintDismissed) { xhHintDismissed = true; xhDismissFirstHint(); }
    if (id === "timeline") xhTimeline(el);
    else if (id === "terrain") xhTerrain(el);
    else if (id === "materials") xhMaterials(el);
    else if (id === "people") xhPeople(el);
  }

  /* 字幕回落：某模块被取消后，回退到其余仍激活模块的说明 */
  function xhFallbackCaption() {
    if (xhTerrainOn) return CONTENT.xianghe.terrain.caption;
    if (xhTimeStep > 0) return CONTENT.xianghe.timeline[xhTimeStep - 1].caption;
    return "";
  }

  /* 时间线：每点一次，路线推进一步 + 日期同步 + 行军点沿路线行进；
     第 2 步起 5 座渡口点亮、5 座浮桥逐座搭起；
     按钮提示随进度变化（不知道要点多次 → 提示；走完 → 提示可重置）；
     走完后再次点击 = 取消重置，可重新行军 */
  function xhTimeline(el) {
    var hint = el.querySelector(".m-hint");
    var total = CONTENT.xianghe.timeline.length;
    if (xhTimeStep >= total) {
      /* 取消：重置回初始状态 */
      xhTimeStep = 0;
      setXhRoute(XH_ROUTE_PROG[0]);
      xhMarcherReset();
      $("#xh-date").textContent = "逼近湘江";
      $("#xh-caption").textContent = xhFallbackCaption();
      $$(".xh-ford").forEach(function (f) { f.classList.remove("lit"); });
      var br = $("#xh-bridges");
      if (br) br.classList.remove("build");
      xhUnitsReset();
      el.classList.remove("lit");
      if (hint) hint.textContent = CONTENT.xianghe.modules[0].hint;
      xhUpdateProgress();
      return;
    }
    xhTimeStep++;
    var step = CONTENT.xianghe.timeline[xhTimeStep - 1];
    /* 线段/箭头/行军点全部由 xhMarch 用同一 rAF 从当前进度推进到新目标 */
    xhMarch(XH_ROUTE_PROG[xhTimeStep]);
    $("#xh-date").textContent = "1934 · " + step.date;
    $("#xh-caption").textContent = step.caption;
    if (xhTimeStep >= 2) {
      $$(".xh-ford").forEach(function (f) { f.classList.add("lit"); });
      var bridges = $("#xh-bridges");
      if (bridges) bridges.classList.add("build");
      xhShowCorps(); /* 红一、红三军团先头抢渡 → 河对岸出现图标 */
    }
    if (xhTimeStep === total) {
      xhShow34(); /* 主力渡江完成、后卫被阻 → 河这边出现三十四师 */
      el.classList.add("lit");
      if (hint) hint.textContent = total + "/" + total + " 行军完成 · 再点重置";
    } else if (hint) {
      hint.textContent = xhTimeStep + "/" + total + " · 再点继续";
    }
    xhUpdateProgress();
  }

  /* 把路线前端箭头定位到进度 p，并沿路径切线转向 */
  function xhUpdateTipArrow(p) {
    if (!xhTipArrowEl || !xhRouteEl || !xhRouteLen) return;
    var len = xhRouteLen;
    var pt = xhRouteEl.getPointAtLength(len * p);
    var eps = len * 0.002;
    var pBefore = Math.max(0, len * p - eps);
    var pAfter = Math.min(len, len * p + eps);
    var pRef = (pAfter > len * p) ? pAfter : pBefore;
    var ptRef = xhRouteEl.getPointAtLength(pRef);
    var ang = Math.atan2(ptRef.y - pt.y, ptRef.x - pt.x) * 180 / Math.PI;
    xhTipArrowEl.setAttribute("transform", "translate(" + pt.x + "," + pt.y + ") rotate(" + ang + ")");
  }

  /* 行军点+线段+箭头沿路线推进：三者由同一 rAF 用同一 p 值驱动，物理上不会脱节 */
  function xhMarch(toP) {
    var dot = $("#xh-marcher");
    if (!dot || !xhRouteEl || !xhRouteLen) return;
    if (xhMarchRaf) { cancelAnimationFrame(xhMarchRaf); xhMarchRaf = 0; }
    var reduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setXhRoute(toP);
      var pt0 = xhRouteEl.getPointAtLength(xhRouteLen * toP);
      dot.setAttribute("cx", pt0.x);
      dot.setAttribute("cy", pt0.y);
      dot.classList.add("on");
      xhUpdateTipArrow(toP);
      return;
    }
    dot.classList.add("on");
    var fromP = xhRouteProg;
    var start = performance.now();
    var dur = 1600;
    function frame(now) {
      var t = Math.min(1, (now - start) / dur);
      var e = 1 - Math.pow(1 - t, 3);
      var p = fromP + (toP - fromP) * e;
      xhRouteEl.style.transition = "none";
      xhRouteEl.style.strokeDashoffset = String(xhRouteLen * (1 - p));
      xhRouteProg = p;
      var pt = xhRouteEl.getPointAtLength(xhRouteLen * p);
      dot.setAttribute("cx", pt.x);
      dot.setAttribute("cy", pt.y);
      xhUpdateTipArrow(p);
      if (t < 1) xhMarchRaf = requestAnimationFrame(frame);
      else { xhRouteProg = toP; xhMarchRaf = 0; }
    }
    xhMarchRaf = requestAnimationFrame(frame);
  }

  /* 行军点复位：回到路线 0.12 处并隐藏（先停掉进行中的行军动画） */
  function xhMarcherReset() {
    if (xhMarchRaf) { cancelAnimationFrame(xhMarchRaf); xhMarchRaf = 0; }
    var dot = $("#xh-marcher");
    if (dot) dot.classList.remove("on");
    if (xhRouteEl && xhRouteLen) {
      var pt = xhRouteEl.getPointAtLength(xhRouteLen * XH_ROUTE_PROG[0]);
      if (dot) {
        dot.setAttribute("cx", pt.x);
        dot.setAttribute("cy", pt.y);
      }
      xhUpdateTipArrow(XH_ROUTE_PROG[0]);
    }
  }

  /* 部队图标随剧情出现：红一·三军团（第 2 步，河对岸）/ 三十四师（第 3 步，河这边）；
     高潮时强制可见（合围光线必须有目标）；时间线取消或重置时收回 */
  function xhShowCorps() {
    var g = $("#xh-corps");
    if (g) g.classList.add("on");
  }
  function xhShow34() {
    var g = $("#xh-34");
    if (g) g.classList.add("on");
  }
  function xhUnitsReset() {
    var c = $("#xh-corps");
    if (c) c.classList.remove("on");
    var m = $("#xh-34");
    if (m) m.classList.remove("on");
  }

  /* 地形：地图放大 + 行军方向箭头 + 阻击位置说明；再点一次取消放大 */
  function xhTerrain(el) {
    xhTerrainOn = !xhTerrainOn;
    el.classList.toggle("lit", xhTerrainOn);
    $("#xh-map-wrap").classList.toggle("zoom", xhTerrainOn);
    $("#xh-caption").textContent = xhTerrainOn
      ? CONTENT.xianghe.terrain.caption
      : xhFallbackCaption();
    xhUpdateProgress();
  }

  /* 史料：大幅图版 + 简短说明（AI 艺术再现，非历史照片）；再点一次隐藏图版 */
  function xhMaterials(el) {
    xhMaterialsOn = !xhMaterialsOn;
    el.classList.toggle("lit", xhMaterialsOn);
    if (xhMaterialsOn) {
      var d = CONTENT.xianghe.materials;
      xhPlate(d.img, d.title, d.caption, d.source);
    } else {
      xhHidePlate();
    }
    xhUpdateProgress();
  }

  /* 人物：第三十四师（文案取自已核验 xh-d4）；再点一次隐藏图版 */
  function xhPeople(el) {
    xhPeopleOn = !xhPeopleOn;
    el.classList.toggle("lit", xhPeopleOn);
    if (xhPeopleOn) {
      var d = CONTENT.xianghe.people;
      xhPlate(d.img, d.title, d.caption, d.source);
    } else {
      xhHidePlate();
    }
    xhUpdateProgress();
  }

  function xhHidePlate() {
    var plate = $("#xh-plate");
    plate.hidden = true;
    plate.classList.remove("show");
  }

  /* 大幅图版：图 + 标题 + 说明 + 来源 + 诚实标注；
     加载中隐藏图片本体（避免破图标闪现）；
     加载失败时降级为档案式占位（不显示破图标） */
  function xhPlate(img, title, caption, source) {
    var plate = $("#xh-plate");
    var imgEl = $("#xh-plate-img");
    var note = $("#xh-plate-note");
    var ok = function () {
      plate.classList.remove("no-img");
      imgEl.classList.remove("loading");
      note.textContent = "艺术再现（AI 生成），非历史照片";
    };
    var fail = function () {
      plate.classList.add("no-img");
      imgEl.classList.remove("loading");
      note.textContent = "图片生成中，此版为史料占位";
    };
    imgEl.classList.add("loading"); /* 加载中先隐藏，onload/onerror 后再显示 */
    imgEl.onerror = fail;
    imgEl.onload = ok;
    imgEl.src = img;
    imgEl.alt = title;
    /* 同步兜底：同一 src 重复设置时浏览器可能不再触发事件 */
    if (imgEl.complete && imgEl.naturalWidth > 0) ok();
    else if (imgEl.complete) fail();
    $("#xh-plate-title").textContent = title;
    $("#xh-plate-cap").textContent = caption;
    $("#xh-plate-src").textContent = "来源：" + source;
    plate.hidden = false;
    plate.classList.remove("show");
    void plate.offsetWidth;
    plate.classList.add("show");
    var reduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    plate.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }

  function setXhRoute(p) {
    if (!xhRouteEl || !xhRouteLen) return;
    /* 不再走 CSS 过渡（与 rAF 缓动曲线不一致会导致线段和箭头错位），由 xhMarch 逐帧驱动 */
    xhRouteEl.style.transition = "none";
    xhRouteEl.style.strokeDashoffset = String(xhRouteLen * (1 - p));
    xhRouteProg = p;
  }

  /* 模块进度：时间线走完 3 步计 1 个模块；4 个模块全亮触发高潮；
     任一模块被取消则撤回高潮（已解码后保留解码区） */
  function xhUpdateProgress() {
    var n = (xhTimeStep >= CONTENT.xianghe.timeline.length ? 1 : 0) +
      (xhTerrainOn ? 1 : 0) +
      (xhMaterialsOn ? 1 : 0) +
      (xhPeopleOn ? 1 : 0);
    $("#xh-lit").textContent = String(n);
    /* 动态提示：明确"还需点亮几个"，0 个时变红加粗引导第一步 */
    var prog = $("#xh-progress");
    var phint = $("#xh-progress-hint");
    if (prog) prog.classList.toggle("is-empty", n === 0);
    if (phint) phint.textContent = n >= 4 ? "全部点亮，进入高潮" : "还需点亮 " + (4 - n) + " 个，集齐进入下一步";
    if (n >= 4) {
      if (!xhClimaxDone) {
        xhClimax();
      } else if (!xhDecoded) {
        /* 取消后重新点亮：直接显示高潮框并重放闪红反馈（配乐已随取消淡出，此处重新淡入） */
        $("#xh-climax").hidden = false;
        if (window.AudioAmbient) window.AudioAmbient.startBGM();
        xhReplayClimaxFx();
      }
    } else {
      if (xhClimaxTimer) {
        clearTimeout(xhClimaxTimer);
        xhClimaxTimer = null;
        xhClimaxDone = false; /* 序列未完成：允许重新触发 */
      }
      convergePlayed = false; /* 撤回高潮时重置：再次点亮 4 模块可重放合围光线 */
      xhRemoveClimaxAtmos(); /* 暗角消退 + 停牺牲音 */
      if (!xhDecoded) $("#xh-climax").hidden = true;
    }
  }

  /* 行囊回声（模拟层，非史实）：两行呼应——
     ① 带走的：最后放入行囊的那一件；② 留下的：4 件中没选的那一件 */
  function leftBehindId() {
    if (selectedCount < 3) return null;
    for (var i = 0; i < CONTENT.obstacles.cards.length; i++) {
      var id = CONTENT.obstacles.cards[i].id;
      if (!selected[id]) return id;
    }
    return null;
  }

  function showPackEcho(elId, scene) {
    var box = document.getElementById(elId);
    if (!box) return;
    var map = (CONTENT.packEcho && CONTENT.packEcho[scene]) || {};
    var lines = $$(".pack-echo-line", box);
    var brought = lastPickedId ? (map[lastPickedId] || "") : "";
    var leftId = leftBehindId();
    var left = leftId && map.left ? (map.left[leftId] || "") : "";
    if (lines[0]) { lines[0].textContent = brought; lines[0].hidden = !brought; }
    if (lines[1]) { lines[1].textContent = left; lines[1].hidden = !left; }
    box.hidden = !(brought || left);
  }

  /* 高潮：三十四师标记闪红 + 地图抖动 + 背景光线汇聚 + 两行文案（900ms 后显示框） */
  function xhClimax() {
    xhReplayClimaxFx();
    if (window.AudioAmbient) window.AudioAmbient.startBGM(); /* 配乐在点满 4 模块瞬间开始淡入（2.5s），合围光线汇聚期间音乐建立起来，用户能清楚听到 */
    xhClimaxTimer = setTimeout(function () {
      xhClimaxTimer = null;
      xhClimaxDone = true;
      /* 牺牲时刻：英雄牺牲图 + 史实推送（陈树湘断肠明志，已核验 xh-d6） */
      $("#climax-img").src = CONTENT.xianghe.sacrifice.img;
      $("#climax-img-note").textContent = CONTENT.xianghe.sacrifice.imgNote;
      $("#climax-fact").textContent = CONTENT.xianghe.sacrifice.fact;
      $("#climax-0").textContent = CONTENT.xianghe.climax[0];
      $("#climax-1").textContent = CONTENT.xianghe.climax[1];
      showPackEcho("xh-pack-echo", "xianghe");
      $("#xh-climax").hidden = false;
    }, 2600); /* 等合围光线汇聚(2.1s)+牺牲重击(2s)完成后再出文字，让"心头一震"先落地 */
    xhTimers.push(xhClimaxTimer);
  }

  function xhReplayClimaxFx() {
    /* 高潮时三十四师（及河对岸主力）必须可见，否则合围光线没有目标 */
    xhShow34();
    xhShowCorps();
    var m34 = $("#xh-34");
    if (m34) {
      m34.classList.remove("flash");
      void m34.offsetWidth;
      m34.classList.add("flash");
    }
    var wrap = $("#xh-map-wrap");
    if (wrap) {
      wrap.classList.add("climax"); /* 暗角压暗（牺牲氛围，聚焦三十四师） */
      wrap.classList.remove("shake");
      void wrap.offsetWidth;
      wrap.classList.add("shake");
    }
    playConverge();
    /* 牺牲瞬间（光线汇聚完成 ~2s）：低沉重击，"心头一震"（配乐已在 0s 淡入） */
    if (xhSacrificeTimer) clearTimeout(xhSacrificeTimer);
    xhSacrificeTimer = setTimeout(function () {
      xhSacrificeTimer = null;
      if (window.AudioAmbient && !window.AudioAmbient.isMuted()) window.AudioAmbient.playSacrifice();
    }, 2000);
  }

  /* 撤回高潮氛围：暗角消退 + 停牺牲音 +（默认）停配乐。
     keepBGM=true 时保留配乐（用于“进入解码”：音乐继续托住情绪，直到离场才停） */
  function xhRemoveClimaxAtmos(keepBGM) {
    var wrap = $("#xh-map-wrap");
    if (wrap) wrap.classList.remove("climax");
    if (xhSacrificeTimer) { clearTimeout(xhSacrificeTimer); xhSacrificeTimer = null; }
    if (!keepBGM && window.AudioAmbient) window.AudioAmbient.stopBGM(); /* 配乐淡出 */
  }

  /* 高潮动效：湘江场景地图上，阻击线从新圩·光华铺 / 脚山铺 / 渡口 / 两侧封锁线
     向三十四师汇聚（约 2 秒，不遮挡、不拦截点击）——“围堵合围后卫”的可视化。
     弱设备 / 降低动态偏好时跳过动效，不改变交互逻辑。 */
  function playConverge() {
    var g = $("#xh-converge");
    if (!g || convergePlayed) return;
    var reduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    convergePlayed = true;
    g.classList.remove("play");
    void g.getBoundingClientRect(); /* 强制重排，确保动画可重播 */
    g.classList.add("play");
    if (convergeTimer) clearTimeout(convergeTimer);
    convergeTimer = setTimeout(function () {
      g.classList.remove("play");
      convergeTimer = null;
    }, 2100);
  }

  function decodeXianghe() {
    if (xhDecoded) return;
    xhDecoded = true;
    xhRemoveClimaxAtmos(true); /* 进入解码：暗角消退，但配乐继续（直到点“继续”进遵义才停，过渡更自然） */
    /* 7 条史实一次性平铺（xh-1 + xh-d1~d6） */
    renderFacts("#xianghe-facts",
      CONTENT.xianghe.decode.facts.concat(CONTENT.xianghe.decode.detail));
    var note = $("#xianghe-date-note");
    if (note) note.textContent = CONTENT.xianghe.dateNote || "";
    $("#xh-climax").hidden = true;
    $("#decode").hidden = false;
    if (mapEl) mapEl.classList.add("map-decode");
    var reduced = window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("#decode").scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }

  /* ---------- 页面4 转折（先判断，再揭示历史） ---------- */
  function buildTurning() {
    $("#turning-date").textContent = CONTENT.turning.date;
    $("#turning-title").textContent = CONTENT.turning.title;
    $("#turning-question").textContent = CONTENT.turning.question;
    $("#zn-maphint").textContent = CONTENT.turning.mapHintBefore;
    turningChosen = null;
    turningTimeouts.forEach(clearTimeout);
    turningTimeouts = [];
    resetZnMap();
    renderTurningOptions();
  }

  /* 场景专属地图重置：路线收回、遵义熄灭、方向标记隐藏、回声隐藏 */
  function resetZnMap() {
    if (znRouteEl && znRouteLen) {
      znRouteEl.style.transition = "none";
      znRouteEl.style.strokeDashoffset = String(znRouteLen);
    }
    var zn = $("#zn-node-zn");
    if (zn) zn.classList.remove("lit");
    var wrap = $("#zn-map-wrap");
    if (wrap) wrap.classList.remove("arrived");
    $$("#zn-map .zm").forEach(function (m) { m.classList.remove("show"); });
    var echo = $("#turning-pack-echo");
    if (echo) {
      echo.hidden = true;
      $$(".pack-echo-line", echo).forEach(function (l) { l.textContent = ""; l.hidden = true; });
    }
  }

  function renderTurningOptions() {
    var wrap = $("#turning-options");
    wrap.innerHTML = "";
    var keys = ["A", "B", "C"];
    CONTENT.turning.options.forEach(function (o, idx) {
      var el = document.createElement("button");
      el.className = "option";
      el.type = "button";
      el.dataset.id = o.id;
      el.innerHTML = '<span class="option-key"></span><span class="option-text"><b></b><small></small></span>';
      el.querySelector(".option-key").textContent = keys[idx];
      el.querySelector(".option-text b").textContent = o.label;
      el.querySelector(".option-text small").textContent = o.desc;
      el.addEventListener("click", function () { chooseTurning(o.id, el); });
      wrap.appendChild(el);
    });
    $("#turning-hint").textContent = CONTENT.turning.hintBefore;
    $("#turning-feedback").hidden = true;
    $("#turning-chosen").hidden = true;
    $("#turning-reveal").hidden = true;
    $("#turning-reveal-ans").hidden = true;
    $("#turning-facts").hidden = true;
    $("#btn-turning-next").hidden = true;
    /* 场景地图状态重置：遵义节点熄灭、方向标记隐藏 */
    resetZnMap();
  }

  /* 玩家选择“首先会考虑什么”——不评判对错，且可换选（参与感）。
     每个方向都有独立反馈：① 即时反馈文案（呼应“重新判断方向”）
     ② 该方向专属地图标记（换选时切换）
     ③ 首次选择时路线从湘江推进到遵义（约 2 秒）
     ④ 路线抵达后揭示：固定开场（呼应标题）+ 该方向专属的历史回答（取自已核验 zn-2 / zn-3）
     ⑤ 换选时实时更新“你首先考虑的是…”与历史回答——每个方向，历史都有不同的回答 */
  function chooseTurning(id, el) {
    var firstChoice = !turningChosen;
    turningChosen = id;
    $$("#turning-options .option").forEach(function (o) { o.classList.remove("chosen"); });
    el.classList.add("chosen");

    var opt = null;
    CONTENT.turning.options.forEach(function (o) { if (o.id === id) opt = o; });
    if (!opt) return;

    /* ① 即时反馈文案（每个方向独立，换选即更新） */
    var fb = $("#turning-feedback");
    fb.textContent = opt.feedback;
    fb.hidden = false;
    fb.classList.remove("show");
    void fb.offsetWidth;
    fb.classList.add("show");

    /* ② 该方向专属地图标记（换选时先清旧标记，再显示新标记） */
    $$("#zn-map .zm").forEach(function (m) { m.classList.remove("show"); });
    showZnMarker(id);

    /* ③ 首次选择后，提示可换选（每个方向历史回答不同） */
    $("#turning-hint").textContent = CONTENT.turning.hintAfter;

    if (firstChoice) {
      /* ④ 路线推进（仅首次选择）：背景总路线 湘江(0.25) → 遵义(0.45)；
          场景地图红线从湘江推进到遵义，抵达时遵义节点点亮 */
      setRoute(0.45);
      advanceZnRoute();

      /* ⑤ 路线抵达后，揭示历史走向 + 行囊回声
          （定时器触发时取“当前”选择，防止 2.3 秒内换选导致揭示旧方向） */
      turningTimeouts.push(setTimeout(function () {
        var cur = null;
        CONTENT.turning.options.forEach(function (o) { if (o.id === turningChosen) cur = o; });
        if (!cur) return;
        showTurningReveal(cur, false);
        showPackEcho("turning-pack-echo", "turning");
        renderFacts("#turning-facts", CONTENT.turning.facts);
        $("#turning-facts").hidden = false;
        var btn = $("#btn-turning-next");
        btn.textContent = CONTENT.turning.cta;
        btn.hidden = false;
        $("#zn-maphint").textContent = CONTENT.turning.mapHintAfter;
        if (mapEl) mapEl.classList.add("map-shift");
      }, 2300));
    } else if (!$("#turning-reveal").hidden) {
      /* 换选且揭示已显示：实时更新“你首先考虑的是…”与历史回答（重放淡入） */
      showTurningReveal(opt, true);
    }
  }

  /* 揭示块：固定开场（呼应标题“重新判断方向”）+ 方向专属历史回答；
     retrigger=true 时重放淡入动画（换选反馈） */
  function showTurningReveal(opt, retrigger) {
    var chosen = $("#turning-chosen");
    var reveal = $("#turning-reveal");
    var ans = $("#turning-reveal-ans");
    chosen.textContent = "你首先考虑的是「" + opt.label + "」。" + CONTENT.turning.chosenNote;
    reveal.textContent = CONTENT.turning.reveal;
    ans.textContent = opt.revealAns;
    if (retrigger) {
      chosen.hidden = true;
      reveal.hidden = true;
      ans.hidden = true;
      void reveal.offsetWidth;
    }
    chosen.hidden = false;
    reveal.hidden = false;
    ans.hidden = false;
  }

  /* 每个方向独立的场景地图标记：A=战斗星形 / B=决策圆环 / C=方向箭头（均带文字标签） */
  function showZnMarker(id) {
    var mapId = { how: "zm-battle", who: "zm-decide", where: "zm-direction" }[id];
    var m = document.getElementById(mapId);
    if (m) m.classList.add("show");
  }

  /* 场景地图路线从湘江推进到遵义（2s 过渡），抵达时点亮遵义节点并切换标签 */
  function advanceZnRoute() {
    if (znRouteEl && znRouteLen) {
      znRouteEl.style.transition = "stroke-dashoffset 2s ease";
      znRouteEl.style.strokeDashoffset = "0";
    }
    turningTimeouts.push(setTimeout(function () {
      var zn = $("#zn-node-zn");
      if (zn) zn.classList.add("lit");
      var wrap = $("#zn-map-wrap");
      if (wrap) wrap.classList.add("arrived");
    }, 2000));
  }

  function onTurningNext() {
    next();
  }

  /* ---------- 页面5 60 秒 · 历史现场 ---------- */
  var sixtyChosen = {}; /* 每个情境玩家所选（体验式，不评判） */

  function startSixty() {
    sixtyDone = false;
    sixtyChosen = {};
    clearSixtyTimeouts();
    $("#sixty-timer").textContent = "30";
    var msg = $("#sixty-msg");
    msg.textContent = "";
    msg.classList.remove("show");
    $("#btn-sixty-continue").hidden = true;
    clearSixtyStage();
    clearSixtyEcho();
    hideSixtyEnd();
    /* 首次进入提示（每次打开页面只提示一次，选第一个行动后消失） */
    var fh = $("#sixty-firsthint");
    if (fh) {
      if (!sixtyHintDismissed) {
        fh.hidden = false; void fh.offsetWidth; /* 强制重排，确保 opacity 0→1 过渡可见 */
        fh.classList.add("show");
      } else {
        fh.hidden = true; fh.classList.remove("show");
      }
    }
    /* 恢复体验区占位（finishSixty 里会被收起，避免升华块上方留空） */
    $("#sixty-stage").style.display = "";
    $("#sixty-echo").style.display = "";
    $("#sixty-msg").style.display = "";
    buildSixtyPreview();

    if (window.AudioAmbient) window.AudioAmbient.start();

    var duration = 30;
    var startProg = 0.45;
    var endProg = 1.0;
    sixtyStart = performance.now();

    /* 开场一句，随后按时间点弹出两个“瞬间” */
    saySixty(CONTENT.sixty.intro);
    CONTENT.sixty.situations.forEach(function (s, i) {
      sixtyTimeouts.push(setTimeout(function () {
        showSixtySituation(i);
      }, s.at * 1000));
    });

    function tick(now) {
      var elapsed = (now - sixtyStart) / 1000;
      var remain = Math.max(0, duration - elapsed);
      $("#sixty-timer").textContent = String(Math.ceil(remain));

      if (routeEl && routeLen) {
        var p = startProg + (endProg - startProg) * Math.min(1, elapsed / duration);
        routeEl.style.transition = "none";
        routeEl.style.strokeDashoffset = String(routeLen * (1 - p));
      }

      if (elapsed >= duration) {
        finishSixty();
        return;
      }
      sixtyRaf = requestAnimationFrame(tick);
    }
    sixtyRaf = requestAnimationFrame(tick);
  }

  function saySixty(text) {
    var msg = $("#sixty-msg");
    msg.classList.remove("show");
    if (sixtySayTimer) clearTimeout(sixtySayTimer); /* 可重选：清掉上一条反馈，避免竞态/闪烁 */
    sixtySayTimer = setTimeout(function () {
      msg.textContent = text;
      msg.classList.add("show");
    }, 450);
    sixtyTimeouts.push(sixtySayTimer);
  }

  /* 弹出一个“瞬间”：现场描述 + 3 个行动 */
  function showSixtySituation(i) {
    if (sixtyDone) return;
    var s = CONTENT.sixty.situations[i];
    if (!s) return;
    var msg = $("#sixty-msg");
    msg.classList.remove("show");
    var hint = $("#sixty-hint");
    if (hint) { hint.textContent = ""; hint.classList.remove("show"); } /* 可重选：进入新瞬间时清掉上一瞬间的提示 */
    setSixtyPreviewState(i, "active");
    $("#sixty-moment").textContent = "瞬间 " + (i + 1) + "/2 · " + s.theme;
    clearSixtyEcho();
    $("#sixty-scene").textContent = s.scene;
    var wrap = $("#sixty-options");
    wrap.innerHTML = "";
    var keys = ["A", "B", "C"];
    s.options.forEach(function (o, idx) {
      var el = document.createElement("button");
      el.className = "option";
      el.type = "button";
      el.innerHTML = '<span class="option-key"></span><span class="option-text"><b></b><small></small></span>';
      el.querySelector(".option-key").textContent = keys[idx];
      el.querySelector(".option-text b").textContent = o.label;
      el.querySelector(".option-text small").textContent = o.desc;
      el.addEventListener("click", function () { chooseSixtyOption(i, o.id, el); });
      wrap.appendChild(el);
    });
    $("#sixty-stage").classList.add("show");
  }

  /* 玩家选择行动：可重选（不锁死、不置灰），每选项独立反馈；始终记录最新选择（体验式，不评判） */
  function chooseSixtyOption(i, optionId, el) {
    if (sixtyDone) return;
    if (!sixtyHintDismissed) {
      sixtyHintDismissed = true;
      var fh = $("#sixty-firsthint");
      if (fh) { fh.classList.remove("show"); setTimeout(function () { fh.hidden = true; }, 650); }
    }
    sixtyChosen[i] = optionId;
    var s = CONTENT.sixty.situations[i];
    /* 可重选：只高亮当前选择，其余保持可选（不加 dim/不锁） */
    $$("#sixty-options .option").forEach(function (o) { o.classList.remove("chosen"); });
    el.classList.add("chosen");
    pulseRoute();
    setSixtyPreviewState(i, "done");
    saySixty(s.feedback[optionId] || "");
    showSixtyEcho(s.echo || "");
    /* 提示可换选 */
    var hint = $("#sixty-hint");
    if (hint) { hint.textContent = s.hintAfter || ""; hint.classList.add("show"); }
  }

  function clearSixtyStage() {
    $("#sixty-moment").textContent = "";
    $("#sixty-scene").textContent = "";
    $("#sixty-options").innerHTML = "";
    var hint = $("#sixty-hint");
    if (hint) { hint.textContent = ""; hint.classList.remove("show"); }
    $("#sixty-stage").classList.remove("show");
  }

  /* 路线脉冲：选择后 0.9s 的即时视觉反馈 */
  function pulseRoute() {
    if (!routeEl) return;
    routeEl.classList.remove("pulse");
    void routeEl.getBoundingClientRect();
    routeEl.classList.add("pulse");
    sixtyTimeouts.push(setTimeout(function () {
      routeEl.classList.remove("pulse");
    }, 900));
  }

  function finishSixty() {
    if (sixtyDone) return;
    sixtyDone = true;
    if (sixtyRaf) cancelAnimationFrame(sixtyRaf);
    sixtyRaf = null;
    if (window.AudioAmbient) window.AudioAmbient.stop();
    $("#sixty-timer").textContent = "0";
    clearSixtyStage();
    /* 收起首次提示（用户一个都没选时，提示不能残留在升华块上方） */
    var fh = $("#sixty-firsthint");
    if (fh) { fh.classList.remove("show"); fh.hidden = true; }
    clearSixtyEcho();
    var msg = $("#sixty-msg");
    msg.classList.remove("show");
    $("#sixty-preview").classList.remove("show");
    /* 路线补满 */
    if (routeEl && routeLen) {
      routeEl.style.transition = "stroke-dashoffset 1.5s ease";
      routeEl.style.strokeDashoffset = "0";
    }
    /* 升华块：走完或跳过都必现（跳过时 path 显示“你跳过了”） */
    showSixtyEnd();
    /* 收起体验区元素，避免升华块上方留空 */
    $("#sixty-stage").style.display = "none";
    $("#sixty-echo").style.display = "none";
    $("#sixty-msg").style.display = "none";
  }

  /* 预告：渲染两个瞬间（提示后面有什么 + 兼作进度） */
  function buildSixtyPreview() {
    var wrap = $("#sixty-preview");
    wrap.innerHTML = "";
    var title = document.createElement("p");
    title.className = "sixty-preview-title";
    title.textContent = CONTENT.sixty.previewTitle;
    wrap.appendChild(title);
    var list = document.createElement("div");
    list.className = "sixty-preview-list";
    var nums = ["①", "②"];
    CONTENT.sixty.situations.forEach(function (s, i) {
      var item = document.createElement("div");
      item.className = "preview-item";
      item.setAttribute("data-idx", String(i));
      var num = document.createElement("span");
      num.className = "preview-num";
      num.textContent = nums[i] || "";
      var theme = document.createElement("span");
      theme.className = "preview-theme";
      theme.textContent = s.theme;
      item.appendChild(num);
      item.appendChild(theme);
      list.appendChild(item);
    });
    wrap.appendChild(list);
    /* 重触发淡入 */
    wrap.classList.remove("show");
    void wrap.getBoundingClientRect();
    wrap.classList.add("show");
  }

  /* 预告进度：active=进行中，done=已完成 */
  function setSixtyPreviewState(i, state) {
    var item = $("#sixty-preview .preview-item[data-idx='" + i + "']");
    if (!item) return;
    item.classList.remove("is-active", "is-done");
    if (state) item.classList.add("is-" + state);
  }

  /* 历史回声：选择后浮现，连到本作品已有史实 */
  function showSixtyEcho(text) {
    var echo = $("#sixty-echo");
    if (!text) { clearSixtyEcho(); return; }
    echo.textContent = text;
    echo.classList.add("show");
  }
  function clearSixtyEcho() {
    var echo = $("#sixty-echo");
    echo.textContent = "";
    echo.classList.remove("show");
  }

  /* 升华块：你的路径 + 历史呼应 + 精神句（体验式，不评判对错） */
  function showSixtyEnd() {
    var end = CONTENT.sixty.end;
    var pathEl = $("#sixty-end-path");
    var chosenCount = Object.keys(sixtyChosen).length;
    var historyLine = end.history; /* 默认：未做选择时的兜底句 */
    if (chosenCount === 0) {
      pathEl.textContent = end.pathSkipped;
      pathEl.classList.add("is-skipped");
    } else {
      var parts = [];
      var histParts = [];
      CONTENT.sixty.situations.forEach(function (s, i) {
        var id = sixtyChosen[i];
        if (!id) return;
        for (var j = 0; j < s.options.length; j++) {
          if (s.options[j].id === id) {
            parts.push(s.options[j].label);
            if (s.history && s.history[id]) { histParts.push(s.history[id]); }
            break;
          }
        }
      });
      pathEl.textContent = end.pathTitle + "：" + parts.join("、");
      pathEl.classList.remove("is-skipped");
      /* 历史句按用户实际所选动态组装：不声称"同样的选择"，而是点出每个选择的历史分量（片段自带句尾句号，拼接前去掉，统一用"；""。"收尾，避免"。；""。。"） */
      if (histParts.length === 2) {
        historyLine = "历史里，你的这两个选择，各有各的分量——" + histParts[0].replace(/。$/, "") + "；" + histParts[1].replace(/。$/, "") + "。";
      } else if (histParts.length === 1) {
        historyLine = "历史里，你这个选择，也有它的分量——" + histParts[0].replace(/。$/, "") + "。";
      }
    }
    $("#sixty-end-history").textContent = historyLine;
    $("#sixty-end-spirit").textContent = end.spirit;
    $("#sixty-end-bridge").textContent = end.bridge;
    var endEl = $("#sixty-end");
    endEl.hidden = false;
    /* 重触发淡入 */
    endEl.classList.remove("show");
    void endEl.getBoundingClientRect();
    endEl.classList.add("show");
    sixtyTimeouts.push(setTimeout(function () {
      $("#btn-sixty-continue").hidden = false;
    }, 1400));
  }
  function hideSixtyEnd() {
    var endEl = $("#sixty-end");
    endEl.hidden = true;
    endEl.classList.remove("show");
  }

  function clearSixtyTimeouts() {
    sixtyTimeouts.forEach(clearTimeout);
    sixtyTimeouts = [];
  }

  function stopSixty() {
    if (sixtyRaf) cancelAnimationFrame(sixtyRaf);
    sixtyRaf = null;
    clearSixtyTimeouts();
    if (window.AudioAmbient) window.AudioAmbient.stop();
  }

  /* ---------- 页面6 《从烽火到星辰》：S0 时空转场 → S1 问题+选择 → S2 一个词(必填) → S3 收束 ---------- */

  /* 渲染 S0 的 3 行时空转场文案 */
  function buildStarsLines() {
    var wrap = $("#stars-lines");
    wrap.innerHTML = "";
    CONTENT.stars.lines.forEach(function (l) {
      var el = document.createElement("p");
      el.className = "star-line";
      el.textContent = l;
      wrap.appendChild(el);
    });
  }

  /* 给星球加一颗沿椭圆轨道运行的小卫星（SMIL animateMotion，离线可用；
     与 .sr-star-orbit 同参数 rx58/ry18/rotate(-20)，点亮时才可见） */
  function addStarSatellite(star) {
    if (star.querySelector(".sr-star-sat")) return;
    var dot = star.querySelector(".sr-star-dot");
    if (!dot) return;
    var cx = Number(dot.getAttribute("cx"));
    var cy = Number(dot.getAttribute("cy"));
    var NS = "http://www.w3.org/2000/svg";
    var g = document.createElementNS(NS, "g");
    g.setAttribute("class", "sr-star-sat");
    g.setAttribute("transform", "rotate(-20 " + cx + " " + cy + ")");
    var c = document.createElementNS(NS, "circle");
    c.setAttribute("class", "sr-star-sat-dot");
    c.setAttribute("r", "2.6");
    c.setAttribute("cx", "0");
    c.setAttribute("cy", "0");
    var am = document.createElementNS(NS, "animateMotion");
    am.setAttribute("dur", "8s");
    am.setAttribute("repeatCount", "indefinite");
    am.setAttribute("path",
      "M " + (cx - 58) + "," + cy +
      " A 58,18 0 1,1 " + (cx + 58) + "," + cy +
      " A 58,18 0 1,1 " + (cx - 58) + "," + cy);
    c.appendChild(am);
    g.appendChild(c);
    star.appendChild(g);
  }

  /* 初始化 #stars-route：测量历史/未来路径长度，设置初始描边（历史/未来均先隐藏，进入后推进） */
  function buildStarsRoute() {
    starsRouteEl = $("#stars-route");
    starsHistEl = $("#sr-hist");
    if (starsHistEl && starsHistEl.getTotalLength) {
      starsHistLen = starsHistEl.getTotalLength();
      starsHistEl.style.strokeDasharray = starsHistLen;
      starsHistEl.style.strokeDashoffset = starsHistLen;
    }
    starsFutures = {};
    $$("#stars-route .sr-star").forEach(function (s) {
      var id = s.getAttribute("data-dir");
      var d = s.getAttribute("data-d") || "";
      /* 未来路径不再显示为线条，但保留几何供粒子与收束光点使用 */
      var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", d);
      p.setAttribute("style", "fill:none;stroke:none;pointer-events:none;");
      if (starsRouteEl) starsRouteEl.appendChild(p);
      var len = p.getTotalLength ? p.getTotalLength() : 0;
      starsFutures[id] = { path: p, star: s, len: len };
      /* 每颗星球加一颗沿轨道运行的小卫星（点亮时可见，大气感） */
      addStarSatellite(s);
    });
    /* 记录星球标签原始位置，供重走时复位 */
    Object.keys(starsFutures).forEach(function (id) {
      var star = starsFutures[id].star;
      var label = star.querySelector(".sr-star-label");
      if (label && !label.getAttribute("data-orig-x")) {
        label.setAttribute("data-orig-x", label.getAttribute("x"));
        label.setAttribute("data-orig-y", label.getAttribute("y"));
      }
    });
  }

  /* 重置 90年后 全部状态（进入场景 / 重玩时调用） */
  function resetStars() {
    clearStarsTimeouts();
    stopStarsParticles();
    if (starsConvergeRaf) { cancelAnimationFrame(starsConvergeRaf); starsConvergeRaf = null; }
    starsState = "s0";
    starsChosen = null;

    /* S0 文案 + 提前进入按钮（含淡出态复位） */
    $$("#stars-lines .star-line").forEach(function (el) { el.classList.remove("show", "fade-out"); });
    var skip = $("#btn-stars-skip");
    if (skip) { skip.hidden = true; skip.classList.remove("fade-out"); }

    /* S1 按钮态 + 弹窗关闭态 + 回应层 */
    $$("#stars-options .option").forEach(function (o) { o.classList.remove("chosen", "dim", "show"); });
    var modal = $("#stars-s1");
    if (modal) modal.classList.remove("closing");
    var afterLayer = $("#stars-after-layer");
    if (afterLayer) { afterLayer.hidden = true; afterLayer.classList.remove("show"); }
    var decided = $("#stars-decided");
    if (decided) { decided.hidden = true; decided.classList.remove("show"); }
    var dirResp = $("#stars-dir-response");
    if (dirResp) { dirResp.hidden = true; dirResp.classList.remove("show"); }

    /* 分叉点光晕复位（重走可再次爆发） */
    ["sr-branch", "sr-halo-ring-1", "sr-halo-ring-2", "sr-halo-core"].forEach(function (hid) {
      var h = document.getElementById(hid);
      if (h) h.classList.remove("burst", "burst2");
    });

    /* S2 输入 + 回应 */
    var input = $("#wish-input");
    if (input) input.value = "";
    var resp = $("#wish-response");
    if (resp) { resp.hidden = true; resp.classList.remove("show"); }

    /* S3 收尾窗口 + 按钮 */
    var endCard = $("#stars-end-card");
    if (endCard) endCard.classList.remove("show");
    var finalEl = $("#stars-final");
    if (finalEl) finalEl.classList.remove("show");
    var dimEl = $("#stars-dim");
    if (dimEl) dimEl.classList.remove("show");
    var cta = $("#stars-s3 .stars-cta");
    if (cta) cta.classList.remove("show");

    /* 路线：历史收回、未来收回、星熄灭、锚点/分叉/汇聚复位 */
    if (starsHistEl && starsHistLen) {
      starsHistEl.style.transition = "none";
      starsHistEl.style.strokeDashoffset = String(starsHistLen);
    }
    Object.keys(starsFutures).forEach(function (id) {
      var f = starsFutures[id];
      f.path.style.transition = "none";
      f.path.style.stroke = "none";
      f.path.style.strokeWidth = "";
      f.path.style.filter = "";
      f.path.style.strokeDasharray = "";
      f.path.style.strokeDashoffset = "";
      f.path.classList.remove("lit", "dim");
      f.star.classList.remove("lit", "dim", "is-warm");
      /* 复位星球标签位置与内容 */
      var label = f.star.querySelector(".sr-star-label");
      if (label) {
        label.textContent = f.star.getAttribute("data-label") || "";
        var ox = label.getAttribute("data-orig-x");
        var oy = label.getAttribute("data-orig-y");
        if (ox) label.setAttribute("x", ox);
        if (oy) label.setAttribute("y", oy);
        label.style.cssText = "";
      }
      /* 清除环绕星球的词 + 词轨道 */
      $$(".sr-word", f.star).forEach(function (w) { w.remove(); });
      $$(".sr-word-orbit", f.star).forEach(function (w) { w.remove(); });
    });
    if (starsRouteEl) starsRouteEl.classList.remove("futures-on", "nodes-on");
    var tech = $("#stars-tech-keywords"); if (tech) tech.innerHTML = "";
    var bd = $("#sr-anchor-bd"); if (bd) bd.classList.remove("show");
    var tg = $("#sr-anchor-tg"); if (tg) tg.classList.remove("show");
    var br = $("#sr-branch"); if (br) br.classList.remove("show");
    var cd = $("#sr-converge-dot");
    if (cd) { cd.classList.remove("play"); cd.setAttribute("cx", "80"); cd.setAttribute("cy", "500"); }
    if (starsRouteEl) starsRouteEl.classList.remove("converge");
    if (mapEl) mapEl.classList.remove("space-on", "route-on");
  }

  /* 进入 S0：时空转场（背景数字化 + 3 行文案；路线/锚点/虚线推迟到文字退场后由 enterS1 推进）。
     不自动跳转——三行文案逐行淡入后由用户点"进入 →"进入 S1 弹窗（用户 19:14 要求） */
  function startStars() {
    resetStars();
    /* 填充 S1/S2/S3 文案 */
    $("#stars-question").textContent = CONTENT.stars.question;
    $("#stars-poss-note").textContent = CONTENT.stars.possibilityNote;
    $("#stars-decided").textContent = CONTENT.stars.decided;
    $("#wish-title").textContent = CONTENT.stars.wordTitle;
    $("#wish-input").placeholder = CONTENT.stars.wordPlaceholder;
    $("#btn-wish").textContent = CONTENT.stars.wordBtn;
    $("#wish-hint").textContent = CONTENT.stars.wordHint;
    $("#stars-final").textContent = CONTENT.stars.final;
    renderStarsOptions();

    /* 只显示 S0 */
    showStarsStage("s0");

    var t = [];
    /* 背景数字化（红 → 青白数据粒子） */
    t.push(setTimeout(function () { if (mapEl) mapEl.classList.add("space-on"); }, 200));
    /* 3 行时空转场文案（错峰淡入；S0 只留文字，路线推迟到文字退场后由 enterS1 推进，避免同屏过乱） */
    var lineEls = $$("#stars-lines .star-line");
    t.push(setTimeout(function () { if (lineEls[0]) lineEls[0].classList.add("show"); }, 700));
    t.push(setTimeout(function () { if (lineEls[1]) lineEls[1].classList.add("show"); }, 1700));
    t.push(setTimeout(function () { if (lineEls[2]) lineEls[2].classList.add("show"); }, 2600));
    /* 进入按钮（三行都出现后再给，避免第 3 行被截断；S0 不再自动跳转，由用户点击进入 S1 弹窗） */
    t.push(setTimeout(function () { var s = $("#btn-stars-skip"); if (s) s.hidden = false; }, 3000));
    starsTimeouts = t;
  }

  /* 切换 S0-S3 舞台（同一 scene 内，只显一个） */
  function showStarsStage(state) {
    starsState = state;
    var map = { s0: "#stars-s0", s1: "#stars-s1", s2: "#stars-s2", s3: "#stars-s3" };
    Object.keys(map).forEach(function (k) {
      var el = $(map[k]);
      if (el) el.hidden = (k !== state);
    });
  }

  /* 科技发展关键词：路线抵达"现在"时按时间顺序分 4 组浮现（一次二三个），
     字号从小到大；每组渐入→停留→渐出后接下一组。纯背景浮现，非知识卡 */
  function showTechKeywords() {
    var container = $("#stars-tech-keywords");
    if (!container) return;
    container.innerHTML = "";
    var groups = (CONTENT.stars && CONTENT.stars.techKeywordGroups) || [];
    /* 窄屏（手机/平板竖屏，<960px）：关键词改用 mx/my 居中竖排，
       避免 % 散排在窄屏上互相叠压；字号用 clamp 随视口缩小（375px 屏约 55%），保底 13px */
    var narrow = window.innerWidth < 960;
    var GROUP_GAP = 2200;  /* 组间隔（ms） */
    var IN_STAGGER = 450;  /* 组内逐个渐入的间隔（ms） */
    var IN_DUR = 1800;     /* 单个词渐入时长（ms），与 CSS opacity 过渡一致 */
    var HOLD = 1400;       /* 整组全显后停留（ms） */
    var OUT_STAGGER = 450; /* 组内逐个渐出的间隔（ms） */
    groups.forEach(function (g, gi) {
      var els = [];
      g.items.forEach(function (kw) {
        var el = document.createElement("span");
        el.className = "tech-keyword";
        el.style.left = (narrow && kw.mx != null ? kw.mx : kw.x) + "%";
        el.style.top = (narrow && kw.my != null ? kw.my : kw.y) + "%";
        var minPx = Math.max(13, Math.round(g.size * 0.55));
        var vw = (g.size * 0.55 / 3.75).toFixed(2);
        el.style.fontSize = "clamp(" + minPx + "px, " + vw + "vw, " + g.size + "px)";
        el.textContent = kw.t;
        container.appendChild(el);
        els.push(el);
      });
      var n = els.length;
      var inAt = gi * GROUP_GAP;
      /* 渐入：组内逐个错开，一个接一个浮现（柔和，不整组同弹） */
      els.forEach(function (el, ei) {
        starsTimeouts.push(setTimeout(function () {
          el.classList.add("show");
        }, inAt + ei * IN_STAGGER));
      });
      /* 渐出：整组全显 + 停留后，逐个错开退场 */
      var outStart = inAt + (n - 1) * IN_STAGGER + IN_DUR + HOLD;
      els.forEach(function (el, ei) {
        starsTimeouts.push(setTimeout(function () {
          el.classList.remove("show");
        }, outStart + ei * OUT_STAGGER));
      });
    });
  }

  /* S0 → S1：三行文案平滑淡出（不瞬间消失），文字退场后历史路线接棒推进，再弹出方向选择 */
  function enterS1() {
    if (starsState !== "s0") return;
    clearStarsTimeouts();
    /* 逐行收起（向上轻移 + 淡出），提前进入按钮同步淡出 */
    $$("#stars-lines .star-line").forEach(function (l) { l.classList.add("fade-out"); });
    var skip = $("#btn-stars-skip");
    if (skip) skip.classList.add("fade-out");
    /* 文字退场中：历史路线推进（湘江 → 遵义 → 现在，约 2s，先画给用户看） */
    starsTimeouts.push(setTimeout(function () {
      /* 湘江/遵义节点随历史路线一起浮现（S0 三行文案期间隐藏）；
         背景时间线在星辰幕不再显示——湘江→遵义→现在只保留一根橘色历史路线 */
      if (starsRouteEl) starsRouteEl.classList.add("nodes-on");
      if (starsHistEl && starsHistLen) {
        starsHistEl.style.transition = "stroke-dashoffset 2s ease";
        starsHistEl.style.strokeDashoffset = "0";
      }
    }, 500));
    /* 路线抵达"现在"：锚点/分叉点就位（曲线画完后浮现）+ 科技发展关键词按时代分 4 组浮现 */
    starsTimeouts.push(setTimeout(function () {
      completeStarsS0Visuals();
      showTechKeywords();
    }, 2500));
    /* 喘息：先让用户看清曲线 + 4 组关键词（末组逐个消失，约 15000ms 全退），再弹出方向选择 */
    starsTimeouts.push(setTimeout(function () { openStarsModal(); }, 15400));
  }

  /* S0 视觉补完：历史路线若未画完则平滑补完 + 锚点/分叉点/可能性虚线就位。
     正常时序由 enterS1 触发；用户在弹窗上快速选择时由 chooseStarsDir 兜底调用（clearStarsTimeouts 可能取消未触发的补完定时器，且 .sr-future/.lit 只在 futures-on 下可见） */
  function completeStarsS0Visuals() {
    /* 节点兜底：用户在弹窗快速选择时同样可见（与 enterS1 正常时序一致）；背景时间线在星辰幕不显示 */
    if (starsRouteEl) starsRouteEl.classList.add("nodes-on");
    if (starsHistEl && starsHistLen && starsHistEl.style.strokeDashoffset !== "0") {
      starsHistEl.style.transition = "stroke-dashoffset 0.9s ease";
      starsHistEl.style.strokeDashoffset = "0";
    }
    var bd = $("#sr-anchor-bd"); if (bd) bd.classList.add("show");
    var tg = $("#sr-anchor-tg"); if (tg) tg.classList.add("show");
    var br = $("#sr-branch"); if (br) br.classList.add("show");
    if (starsRouteEl) starsRouteEl.classList.add("futures-on");
  }

  /* 方向选择弹窗：居中沉浸（类似师长牺牲页），4 张卡片错峰浮现 */
  function openStarsModal() {
    showStarsStage("s1");
    var opts = $$("#stars-options .stars-option");
    opts.forEach(function (o) { o.classList.remove("show"); });
    void document.body.offsetWidth;
    opts.forEach(function (o) { o.classList.add("show"); });
  }

  /* 渲染 4 个方向（可能性，无标准答案） */
  function renderStarsOptions() {
    var wrap = $("#stars-options");
    if (!wrap) return;
    wrap.innerHTML = "";
    CONTENT.stars.directions.forEach(function (d) {
      var el = document.createElement("button");
      el.className = "option stars-option";
      el.type = "button";
      el.dataset.id = d.id;
      el.innerHTML = '<span class="option-text"><b></b><small></small></span>';
      el.querySelector(".option-text b").textContent = d.label;
      el.querySelector(".option-text small").textContent = d.desc;
      el.addEventListener("click", function () { chooseStarsDir(d.id, el); });
      wrap.appendChild(el);
    });
  }

  /* 选择方向：弹窗平滑关闭 → 分叉点光晕爆发，打开未来的路（点题）→ 星点亮 + 回应浮现 */
  function chooseStarsDir(id, el) {
    if (starsState !== "s1") return;
    starsChosen = id;
    var d = null;
    CONTENT.stars.directions.forEach(function (x) { if (x.id === id) d = x; });
    if (!d) return;
    clearStarsTimeouts();
    /* 兜底：确保路线/锚点/可能性虚线已就位（用户快速选择时，补完定时器可能尚未触发） */
    completeStarsS0Visuals();

    /* 按钮态：选中高亮，其余淡出 */
    $$("#stars-options .option").forEach(function (o) { o.classList.add("dim"); });
    el.classList.remove("dim");
    el.classList.add("chosen");

    var f = starsFutures[id];

    /* 弹窗平滑关闭（约 0.7s） */
    var modal = $("#stars-s1");
    if (modal) modal.classList.add("closing");
    starsTimeouts.push(setTimeout(function () {
      if (modal) { modal.classList.remove("closing"); modal.hidden = true; }
    }, 700));

    /* 光晕爆发：分叉点亮起、光环扩散——未来的路从这里打开（科幻感） */
    starsTimeouts.push(setTimeout(function () {
      ["sr-branch", "sr-halo-ring-1", "sr-halo-ring-2", "sr-halo-core"].forEach(function (hid) {
        var h = document.getElementById(hid);
        if (!h) return;
        h.classList.remove("burst", "burst2");
        void h.getBoundingClientRect();
        h.classList.add(hid === "sr-halo-ring-2" ? "burst2" : "burst");
      });
    }, 220));

    /* 其余 3 颗星淡出（保留“可能性”的暗示，不抹掉） */
    Object.keys(starsFutures).forEach(function (k) {
      if (k !== id) {
        starsFutures[k].star.classList.add("dim");
      }
    });

    /* 选中星球点亮，并把方向标签写进星球里 */
    if (f) {
      f.star.classList.add("lit");
      if (id === "warm") f.star.classList.add("is-warm");
      var dot = f.star.querySelector(".sr-star-dot");
      var label = f.star.querySelector(".sr-star-label");
      if (dot && label) {
        label.textContent = d.label;
        label.setAttribute("x", dot.getAttribute("cx"));
        /* 字号随字数自适应，保证标签完整落在星球（r42）内且醒目 */
        var fs = d.label.length >= 7 ? 11 : d.label.length >= 6 ? 12 : 14;
        label.setAttribute("y", Number(dot.getAttribute("cy")) + fs * 0.36);
        label.setAttribute("text-anchor", "middle");
        label.style.fontSize = fs + "px";
        label.style.fill = "#ffffff";
        label.style.fontWeight = "600";
        label.style.letterSpacing = d.label.length >= 6 ? "0.05em" : "0.08em";
        label.style.filter = "drop-shadow(0 1px 4px rgba(0,0,0,.9))";
      }
      /* 选中的未来路线以亮线绘出（分叉点 → 星辰，你选的那条路；弹窗关闭后开始，完整可见） */
      if (f.path && f.len) {
        starsTimeouts.push(setTimeout(function () {
          f.path.style.transition = "none";
          f.path.style.stroke = "#ffffff";
          f.path.style.strokeWidth = "3";
          f.path.style.filter = "drop-shadow(0 0 6px rgba(207,232,255,0.9))";
          f.path.style.strokeDasharray = String(f.len);
          f.path.style.strokeDashoffset = String(f.len);
          void f.path.getBoundingClientRect();
          f.path.style.transition = "stroke-dashoffset 1.6s ease";
          f.path.style.strokeDashoffset = "0";
        }, 800));
      }
    }

    /* 数据流粒子：沿选中路径流向星辰（体验式视觉反馈，非真实 AI） */
    starsTimeouts.push(setTimeout(function () { startStarsParticles(id); }, 950));

    /* 回应浮现（弹窗已关闭，底部居中，不挡路线） */
    starsTimeouts.push(setTimeout(function () {
      var layer = $("#stars-after-layer");
      if (layer) { layer.hidden = false; void layer.offsetWidth; layer.classList.add("show"); }
      showStarsDirResponse(d.response);
    }, 1650));
    starsTimeouts.push(setTimeout(function () {
      var decided = $("#stars-decided");
      if (!decided) return;
      decided.hidden = false;
      decided.classList.remove("show");
      void decided.offsetWidth;
      decided.classList.add("show");
    }, 2150));

    /* 光晕开路 + 回应读完，再进入 S2（一个词，必填）
       回应 1650ms 浮现、"这一次，路线由你决定" 2150ms 浮现，留约 3.8s 阅读时间（8000ms 偏长，用户要求缩短 2s → 6000ms） */
    starsTimeouts.push(setTimeout(function () { enterS2(); }, 6000));
  }

  /* 方向即时回应（预置一句，非真实 AI）——显示在 S1 底部 */
  function showStarsDirResponse(text) {
    var el = $("#stars-dir-response");
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth;
    el.classList.add("show");
  }

  /* S1 → S2：一个词（必填）；回应层收起，弹出输入弹窗 */
  function enterS2() {
    if (starsState !== "s1") return;
    clearStarsTimeouts();
    var layer = $("#stars-after-layer");
    if (layer) { layer.classList.remove("show"); layer.hidden = true; }
    ["stars-decided", "stars-dir-response", "wish-response"].forEach(function (id) {
      var el = $("#" + id);
      if (el) { el.hidden = true; el.classList.remove("show"); }
    });
    showStarsStage("s2");
  }

  /* 落下一个词（必填）：空输入 → 轻提示 + 抖动，不收束；填了 → 关闭弹窗 → 词落在点亮的星旁 + 底部回应浮现 → 收束 */
  function landWord() {
    if (starsState !== "s2") return;
    var input = $("#wish-input");
    var val = (input.value || "").trim();
    if (!val) {
      /* 必填：空输入时轻提示 + 抖动，不进入收束 */
      var hint = $("#wish-hint");
      if (hint) hint.textContent = CONTENT.stars.wordHintEmpty;
      if (input.focus) input.focus();
      input.classList.remove("shake");
      void input.offsetWidth;
      input.classList.add("shake");
      return;
    }
    landWordAtStar(val);
    input.value = "";
    if (input.blur) input.blur();
    /* 关闭 S2 弹窗，露出路线与星辰 */
    var s2 = $("#stars-s2");
    if (s2) s2.hidden = true;
    /* 底部回应浮现 */
    var resp = $("#wish-response");
    resp.textContent = wordResponseFor(val);
    resp.hidden = false;
    resp.classList.remove("show");
    void resp.offsetWidth;
    resp.classList.add("show");
    var layer = $("#stars-after-layer");
    if (layer) { layer.hidden = false; void layer.offsetWidth; layer.classList.add("show"); }
    /* 给 2.2s 看词落下与回应，再收束 */
    clearStarsTimeouts();
    starsTimeouts.push(setTimeout(function () { enterS3(); }, 2200));
  }

  /* 词作为"新轨道"环绕点亮的星球：文字沿圆形轨道排布（textPath），
     长词绕圈而不超出屏幕；仅当前页面 DOM，不上传 / 不保存，刷新即清除 */
  function landWordAtStar(val) {
    var f = starsChosen && starsFutures[starsChosen];
    if (!f || !f.star) return;
    var dot = f.star.querySelector(".sr-star-dot");
    if (!dot) return;
    var NS = "http://www.w3.org/2000/svg";
    var cx = Number(dot.getAttribute("cx"));
    var cy = Number(dot.getAttribute("cy"));
    var R = 82; /* 词轨道半径：明显大于星球(r42)+光晕(~60)与椭圆轨道(rx58)，文字不被星球光晕吞没，作为环绕的"新轨道" */
    var uid = "sr-word-orbit-" + (starsChosen || "x");
    /* 圆形轨道路径：从底部起顺时针，使 50% 处正好落在顶部（顶部文字正立可读）。
       文字必须居中在路径中段（50%）：若用 startOffset=0%+text-anchor=middle，前半截文字会落在路径起点之前，被浏览器裁掉（10 字吞一半的根因） */
    var orbit = document.createElementNS(NS, "path");
    orbit.setAttribute("id", uid);
    orbit.setAttribute("class", "sr-word-orbit");
    orbit.setAttribute("d",
      "M " + cx + "," + (cy + R) +
      " A " + R + "," + R + " 0 1,1 " + cx + "," + (cy - R) +
      " A " + R + "," + R + " 0 1,1 " + cx + "," + (cy + R));
    f.star.appendChild(orbit);
    /* 文字沿轨道排布，居中于顶部（正立，整段落在路径内，不吞字） */
    var text = document.createElementNS(NS, "text");
    text.setAttribute("class", "sr-word");
    text.setAttribute("text-anchor", "middle");
    var tp = document.createElementNS(NS, "textPath");
    tp.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", "#" + uid);
    tp.setAttribute("href", "#" + uid);
    tp.setAttribute("startOffset", "50%");
    tp.textContent = val;
    text.appendChild(tp);
    f.star.appendChild(text);
  }

  /* 收束：完整路径汇聚（湘江→遵义→分叉→用户星辰），只留一句 + 标题 + 两按钮 */
  function enterS3() {
    if (starsState !== "s2") return;
    clearStarsTimeouts();
    /* 先清理 S2 词回应层（原先未隐藏，回应文字会残留到 S3 汇聚画面里） */
    var layer = $("#stars-after-layer");
    if (layer) { layer.classList.remove("show"); layer.hidden = true; }
    ["stars-decided", "stars-dir-response", "wish-response"].forEach(function (id) {
      var el = $("#" + id);
      if (el) { el.hidden = true; el.classList.remove("show"); }
    });
    showStarsStage("s3");
    starsConverge();
    var t = [];
    t.push(setTimeout(function () {
      var dim = $("#stars-dim"); if (dim) dim.classList.add("show");
      var card = $("#stars-end-card"); if (card) card.classList.add("show");
      var f = $("#stars-final"); if (f) f.classList.add("show");
      var cta = $("#stars-s3 .stars-cta"); if (cta) cta.classList.add("show");
      /* 配乐不停：结束卡浮现后 stars-expansive 继续循环，用户查看史实/来源时也能听着；
         点"再走一次"=showScene(0) 触发 onExit("stars")→stopSceneBGM() 才停止
         （最后一幕不会走 onExit 离场，故此处不主动停，交给"再走一次"） */
    }, 4500));
    starsTimeouts = t;
  }

  /* 汇聚：光点沿 湘江→遵义→分叉→用户星辰 走一遍；历史 + 选中数字路线同时增亮（.converge） */
  function starsConverge() {
    stopStarsParticles();
    if (starsRouteEl) starsRouteEl.classList.add("converge");
    var dot = $("#sr-converge-dot");
    if (!dot || !starsRouteEl) return;
    /* 构造“历史 + 选中未来”的连续路径，供光点移动 */
    var f = starsChosen && starsFutures[starsChosen];
    var histD = starsHistEl ? starsHistEl.getAttribute("d") : "";
    var futD = f ? f.path.getAttribute("d") : "";
    var tmp = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tmp.setAttribute("d", histD + " " + futD);
    starsRouteEl.appendChild(tmp);
    var len = tmp.getTotalLength();
    var start = performance.now();
    var dur = 3000;
    dot.classList.add("play");
    function frame(now) {
      var p = Math.min(1, (now - start) / dur);
      var pt = tmp.getPointAtLength(len * p);
      dot.setAttribute("cx", pt.x);
      dot.setAttribute("cy", pt.y);
      if (p < 1) {
        starsConvergeRaf = requestAnimationFrame(frame);
      } else {
        starsConvergeRaf = null;
        if (tmp.parentNode) tmp.parentNode.removeChild(tmp);
      }
    }
    starsConvergeRaf = requestAnimationFrame(frame);
  }

  /* 数据流粒子：沿选中路径从分叉点流向星辰（体验式视觉反馈，非真实 AI） */
  function startStarsParticles(id) {
    stopStarsParticles();
    var f = starsFutures[id];
    if (!f || !f.path.getTotalLength || !starsRouteEl) return;
    var len = f.len;
    var count = 7;
    var offsets = [];
    for (var i = 0; i < count; i++) offsets.push(i / count);
    var start = performance.now();
    var speed = 0.2; /* 每秒走过的路径比例 */
    for (var j = 0; j < count; j++) {
      var c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("class", "sr-particle" + (id === "warm" ? " is-warm" : ""));
      c.setAttribute("r", "2.4");
      starsRouteEl.appendChild(c);
      starsParticles.push(c);
    }
    function frame(now) {
      var t = ((now - start) / 1000) * speed;
      for (var i = 0; i < count; i++) {
        var p = (offsets[i] + t) % 1;
        var pt = f.path.getPointAtLength(len * p);
        var el = starsParticles[i];
        if (el) { el.setAttribute("cx", pt.x); el.setAttribute("cy", pt.y); }
      }
      starsRaf = requestAnimationFrame(frame);
    }
    starsRaf = requestAnimationFrame(frame);
  }

  function stopStarsParticles() {
    if (starsRaf) { cancelAnimationFrame(starsRaf); starsRaf = null; }
    starsParticles.forEach(function (el) { if (el && el.parentNode) el.parentNode.removeChild(el); });
    starsParticles = [];
  }

  /* 未来回应/星辰回应：预置关键词匹配（无 AI / 无后端），命中即一句极短回应 */
  function wordResponseFor(val) {
    var list = CONTENT.stars.wordResponses || [];
    for (var i = 0; i < list.length; i++) {
      var keys = list[i].keys;
      for (var j = 0; j < keys.length; j++) {
        if (val.indexOf(keys[j]) !== -1) return list[i].text;
      }
    }
    return CONTENT.stars.wordDefault;
  }

  function clearStarsTimeouts() {
    starsTimeouts.forEach(clearTimeout);
    starsTimeouts = [];
  }

  /* ---------- 来源页（A/B/C/D） ---------- */
  function buildSources() {
    $("#sources-note").textContent = CONTENT.sources.note;
    $("#sources-disclaimer").textContent = CONTENT.sources.disclaimer;
    $("#src-history-title").textContent = CONTENT.sources.sections.history;
    $("#src-tech-title").textContent = CONTENT.sources.sections.tech;
    $("#src-tech-note").textContent = CONTENT.sources.techNote;
    $("#src-ai-title").textContent = CONTENT.sources.sections.ai;
    $("#src-sim-title").textContent = CONTENT.sources.sections.sim;

    var historyFacts = CONTENT.xianghe.decode.facts
      .concat(CONTENT.xianghe.decode.detail)
      .concat(CONTENT.turning.facts);
    renderFacts("#src-history", historyFacts, true);
    renderFacts("#src-tech", CONTENT.stars.facts, true);

    var aiWrap = $("#src-ai");
    aiWrap.innerHTML = "";
    CONTENT.sources.ai.forEach(function (a) {
      var el = document.createElement("div");
      el.className = "src-ai-item";
      el.innerHTML = '<div class="src-ai-label"></div><div class="src-ai-text"></div>';
      el.querySelector(".src-ai-label").textContent = a.label;
      el.querySelector(".src-ai-text").textContent = a.text;
      aiWrap.appendChild(el);
    });

    $("#src-sim").textContent = CONTENT.sources.sim;
  }

  function renderFacts(sel, facts, showWhere) {
    var wrap = $(sel);
    if (!wrap) return;
    wrap.innerHTML = "";
    facts.forEach(function (f) {
      var el = document.createElement("div");
      el.className = "fact " + (f.verified ? "verified" : "unverified");
      var text = document.createElement("p");
      text.className = "fact-text";
      text.textContent = f.text;
      var src = document.createElement("p");
      src.className = "fact-source";
      src.textContent = (f.verified ? "来源：" : "待核验：") + f.source;
      el.appendChild(text);
      if (showWhere && f.where) {
        var wh = document.createElement("p");
        wh.className = "fact-where";
        wh.textContent = "出现于：" + f.where;
        el.appendChild(wh);
      }
      el.appendChild(src);
      wrap.appendChild(el);
    });
  }

  function openSources() {
    var ov = $("#sources");
    ov.hidden = false;
    void ov.offsetWidth;
    ov.classList.add("open");
  }
  function closeSources() {
    var ov = $("#sources");
    ov.classList.remove("open");
    setTimeout(function () { ov.hidden = true; }, 600);
  }

  /* ---------- 场景切换 ---------- */
  function setRoute(progress) {
    if (!routeEl || !routeLen) return;
    routeEl.style.transition = "stroke-dashoffset 2s ease";
    routeEl.style.strokeDashoffset = String(routeLen * (1 - progress));
  }

  function onEnter(name) {
    if (name === "xianghe") {
      /* 克制的环境音：水声（需用户已开启声音，受总开关控制） */
      if (window.AudioAmbient && window.AudioAmbient.startWater) window.AudioAmbient.startWater();
      /* 首次进入提示（每次打开页面只提示一次，点任一模块后消失） */
      if (!xhHintDismissed) xhShowFirstHint();
    }
  if (name === "turning") { buildTurning(); if (window.AudioAmbient && window.AudioAmbient.startSceneBGM) window.AudioAmbient.startSceneBGM("turning"); /* 遵义·希望配乐（与上一幕交叉淡入淡出） */ }
  if (name === "sixty") { startSixty(); }
  if (name === "stars") { startStars(); if (window.AudioAmbient && window.AudioAmbient.startSceneBGM) window.AudioAmbient.startSceneBGM("stars"); /* 星辰·开阔配乐 */ }
}
  function onExit(name) {
    if (name === "xianghe") {
      /* 注意：不清 xhTimers —— 高潮框内的“史实解码”按钮依赖该定时器显示，
         清空会导致用户无法解码/继续（卡死）。场景隐藏时定时器触发无害。 */
      if (window.AudioAmbient && window.AudioAmbient.stopWater) window.AudioAmbient.stopWater();
    }
    /* 离场统一停配乐（无则空操作）：湘江高潮/遵义/星辰的 BGM 都在此淡出 */
    if (window.AudioAmbient && window.AudioAmbient.stopSceneBGM) window.AudioAmbient.stopSceneBGM();
    if (name === "turning") {
      /* 离场即清：防止揭示定时器在隐藏场景上触发，
         避免 map-shift / 场景地图状态残留 */
      turningTimeouts.forEach(clearTimeout);
      turningTimeouts = [];
      if (mapEl) mapEl.classList.remove("map-shift");
      resetZnMap();
    }
    if (name === "sixty") { stopSixty(); }
    if (name === "stars") {
      /* 离场即清：停定时器 / 数据流粒子 / 收束光点，防止 rAF 在隐藏场景上继续跑 */
      clearStarsTimeouts();
      stopStarsParticles();
      if (starsConvergeRaf) { cancelAnimationFrame(starsConvergeRaf); starsConvergeRaf = null; }
    }
  }

  function showScene(i) {
    var oldName = SCENES[current];
    onExit(oldName);

    current = i;
    var name = SCENES[i];
    document.body.dataset.scene = name;
    document.body.dataset.phase = PHASE_MAP[name];

    $$(".scene").forEach(function (s) {
      s.classList.toggle("active", s.dataset.scene === name);
    });

    $("#btn-back").style.visibility = i > 0 ? "visible" : "hidden";

    var prog = ROUTE_PROG[name];
    if (prog !== null) setRoute(prog);

    onEnter(name);
  }

  function next() { if (current < SCENES.length - 1) showScene(current + 1); }
  function back() { if (current > 0) showScene(current - 1); }

  function resetAll() {
    /* 行囊 */
    selected = {};
    selectedCount = 0;
    lastAddedId = null;
    lastPickedId = null;
    updatePack();
    $("#obstacles-result").hidden = true;
    var pack = $("#pack");
    pack.classList.remove("drag-breathing");
    pack.classList.remove("drag-over");
    $$("#cards .card").forEach(function (c) { c.classList.remove("dragging"); });

    /* 湘江沉浸式场景 */
    convergePlayed = false;
    if (convergeTimer) { clearTimeout(convergeTimer); convergeTimer = null; }
    var cg = $("#xh-converge");
    if (cg) cg.classList.remove("play");
    resetXianghe();

    /* 转折（重新渲染 3 个方向，隐藏已选/揭示/史实/按钮） */
    buildTurning();
    if (mapEl) mapEl.classList.remove("map-shift");

    /* 30 秒 */
    clearSixtyTimeouts();
    $("#sixty-timer").textContent = "30";
    var msg = $("#sixty-msg");
    msg.textContent = "";
    msg.classList.remove("show");
    clearSixtyStage();
    clearSixtyEcho();
    hideSixtyEnd();
    $("#btn-sixty-continue").hidden = true;

    /* 星辰（90年后 S0-S3 全部复位） */
    resetStars();

    closeSources();
  }

  function replay() {
    resetAll();
    showScene(0);
  }

  /* ---------- 声音 ---------- */
  var soundOn = true;
  function toggleSound() {
    soundOn = !soundOn;
    if (window.AudioAmbient) window.AudioAmbient.setMuted(!soundOn);
    var b = $("#btn-sound");
    b.classList.toggle("muted", !soundOn);
    b.textContent = soundOn ? "♪" : "✕";
  }

  /* ---------- 事件绑定 ---------- */
  function bindNav() {
    $$('[data-action="next"]').forEach(function (b) {
      b.addEventListener("click", next);
    });
    $$('[data-action="replay"]').forEach(function (b) {
      b.addEventListener("click", replay);
    });
    $$('[data-action="sources"]').forEach(function (b) {
      b.addEventListener("click", openSources);
    });
    $$('[data-action="close-sources"]').forEach(function (b) {
      b.addEventListener("click", closeSources);
    });

    $("#btn-back").addEventListener("click", back);
    $("#btn-sound").addEventListener("click", toggleSound);
    $("#btn-xianghe-decode").addEventListener("click", decodeXianghe);
    $("#btn-turning-next").addEventListener("click", onTurningNext);
    /* 90年后：S0 提前进入 / S2 落下一个词(必填) */
    $("#btn-stars-skip").addEventListener("click", enterS1);
    $("#btn-wish").addEventListener("click", landWord);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
