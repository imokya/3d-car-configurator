import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RectAreaLightTexturesLib } from "three/addons/lights/RectAreaLightTexturesLib.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import {
  pass,
  reflector,
  uniform,
  vec3,
  positionWorld,
  positionGeometry,
  mx_noise_float,
  float,
  normalView,
  positionViewDirection,
  mix,
  pow,
  time,
  fract,
  smoothstep,
  abs,
  uv,
  cameraPosition as cameraWorldPos, // 本地已有同名相机预设函数，导入时改名避让
  reflect,
  atan,
  normalWorld,
} from "three/tsl";
import { bloom as bloomNode } from "three/addons/tsl/display/BloomNode.js";

const $ = (s) => document.querySelector(s);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = matchMedia("(max-width:800px)").matches;
const host = $("#scene");
const paints = {
  papaya: {
    hex: "#ef721b",
    name: "Papaya Spark",
    cn: "Metallic",
    finish: "Signature finish",
  },
  lime: {
    hex: "#9dbf24",
    name: "Lime Green",
    cn: "Metallic",
    finish: "Signature finish",
  },
  blue: {
    hex: "#23638b",
    name: "Aurora Blue",
    cn: "Metallic",
    finish: "Signature finish",
  },
  white: {
    hex: "#e6e8e7",
    name: "Silica White",
    cn: "Pearlescent",
    finish: "Signature finish",
  },
  silver: {
    hex: "#7f8b94",
    name: "Titanium Silver",
    cn: "Metallic",
    finish: "Signature finish",
  },
  black: {
    hex: "#15191d",
    name: "Onyx Black",
    cn: "Metallic",
    finish: "Signature finish",
  },
};
const state = {
  loaded: false,
  color: "papaya",
  view: "overview",
  lights: false,
  studio: "night",
  aero: true, // 默认开启流线（风阻）效果
  transitioning: false,
};
let renderer,
  scene,
  camera,
  orbitCamera,
  controls,
  composer,
  bloom,
  car,
  animation = null,
  // 混合系数初值必须与 state 的目标状态一致，否则加载后头 1~2 秒会以旧状态渲染、
  // 再平滑过渡到目标状态——夜间亮度主要靠金属的环境反射，这段差值在轮子上最显眼。
  lightAmount = 0, // = state.lights
  nightAmount = state.studio === "night" ? 1 : 0, // = state.studio；此前固定 0，开场先按白天渲染再暗下来
  aeroAmount = state.aero ? 1 : 0, // = state.aero；默认开启，初值必须是 1，否则开场会先渲染无流线的亮场景再淡入
  raf = 0;
let glassMaterials = [],
  paintMaterials = [],
  emitters = [],
  spotlights = [],
  headlightPositions = [];
// 水墨变色：模型加载完成后由 load() 里赋值为真正的触发器（此前 setColor 只改目标色）
let inkTrigger = null;
// ---- 全局调参（唯一修改入口 TUNING）------------------------------------------------
// 所有美术参数集中在这里：HDRI 选择、环境旋转/强度、曝光、泛光、车漆清漆参数。
// debug 面板（#debug）滑块的初始值和 Reset 目标值也全部来自这里。
const TUNING = {
  // HDRI 环境：换成 public/assets/ 下的任意文件名，如 brown_photostudio_02_2k.hdr
  hdriFile: "studio_small_09_2k.hdr",
  hdriRotationY: Math.PI * 0.65, // 环境贴图绕 Y 轴旋转，决定高光落在车身的位置
  envIntensityDay: 0.85, // 白天环境强度基线
  envNightDrop: 0.5, // 夜间从基线下降的幅度
  ambientScale: 1, // 半球环境光倍率
  envScale: 2, // HDRI 环境强度倍率（debug 面板 Environment intensity 滑块默认值）
  exposure: 1.5, // 初始曝光 = debug 面板 Exposure 滑块默认值
  bloomStrength: 0.2,
  bloomRadius: 0.07,
  bloomThreshold: 0.5,
  // 大灯（点击灯光按钮点亮）：车前地面的一滩光斑 + 灯罩周围一点点溢光
  // 位置/朝向/角度均已回退到原实现（顶点在灯罩处、目标 8m 外，光斑落在车前 4~8m）
  headlightBeam: 35, // 光束强度（决定地面光斑亮度）
  headlightBeamReach: 6.05, // 光斑中心落点：自灯罩起算的水平距离（米）——6.05 ≈ 原实现的 8m 外；调小就往车前近处挪
  headlightBeamLead: 0, // 光束起点自灯罩再往前移的距离（米）；给正值可把光锥顶点移出车身
  headlightBeamSpread: 1.3, // 左右两束光斑中心的横向位置（米）
  headlightBeamAngle: 0.31, // 光束半角（弧度，越大光斑越大越散）
  headlightBeamPenumbra: 0.65, // 光斑边缘柔和度（0 = 硬边，1 = 极柔）
  headlightBeamRange: 11, // 光束射程（米）
  headlightSpill: 0.5, // 灯罩溢光强度（点光源，裹住灯罩那点热光）；0 = 关掉，灯靠 emissive + 泛光自己亮
  headlightSpillRange: 0.45, // 灯罩溢光半径（米）：越小越不会洗亮前脸/引擎盖
  coat: 1, // 车漆 clearcoat
  coatRoughness: 0, // 车漆 clearcoatRoughness
  envMapIntensity: 1.9, // 车漆 envMapIntensity
  // 风阻模式（Aero）：点击按钮进入，灯光压暗 + 流线沿车身曲线流动
  aeroDim: 0.62, // 环境光压暗比例（进入风阻模式后环境强度乘 (1 - aeroDim)）
  aeroLineCount: 34, // 空中流线管数量（想更密就往上加；移动端自动按 aeroMobileScale 折减）
  aeroLineRadius: 0.0011, // 流线管半径（相对车长的比例，越小越细）
  aeroMobileScale: 0.5, // 移动端线条数量折减系数
  aeroFlowSpeed: 0.3, // 风痕沿线条掠过的速度
  // 阵风（线条不常驻发光，而是一阵一阵地掠过、然后彻底消失）
  aeroGustCount: 2, // 每条线上同时最多几段风痕（越大越密；1 = 一次只有一束风扫过）
  aeroGustDuty: 0.3, // 单段风痕占「一段」的长度比例（越小风痕越短、空白越多）
  aeroGustVar: 0.3, // 相位抖动：让每段风痕的间隔与快慢不均匀（0 = 均匀循环，会读成跑马灯）
  aeroGustBurst: 0.35, // 风痕强弱的不均匀度（不同线条、不同时段的阵风强弱差异）
  aeroGustRate: 0.25, // 强弱起伏的节奏速度
  aeroBaseGlow: 0, // 线条底光（0 = 没有风痕时线条完全不可见）
  aeroClearance: 0.12, // 车体内线条的净空（相对车高，保证不碰车身）
  aeroFloor: 0.05, // 硬安全下限：任何位置都不低于「沿车长传播过的局部最高面 + 该间隙」
  aeroSpread: 1.22, // 流线横向铺开范围（相对车宽；1 = 与车等宽，越大车体外越多）
  aeroWrap: 1, // 车体外侧线条随轮廓下压的包裹强度（0=不包裹，1=完全贴住侧缘）
  aeroFlankClear: 0.03, // 车体外线条贴住侧缘的净空（相对车高，越小越贴）
  aeroLead: 0.26, // 车头前方延长量（相对车长）
  aeroTrail: 0.34, // 车尾尾流延长量（相对车长）
  aeroNoseDip: 0.035, // 车头延长段的远端下压（相对车高）
  aeroTrailDip: 0.13, // 车尾尾流远端的下潜量（相对车高）
  aeroSmooth: 3, // 车身轮廓采样平滑遍数（越大越圆润，过大会抹掉后视镜等凸起）
  aeroEdgeSmooth: 4, // 侧缘曲线沿车长的平滑遍数（车头/车尾的线条走向靠它变顺）
  aeroLineSmooth: 10, // 流线沿弧长的平滑遍数（越大曲线越顺；过大线条会脱离车顶起伏）
  aeroReach: 0.045, // 「局部最高」沿车长传播的半径（相对车长，越大越保守越顺）
  aeroLineColor: "#bfe3ff", // 流线颜色（冷白偏蓝，bloom 会拾取泛光）
  aeroDirection: 1, // 流动方向（沿车长轴）；观感反了就改成 -1
  aeroPaintDensity: 2.4, // 车身反光条纹密度（环绕方向，条/弧度）
  aeroPaintFlow: 2.2, // 反光沿车身长度方向的流动密度
  aeroPaintStrength: 0.5, // 车身反光强度
  // 变色动画（水墨扩散）：换色时新颜色像墨滴入水一样从墨心洇开，而不是整体渐变
  inkDuration: 1.6, // 一次水墨扩散的时长（秒）
  inkSeed: [0, -0.12, 0], // 墨心位置（相对车身包围盒的 -1..1 归一化坐标；y 取负 = 从车腰起笔）
  inkStart: -0.32, // 前沿起点（归一化距离域，负值 = 从墨心一个点开始洇）
  inkEnd: 1.75, // 前沿终点（1.0 ≈ 车长的一半；>1.35 时已铺满全车）
  inkSoft: 0.1, // 前沿软边宽度（越大过渡越柔）
  inkSquash: 1.6, // 竖直方向权重（越大，车顶比车头车尾更晚被墨染到）
  inkBlotchScale: 1.2, // 大墨团噪声频率（每米；越大墨团越碎）
  inkBlotch: 0.22, // 大墨团扰动幅度（前沿的大起伏）
  inkTendrilScale: 5.5, // 细墨丝噪声频率
  inkTendril: 0.08, // 细墨丝扰动幅度（边缘毛糙、渗出细须）
  inkWarp: 0.16, // 低频域扭曲（让墨迹整体走形，不只像圆斑）
  inkBleed: 0.34, // 前沿外侧的渗透宽度（洇出去的一点淡色）
  inkBleedAmount: 0.4, // 渗透浓度（0 = 边界干净，无渗透）
  inkWet: 0.28, // 湿边：前沿一圈略深的墨色（0 = 关闭）
  inkWetRough: 0.35, // 湿边处的粗糙度增量（墨吃进漆面 → 稍微失去清漆镜面感）
};
// 风阻模式的混合系数（0=关闭，1=完全进入）：帧循环里向 state.aero 目标平滑过渡，
// 车漆流线的 emissiveNode 和流线管颜色都引用它，实现淡入淡出
const aeroMix = uniform(0);
// Debug 面板的运行时状态：初始值取自 TUNING，打开面板拖滑块后被覆写。
const debugState = {
  active: false,
  envScale: TUNING.envScale,
  ambientScale: TUNING.ambientScale,
  baseExposure: TUNING.exposure,
  bloomStrength: TUNING.bloomStrength,
  bloomRadius: TUNING.bloomRadius,
  bloomThreshold: TUNING.bloomThreshold,
  coat: TUNING.coat,
  coatRoughness: TUNING.coatRoughness,
  envMapIntensity: TUNING.envMapIntensity,
};
const orbitCenter = new THREE.Vector3(),
  focusTarget = new THREE.Vector3(),
  aimOffset = new THREE.Vector3(),
  previousOrbit = new THREE.Vector3();
function syncOrbit() {
  orbitCamera.position.copy(camera.position);
  controls.target.copy(orbitCenter);
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  aimOffset.copy(focusTarget).sub(orbitCenter);
  previousOrbit.copy(camera.position).sub(orbitCenter).normalize();
}
function updateOrbit() {
  controls.update();
  const direction = orbitCamera.position.clone().sub(orbitCenter).normalize();
  aimOffset.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(previousOrbit, direction),
  );
  previousOrbit.copy(direction);
  camera.position.copy(orbitCamera.position);
  focusTarget.copy(orbitCenter).add(aimOffset);
  camera.lookAt(focusTarget);
}
const colorNow = new THREE.Color(paints.papaya.hex),
  colorTarget = colorNow.clone();
const lightColor = new THREE.Color("#f0f6ff"),
  rearColor = new THREE.Color("#ff142b");
const bgDay = new THREE.Color("#b8bec6"),
  bgNight = new THREE.Color("#11161d");
// 机位预设：pos/target 都是「车已摆好」后的世界坐标（车头朝 +Z、轮胎底 y=0）
// 这几组角度是按场景真实灯光（主光在右前上方、两条长条面光、HDRI 主光箱在左前上方）算出来的：
// 目标 = 可见面尽量落在受光侧 + 车身能反射到柔光箱 + 长条面光的高光落在肩线上，且整车不出画
// 正侧面机位的取景常数：dist 是 1.78 宽高比下的相机距离；车身长边横铺（半长 2.244m、
// 近侧翼子板距相机平面约 1.0m），所以窗口一变窄就得按 (dist-near) 等比退远，
// 否则水平视野装不下车长、车头车尾会被切掉。cap 同时要低于 controls.maxDistance。
const SIDE_FIT = { dist: 6.25, near: 1.0, aspect: 1.78, cap: 11.4 };
const presets = {
  overview: { pos: [4.0, 1.71, 4.4], target: [0, 0.68, 0], name: "Overview" },
  front: {
    pos: [2.97, 1.52, 4.14], // 抬高一点让引擎盖吃到长条光，横向收一点让高光落到前翼子板
    target: [0, 0.63, 1.54],
    name: "Front signature",
  },
  wheels: {
    pos: [3.5, 1.2, 2.74], // 拉远 1.2×、抬高 7°：轮毂对环境的反射从 0.64 提到 0.99
    target: [0.88, 0.36, 1.19],
    name: "Forged wheels",
  },
  side: {
    // 正侧面：相机沿 +X 轴正对车身（y0.88 = 2.9° 微俯，刚好在 controls.maxPolarAngle 之内），
    // 目标点落在整车包围盒中心 → 车头（+Z）朝画面左，车身长边（4.49m）横铺屏宽，
    // 1.78 宽高比下整车轮廓占屏宽 79%、占屏高 40%，四周留白宽裕，不切头不切尾。
    // fit:true 让窄窗口自动退远（见 cameraPosition）。
    pos: [SIDE_FIT.dist, 0.88, 0],
    target: [0, 0.6, 0],
    fit: true,
    name: "Aerodynamics",
  },
  cockpit: {
    pos: [1.98, 1.24, 2.87], // 压低 14°、拉远 1.5×：风挡从「一堵平的漆面」变成能照到柔光箱的玻璃
    target: [0.23, 0.85, 0.1],
    name: "Cockpit",
  },
  rear: {
    pos: [-3.1, 1.5, -5.3],
    target: [0, 0.64, -1.25],
    name: "Rear design",
  },
};
const announce = (t) => {
  $("#announcement").textContent = t;
};
function setColor(id) {
  if (!paints[id]) throw new Error("Unknown paint");
  state.color = id;
  const inkFromColor = colorNow.clone(); // 变色前的显示色 = 水墨扩散的起点
  colorTarget.set(paints[id].hex);
  if (reducedMotion) colorNow.copy(colorTarget);
  if (inkTrigger) inkTrigger(inkFromColor, colorTarget);
  document.querySelectorAll(".swatch").forEach((b) => {
    const s = b.dataset.color === id;
    b.classList.toggle("selected", s);
    b.setAttribute("aria-pressed", String(s));
  });
  announce(`Selected ${paints[id].cn}`);
}
// ---- Debug mode (#debug) ----------------------------------------------------------
// Sliders bind to live values: two multipliers the render loop applies, exposure straight on the
// renderer, and three clearcoat properties written onto every paint material.
function setPaintProperty(key, value) {
  paintMaterials.forEach((m) => {
    const had = m[key] > 0;
    m[key] = value;
    if (had !== value > 0) m.needsUpdate = true;
  });
}
function debugPaintValues() {
  const m = paintMaterials[0] || {};
  return {
    coat: m.clearcoat,
    coatR: m.clearcoatRoughness,
    envMap: m.envMapIntensity,
  };
}
function bindDebugSlider(id, format, apply) {
  const el = $("#" + id),
    out = $("#" + id + "-out");
  const run = () => {
    const v = Number(el.value);
    apply(v);
    out.textContent = format(v);
  };
  el.addEventListener("input", run);
  run();
  return el;
}
function attachDebugPanel() {
  // 绑定前先把滑块同步成 TUNING 默认值，避免 index.html 的 value 属性反过来覆盖 JS。
  $("#dbg-env").value = debugState.envScale;
  $("#dbg-ambient").value = debugState.ambientScale;
  $("#dbg-exposure").value = debugState.baseExposure;
  $("#dbg-coat").value = debugState.coat;
  $("#dbg-coat-r").value = debugState.coatRoughness;
  $("#dbg-envmap").value = debugState.envMapIntensity;
  $("#dbg-bloom").value = debugState.bloomStrength;
  $("#dbg-bloom-r").value = debugState.bloomRadius;
  $("#dbg-bloom-t").value = debugState.bloomThreshold;
  bindDebugSlider(
    "dbg-env",
    (v) => v.toFixed(2) + "×",
    (v) => {
      debugState.envScale = v;
    },
  );
  bindDebugSlider(
    "dbg-ambient",
    (v) => v.toFixed(2) + "×",
    (v) => {
      debugState.ambientScale = v;
    },
  );
  bindDebugSlider(
    "dbg-exposure",
    (v) => v.toFixed(2),
    (v) => {
      renderer.toneMappingExposure = v;
    },
  );
  bindDebugSlider(
    "dbg-coat",
    (v) => v.toFixed(2),
    (v) => setPaintProperty("clearcoat", v),
  );
  bindDebugSlider(
    "dbg-coat-r",
    (v) => v.toFixed(3),
    (v) => setPaintProperty("clearcoatRoughness", v),
  );
  bindDebugSlider(
    "dbg-envmap",
    (v) => v.toFixed(2),
    (v) => setPaintProperty("envMapIntensity", v),
  );
  bindDebugSlider(
    "dbg-bloom",
    (v) => v.toFixed(2),
    (v) => {
      debugState.bloomStrength = v;
    },
  );
  bindDebugSlider(
    "dbg-bloom-r",
    (v) => v.toFixed(2),
    (v) => {
      bloom.radius.value = v;
    },
  );
  bindDebugSlider(
    "dbg-bloom-t",
    (v) => v.toFixed(2),
    (v) => {
      bloom.threshold.value = v;
    },
  );
  $("#debug-reset").addEventListener("click", () => {
    $("#dbg-env").value = debugState.envScale;
    $("#dbg-ambient").value = debugState.ambientScale;
    $("#dbg-exposure").value = debugState.baseExposure;
    $("#dbg-coat").value = debugState.coat;
    $("#dbg-coat-r").value = debugState.coatRoughness;
    $("#dbg-envmap").value = debugState.envMapIntensity;
    $("#dbg-bloom").value = debugState.bloomStrength;
    $("#dbg-bloom-r").value = debugState.bloomRadius;
    $("#dbg-bloom-t").value = debugState.bloomThreshold;
    [
      "dbg-env",
      "dbg-ambient",
      "dbg-exposure",
      "dbg-coat",
      "dbg-coat-r",
      "dbg-envmap",
      "dbg-bloom",
      "dbg-bloom-r",
      "dbg-bloom-t",
    ].forEach((id) => $("#" + id).dispatchEvent(new Event("input")));
    $("#debug-status").textContent = "Reset";
  });
  $("#debug-copy").addEventListener("click", async () => {
    const snapshot = {
      environmentScale: debugState.envScale,
      ambientScale: debugState.ambientScale,
      exposure: renderer.toneMappingExposure,
      bloomStrength: debugState.bloomStrength,
      bloomRadius: bloom.radius.value,
      bloomThreshold: bloom.threshold.value,
      ...debugPaintValues(),
    };
    const text = JSON.stringify(snapshot);
    try {
      await navigator.clipboard.writeText(text);
      $("#debug-status").textContent = "Copied";
    } catch {
      $("#debug-status").textContent = text;
    }
  });
  $("#debug-close").addEventListener("click", () => setDebug(false));
  $("#debug-status").textContent = "";
}
function setDebug(on) {
  debugState.active = Boolean(on);
  const el = $("#debug");
  if (!el) return;
  el.hidden = !debugState.active;
  if (debugState.active) {
    renderer.toneMappingExposure = Number($("#dbg-exposure").value);
  }
  announce(debugState.active ? "Debug panel open" : "Debug panel closed");
}
function setLights(on) {
  state.lights = Boolean(on);
  $("#lights").setAttribute("aria-checked", String(state.lights));
  $("#lights").setAttribute(
    "aria-label",
    state.lights ? "Turn headlights off" : "Turn headlights on",
  );
  announce(state.lights ? "Headlights on" : "Headlights off");
}
function setStudio(mode) {
  if (!["day", "night"].includes(mode)) throw new Error("Unknown studio");
  state.studio = mode;
  $("#app").classList.toggle("night", mode === "night");
  for (const m of ["day", "night"]) {
    $("#" + m).classList.toggle("active", mode === m);
    $("#" + m).setAttribute("aria-pressed", String(mode === m));
  }
  announce(mode === "day" ? "Daylight studio" : "Night studio");
}
function setAero(on, silent = false) {
  state.aero = Boolean(on);
  $("#aero").classList.toggle("active", state.aero);
  $("#aero").setAttribute("aria-pressed", String(state.aero));
  if (!silent) announce(state.aero ? "Aerodynamics mode" : "Studio mode");
}
function cameraPosition(p) {
  const v = new THREE.Vector3(...p.pos);
  const aspect = host.clientWidth / host.clientHeight;
  if (aspect < 1.05 && state.view === "overview") {
    v.multiplyScalar(1.34);
    v.y = 3.1;
  }
  // 正侧面是长边镜头：窗口越窄水平视野越小，等比退远让整车轮廓始终完整落在画面里
  if (p.fit && aspect < SIDE_FIT.aspect) {
    const target = new THREE.Vector3(...p.target);
    const dir = v.clone().sub(target).normalize();
    const dist = Math.min(
      SIDE_FIT.cap,
      SIDE_FIT.near +
        (SIDE_FIT.dist - SIDE_FIT.near) * (SIDE_FIT.aspect / aspect),
    );
    v.copy(target).addScaledVector(dir, dist);
  }
  return v;
}
function focusPart(id) {
  if (!presets[id]) throw new Error("Unknown view");
  state.view = id;
  $(".stage").classList.toggle("detail-view", id !== "overview");
  document.querySelectorAll(".view").forEach((b) => {
    const active = b.dataset.view === id;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  });
  if (!state.loaded) return;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = true;
  const to = cameraPosition(presets[id]),
    target = new THREE.Vector3(...presets[id].target);
  if (reducedMotion) {
    camera.position.copy(to);
    focusTarget.copy(target);
    camera.lookAt(target);
    syncOrbit();
    return;
  }
  // Orbit about the interpolated target: the camera stays outside the body instead of cutting through it.
  const fromTarget = focusTarget.clone();
  const a = new THREE.Spherical().setFromVector3(
    camera.position.clone().sub(fromTarget),
  );
  const b = new THREE.Spherical().setFromVector3(to.clone().sub(target));
  while (b.theta - a.theta > Math.PI) b.theta -= Math.PI * 2;
  while (b.theta - a.theta < -Math.PI) b.theta += Math.PI * 2;
  animation = {
    start: performance.now(),
    duration: 2200,
    fromTarget,
    toTarget: target,
    a,
    b,
    fromFov: camera.fov,
  };
  state.transitioning = true;
  controls.enabled = false;
  announce(`Focus: ${presets[id].name}`);
}
for (const b of document.querySelectorAll(".swatch"))
  b.addEventListener("click", () => setColor(b.dataset.color));
for (const b of document.querySelectorAll(".view"))
  b.addEventListener("click", () => focusPart(b.dataset.view));
$("#lights").addEventListener("click", () => setLights(!state.lights));
$("#day").addEventListener("click", () => setStudio("day"));
$("#night").addEventListener("click", () => setStudio("night"));
$("#aero").addEventListener("click", () => setAero(!state.aero));
setStudio(state.studio); // 同步初始 UI 状态（默认夜间模式）
setAero(state.aero, true); // 同步初始 UI 状态（默认开启流线效果）
$("#reset").addEventListener("click", () => focusPart("overview"));
$("#retry").addEventListener("click", () => location.reload());
function fail(e) {
  console.error(e);
  $("#retry").hidden = false;
  $("#loader").classList.remove("loaded");
  host.setAttribute("aria-label", "3D model could not be loaded");
}

try {
  await init();
} catch (e) {
  fail(e);
}
async function init() {
  renderer = new THREE.WebGPURenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  await renderer.init();
  host.dataset.renderer = renderer.backend.isWebGPUBackend
    ? "WebGPU"
    : "WebGL2 compatibility";
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.35 : 1.65));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = TUNING.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    fail(new Error("Graphics context lost"));
  });
  scene = new THREE.Scene();
  scene.background = bgDay.clone();
  camera = new THREE.PerspectiveCamera(
    30,
    host.clientWidth / host.clientHeight,
    0.05,
    2000,
  );
  camera.position.copy(cameraPosition(presets.overview));
  orbitCamera = camera.clone();
  controls = new OrbitControls(orbitCamera, renderer.domElement);
  controls.zoomToCursor = false;
  controls.target.set(0, 0.68, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 1.1;
  controls.maxDistance = 12;
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.minPolarAngle = 0.12;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.65;
  controls.update();
  host.addEventListener(
    "pointerdown",
    () => {
      if (animation) {
        animation = null;
        state.transitioning = false;
        controls.enabled = true;
        syncOrbit();
      }
    },
    { capture: true },
  );
  host.addEventListener("keydown", (e) => {
    if (!state.loaded) return;
    const s = new THREE.Spherical().setFromVector3(
      camera.position.clone().sub(controls.target),
    );
    let handled = true;
    if (e.key === "ArrowLeft") s.theta -= 0.13;
    else if (e.key === "ArrowRight") s.theta += 0.13;
    else if (e.key === "ArrowUp") s.phi = Math.max(0.15, s.phi - 0.1);
    else if (e.key === "ArrowDown")
      s.phi = Math.min(Math.PI * 0.48, s.phi + 0.1);
    else if (["+", "="].includes(e.key))
      s.radius = Math.max(1.1, s.radius * 0.9);
    else if (e.key === "-") s.radius = Math.min(12, s.radius * 1.1);
    else handled = false;
    if (handled) {
      e.preventDefault();
      animation = null;
      state.transitioning = false;
      controls.enabled = true;
      orbitCamera.position
        .copy(orbitCenter)
        .add(new THREE.Vector3().setFromSpherical(s));
      updateOrbit();
    }
  });
  $("#load-progress").style.width = "18%"; // HDRI 阶段没有精确进度，先推进一截表示在动
  const hdri = await new HDRLoader().loadAsync(
    `${import.meta.env.BASE_URL}assets/${TUNING.hdriFile}`,
  );
  hdri.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdri;
  scene.environmentRotation.y = TUNING.hdriRotationY;
  const ambient = new THREE.HemisphereLight(0xe1edff, 0x8a8177, 1.15);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(3.5, 7.5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 18;
  key.shadow.normalBias = 0.025;
  key.shadow.bias = -0.00015;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdbe7ff, 0.6);
  rim.position.set(-4, 3, -2);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(3, 4, 1);
  scene.add(fill);
  // Long studio strips draw controlled gradients across the hood, roof and shoulders.
  RectAreaLightTexturesLib.init();
  THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib);
  const roofStrip = new THREE.RectAreaLight(0xfff4e9, 4.0, 0.7, 5.5);
  roofStrip.position.set(-1.8, 3.6, 0.7);
  roofStrip.lookAt(0, 0.65, 0);
  scene.add(roofStrip);
  const shoulderStrip = new THREE.RectAreaLight(0xe9f1ff, 2.8, 0.65, 4.8);
  shoulderStrip.position.set(2.5, 3.1, -1.3);
  shoulderStrip.lookAt(0, 0.7, -0.25);
  scene.add(shoulderStrip);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshStandardNodeMaterial({
      color: "#c4c9cf",
      roughness: 0.6,
      metalness: 0,
      envMapIntensity: 0.25,
      transparent: true,
    }),
  );
  floor.material.opacityNode = float(1).sub(
    positionWorld.xz.length().smoothstep(10, 45),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.015;
  floor.receiveShadow = true;
  scene.add(floor);
  // Soft contact shadow anchors the tires without adding a second high-density shadow render.
  const cv = document.createElement("canvas");
  cv.width = cv.height = 128;
  const ctx = cv.getContext("2d");
  const gr = ctx.createRadialGradient(64, 64, 7, 64, 64, 64);
  gr.addColorStop(0, "rgba(0,0,0,.65)");
  gr.addColorStop(0.48, "rgba(0,0,0,.33)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.1, 5.6),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(cv),
      transparent: true,
      depthWrite: false,
      opacity: 0.65,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  scene.add(shadow);
  // Native TSL ground reflection, compatible with the WebGPU backend.
  // Full-res target + MSAA removes the jagged edges; blur rises with distance from the car,
  // like a real glossy floor: crisp at the contact patch, softly diffused further out.
  // The reflector re-renders the whole scene every frame, which roughly halves the frame rate on
  // a Retina-class canvas. Flip to false to drop it if that cost ever needs to go.
  const REFLECTION_ENABLED = true;
  const reflectionStrength = uniform(0.16);
  let mirror = null;
  if (REFLECTION_ENABLED) {
    const groundReflection = reflector({
      resolutionScale: mobile ? 0.5 : 1,
      generateMipmaps: true,
      bounces: false,
      samples: mobile ? 0 : 4,
    });
    const mirrorMaterial = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    });
    mirrorMaterial.colorNode = groundReflection.level(
      float(mobile ? 1.7 : 1.5)
        .add(positionWorld.xz.length().mul(mobile ? 0.11 : 0.08))
        .min(3.2),
    );
    mirrorMaterial.opacityNode = reflectionStrength.mul(
      float(1).sub(positionWorld.xz.length().smoothstep(8, 40)),
    );
    mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      mirrorMaterial,
    );
    mirror.rotation.x = -Math.PI / 2;
    mirror.position.y = 0.002;
    mirror.add(groundReflection.target);
    scene.add(mirror);
  }
  composer = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode("output");
  // Bloom. Left out of the output graph it never renders, which is a cheap way to A/B it.
  const BLOOM_ENABLED = true;
  bloom = bloomNode(sceneColor, 0.15, 0.07, 0.5);
  composer.outputNode = BLOOM_ENABLED ? sceneColor.add(bloom) : sceneColor;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  draco.setWorkerLimit(2);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync("/assets/final.glb", (e) => {
    $("#load-progress").style.width =
      (e.total ? Math.min(90, (e.loaded / e.total) * 90) : 45) + "%";
  });
  car = gltf.scene;
  const box = new THREE.Box3().setFromObject(car),
    center = box.getCenter(new THREE.Vector3());
  let tireBottom = Infinity;
  car.traverse((o) => {
    if (o.isMesh && /tyre/i.test(o.name))
      tireBottom = Math.min(
        tireBottom,
        new THREE.Box3().setFromObject(o).min.y,
      );
  }); // Normalize the asset around its own geometric centre, then ground the entire rig.
  const rig = new THREE.Group();
  rig.name = "Artura centred pivot";
  car.position.sub(center);
  rig.position.y =
    center.y - (Number.isFinite(tireBottom) ? tireBottom : box.min.y);
  rig.add(car);
  scene.add(rig);
  rig.updateMatrixWorld(true);
  orbitCenter.copy(
    new THREE.Box3().setFromObject(car).getCenter(new THREE.Vector3()),
  );
  presets.overview.target = orbitCenter.toArray();
  controls.target.copy(orbitCenter);
  focusTarget.copy(orbitCenter);
  syncOrbit();
  // ---- 风阻模式：空中流线 -----------------------------------------------------
  // 流线不再是套在车外的假拱形，而是先射线探测车身真实曲面（站位 × 横向网格），
  // 再让每一条线贴着车顶/引擎盖的起伏走；管体两端收细成尖梢并渐隐，像风掠过的痕迹。
  const carBox = new THREE.Box3().setFromObject(car);
  const carSize = carBox.getSize(new THREE.Vector3());
  const carLengthAxisX = carSize.x >= carSize.z; // 车长轴判定（车漆反光条纹也用它）
  const L = carLengthAxisX ? carSize.x : carSize.z;
  const W = carLengthAxisX ? carSize.z : carSize.x;
  const H = carSize.y;
  const stations = 16; // 车长方向探测站位
  const lateralSamples = 11; // 横向探测采样
  const duCS = L / (stations - 1); // 网格单元（沿车长）
  const lateralMax = W * 0.62;
  // 平滑最大值：折角处圆润过渡（k 越大越圆），避免"平滑后取原始最大"造成硬折
  const smax = (a, b, k) =>
    0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
  // 1) 俯视半宽：每个站位水平射一条线取车宽。用于让流线在车头/车尾收拢，并判断线条是否已越出车身
  const halfWidths = [];
  {
    const ray = new THREE.Raycaster();
    const sideY = carBox.min.y + H * 0.42; // 腰线高度（车身最宽处附近）
    for (let i = 0; i < stations; i++) {
      const u = (i / (stations - 1) - 0.5) * L;
      const o = carLengthAxisX
        ? new THREE.Vector3(u, sideY, W)
        : new THREE.Vector3(W, sideY, u);
      const d = carLengthAxisX
        ? new THREE.Vector3(-1, 0, 0)
        : new THREE.Vector3(0, 0, -1);
      ray.set(o, d);
      const hit = ray.intersectObject(car, true)[0];
      halfWidths.push(
        hit ? Math.abs(carLengthAxisX ? hit.point.z : hit.point.x) : 0,
      );
    }
    const n = halfWidths.length;
    for (let i = 0; i < n; i++) {
      // 车体外的站位（未命中）向最近的命中值靠拢
      if (halfWidths[i] > 0) continue;
      for (let d = 1; d < n; d++) {
        if (i - d >= 0 && halfWidths[i - d] > 0) {
          halfWidths[i] = halfWidths[i - d];
          break;
        }
        if (i + d < n && halfWidths[i + d] > 0) {
          halfWidths[i] = halfWidths[i + d];
          break;
        }
      }
      if (!(halfWidths[i] > 0)) halfWidths[i] = W * 0.5;
    }
    for (let pass = 0; pass < 3; pass++)
      for (let i = 1; i < n - 1; i++)
        halfWidths[i] =
          (halfWidths[i - 1] + halfWidths[i] * 2 + halfWidths[i + 1]) / 4;
  }
  const maxHalfWidth = Math.max(...halfWidths, 1e-6);
  // 某站位处的车身半宽
  function halfWidthAt(u) {
    const fi = THREE.MathUtils.clamp(
      (u / L + 0.5) * (stations - 1),
      0,
      stations - 1,
    );
    const i0 = Math.floor(fi),
      i1 = Math.min(stations - 1, i0 + 1),
      ti = fi - i0;
    return halfWidths[i0] * (1 - ti) + halfWidths[i1] * ti;
  }
  // 俯视收拢系数：车身最宽处为 1，车头/车尾按实际半宽收窄（下限 0.7 避免过度内收）
  function lateralScale(u) {
    return 0.7 + 0.3 * Math.min(1, halfWidthAt(u) / maxHalfWidth);
  }
  // 2) 车身表面网格：从上往下打射线，记录每个（站位 × 横向）的表面高度
  const profile = [];
  {
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3();
    for (let i = 0; i < stations; i++) {
      const u = (i / (stations - 1) - 0.5) * L;
      const row = [];
      for (let j = 0; j < lateralSamples; j++) {
        const w = (j / (lateralSamples - 1) - 0.5) * 2 * lateralMax;
        origin.set(
          carLengthAxisX ? u : w,
          carBox.max.y + H,
          carLengthAxisX ? w : u,
        );
        ray.set(origin, down);
        const hit = ray.intersectObject(car, true);
        row.push(hit.length ? hit[0].point.y : null);
      }
      const isFill = row.map((v) => v === null); // 真正命中的采样点（后视镜等凸起）不能被下面的衰减压掉
      if (row.every((v) => v === null)) row.fill(carBox.max.y - H * 0.12);
      let acc = null; // 车体外没有命中的采样点，向外延伸最近的表面高度
      for (let j = 0; j < row.length; j++)
        if (row[j] === null) row[j] = acc;
        else acc = row[j];
      acc = null;
      for (let j = row.length - 1; j >= 0; j--)
        if (row[j] === null) row[j] = acc;
        else acc = row[j];
      // 填充值再向外衰减：如果只做等高平台，"车体外"的高度会被算得过高，
      // 线条既压不下去，还会在车头/车尾的轮廓收缩处鼓出折点
      const hw = halfWidthAt(u),
        base = H * 0.15;
      for (let j = 0; j < lateralSamples; j++) {
        if (!isFill[j]) continue;
        const w = Math.abs((j / (lateralSamples - 1) - 0.5) * 2 * lateralMax);
        const s = THREE.MathUtils.smoothstep((w - hw) / (W * 0.35), 0, 1);
        if (s > 0) row[j] = row[j] * (1 - s) + base * s;
      }
      profile.push(row);
    }
    // 平滑只为让曲线顺滑，但后视镜等局部凸起不能因此被抹掉 —— 用平滑最大值代替硬 max，
    // 折角圆润过渡，不会再留下硬折线（硬 max 正是曲线不够圆润的主因）
    const profileRaw = profile.map((r) => r.slice());
    const passes = Math.max(0, Math.round(TUNING.aeroSmooth));
    const bump = H * 0.02;
    for (let pass = 0; pass < passes; pass++) {
      const src = profile.map((r) => r.slice());
      for (let i = 0; i < stations; i++)
        for (let j = 0; j < lateralSamples; j++) {
          const up = src[Math.max(0, i - 1)][j];
          const dn = src[Math.min(stations - 1, i + 1)][j];
          const lf = src[i][Math.max(0, j - 1)];
          const rt = src[i][Math.min(lateralSamples - 1, j + 1)];
          // 纵向权重更高（车长方向的起伏最需要顺），横向只做很轻的过渡，免得把侧缘抬平
          profile[i][j] =
            (up + dn) * 0.235 + (lf + rt) * 0.03 + src[i][j] * 0.47;
        }
    }
    for (let i = 0; i < stations; i++)
      for (let j = 0; j < lateralSamples; j++)
        profile[i][j] = smax(profile[i][j], profileRaw[i][j], bump);
  }
  // 2.5) 沿车长方向的"局部最高"：把后视镜/尾翼之类凸起提前、平滑地垫到前后站位上。
  // 关键是只在网格节点上取一次最大值，查询时只做双三次插值 ——
  // 如果改成"每次查询都取邻域最大"，最大值在相邻节点间跳变，曲线就会一格一格地出现折点
  const inflated = [];
  {
    const radius = Math.max(1, Math.round((L * TUNING.aeroReach) / duCS));
    const k = H * 0.05;
    for (let i = 0; i < stations; i++) {
      const row = [];
      for (let j = 0; j < lateralSamples; j++) {
        let h = profile[i][j];
        for (let a = 1; a <= radius; a++)
          h = smax(
            smax(h, profile[Math.max(0, i - a)][j], k),
            profile[Math.min(stations - 1, i + a)][j],
            k,
          );
        row.push(h);
      }
      inflated.push(row);
    }
  }
  // 3) 表面高度查询：双三次 Catmull-Rom 插值（比双线性高一阶，格边界不会留下折角）
  const cubic = (p0, p1, p2, p3, t) =>
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  function surfaceY(u, w, grid = profile) {
    const fi = THREE.MathUtils.clamp(
      (u / L + 0.5) * (stations - 1),
      0,
      stations - 1,
    );
    const i1 = Math.floor(fi),
      ti = fi - i1,
      i0 = Math.max(0, i1 - 1),
      i2 = Math.min(stations - 1, i1 + 1),
      i3 = Math.min(stations - 1, i1 + 2);
    const fj =
      THREE.MathUtils.clamp((w / lateralMax) * 0.5 + 0.5, 0, 1) *
      (lateralSamples - 1);
    const j1 = Math.floor(fj),
      tj = fj - j1,
      j0 = Math.max(0, j1 - 1),
      j2 = Math.min(lateralSamples - 1, j1 + 1),
      j3 = Math.min(lateralSamples - 1, j1 + 2);
    const row = (i) => {
      const r = grid[i];
      return cubic(r[j0], r[j1], r[j2], r[j3], tj);
    };
    return cubic(row(i0), row(i1), row(i2), row(i3), ti);
  }
  // 3.5) 侧缘高度：固定在 0.85 半宽处采样（随半宽连续移动），再沿车长平滑成一条光滑的一维曲线。
  // 不用"最外侧命中"——半宽收缩时命中列会逐列跳变，那条曲线在车头/车尾会带折点
  const edgeYs = [];
  {
    for (let i = 0; i < stations; i++) {
      const u = (i / (stations - 1) - 0.5) * L;
      edgeYs.push(surfaceY(u, halfWidthAt(u) * 0.85));
    }
    const n = edgeYs.length,
      E = Math.max(0, Math.round(TUNING.aeroEdgeSmooth));
    for (let pass = 0; pass < E; pass++)
      for (let i = 1; i < n - 1; i++)
        edgeYs[i] = (edgeYs[i - 1] + edgeYs[i] * 2 + edgeYs[i + 1]) / 4;
  }
  function edgeYAt(u) {
    const fi = THREE.MathUtils.clamp(
      (u / L + 0.5) * (stations - 1),
      0,
      stations - 1,
    );
    const i0 = Math.floor(fi),
      i1 = Math.min(stations - 1, i0 + 1),
      ti = fi - i0;
    return edgeYs[i0] * (1 - ti) + edgeYs[i1] * ti;
  }
  // 安全下限 = 沿车长传播过的局部最高面（后视镜/凸起都在里面），再加一层硬间隙
  function clearanceY(u, w) {
    return surfaceY(u, w, inflated);
  }
  // 流线高度：车体内贴着车顶/引擎盖的起伏走；越出车身轮廓的部分随侧缘轮廓下压贴住车身，
  // 形成"包住车"的观感（over=0 在车体内，over=1 已在车外 0.3 车宽）
  function lineY(u, w) {
    const hw = Math.max(1e-4, halfWidthAt(u));
    const wrap =
      TUNING.aeroWrap *
      THREE.MathUtils.smoothstep((Math.abs(w) - hw) / (W * 0.3), 0, 1);
    const inner = clearanceY(u, w) + H * TUNING.aeroClearance;
    const outer = edgeYAt(u) + H * TUNING.aeroFlankClear;
    const target = inner * (1 - wrap) + Math.min(inner, outer) * wrap;
    return smax(target, clearanceY(u, w) + H * TUNING.aeroFloor, H * 0.02);
  }
  // 两端收细的管体（TubeGeometry 半径恒定，这里按曲线参数逐环缩放，末端收到尖）
  function taperedTube(curve, segs, radial, radius) {
    const frames = curve.computeFrenetFrames(segs, false);
    const ease = (x) => {
      const c = THREE.MathUtils.clamp(x, 0, 1);
      return c * c * (3 - 2 * c);
    };
    const position = [],
      normal = [],
      uvs = [],
      index = [];
    const P = new THREE.Vector3();
    const step = (Math.PI * 2) / radial;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      curve.getPointAt(t, P);
      // 头 16% / 尾 22% 区间收细，中段最粗 → 两头细、渐次消失
      const k = ease(t / 0.16) * ease((1 - t) / 0.22);
      const r = radius * Math.max(0.02, k);
      const N = frames.normals[s],
        B = frames.binormals[s];
      for (let j = 0; j <= radial; j++) {
        const th = step * j,
          cs = Math.cos(th),
          sn = Math.sin(th);
        position.push(
          P.x + r * (cs * N.x + sn * B.x),
          P.y + r * (cs * N.y + sn * B.y),
          P.z + r * (cs * N.z + sn * B.z),
        );
        normal.push(
          cs * N.x + sn * B.x,
          cs * N.y + sn * B.y,
          cs * N.z + sn * B.z,
        );
        uvs.push(t, j / radial);
      }
    }
    for (let s = 1; s <= segs; s++)
      for (let j = 1; j <= radial; j++) {
        const a = (radial + 1) * (s - 1) + (j - 1),
          b = (radial + 1) * s + (j - 1),
          c = (radial + 1) * s + j,
          d = (radial + 1) * (s - 1) + j;
        index.push(a, b, d, b, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setIndex(index);
    g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    return g;
  }
  const aeroGroup = new THREE.Group();
  aeroGroup.visible = false;
  const lineColor = new THREE.Color(TUNING.aeroLineColor);
  const pt = (u, y, w) =>
    carLengthAxisX ? new THREE.Vector3(u, y, w) : new THREE.Vector3(w, y, u);
  // 移动端按比例折减线条数量，避免小屏 GPU 上过密（只是数量，形态完全一致）
  const lineCount = Math.max(
    2,
    Math.round(TUNING.aeroLineCount * (mobile ? TUNING.aeroMobileScale : 1)),
  );
  const baseRadius = Math.max(0.0012, L * TUNING.aeroLineRadius);
  // 三次 Hermite：给定两端点值与两端斜率，端点接得上、中途不会拐硬角
  const hermite = (p0, m0, p1, m1, f) => {
    const f2 = f * f,
      f3 = f2 * f;
    return (
      (2 * f3 - 3 * f2 + 1) * p0 +
      (f3 - 2 * f2 + f) * m0 +
      (-2 * f3 + 3 * f2) * p1 +
      (f3 - f2) * m1
    );
  };
  // 三次均匀 B 样条：输入等距控制点，输出 out 个 C2 连续的点。
  // 与 Catmull-Rom（仅 C1）相比，连曲率都连续 —— 控制点处不会再有"曲率跳一下"的棱感
  const bSpline = (src, out) => {
    const n = src.length;
    const cp = (i) => src[Math.min(n - 1, Math.max(0, i))];
    const res = new Array(out);
    for (let s = 0; s < out; s++) {
      const f = (s / (out - 1)) * (n - 1);
      const i = Math.min(n - 2, Math.floor(f));
      const u = Math.min(1, f - i);
      const p0 = cp(i - 1),
        p1 = cp(i),
        p2 = cp(i + 1),
        p3 = cp(i + 2);
      const u2 = u * u,
        u3 = u2 * u;
      const b0 = (1 - 3 * u + 3 * u2 - u3) / 6;
      const b1 = (4 - 6 * u2 + 3 * u3) / 6;
      const b2 = (1 + 3 * u + 3 * u2 - 3 * u3) / 6;
      const b3 = u3 / 6;
      res[s] = new THREE.Vector3(
        p0.x * b0 + p1.x * b1 + p2.x * b2 + p3.x * b3,
        p0.y * b0 + p1.y * b1 + p2.y * b2 + p3.y * b3,
        p0.z * b0 + p1.z * b1 + p2.z * b2 + p3.z * b3,
      );
    }
    return res;
  };
  for (let i = 0; i < lineCount; i++) {
    const k = i / (lineCount - 1);
    const off = (k - 0.5) * W * TUNING.aeroSpread; // 横向铺开；越出车身的部分只留一点
    const seed = Math.sin(i * 12.9898) * 43758.5453;
    const rnd = seed - Math.floor(seed);
    // 每条线长度略有差异，像被风撕开的流线；同时保证整体都够长
    const a0 = -TUNING.aeroLead * (0.7 + 0.3 * rnd);
    const b0 = 1 + TUNING.aeroTrail * (0.7 + 0.3 * rnd);
    // 横向位置只由曲线参数 t 决定（含轻微横漂），延长段用同一函数取值 → 接点处不会错位折一下
    const latAt = (t) =>
      off * lateralScale((t - 0.5) * L) + Math.sin(t * 2 + i * 1.7) * W * 0.006;
    const eps = 0.06;
    const yNose = lineY(-L * 0.5, latAt(0)),
      yNoseIn = lineY(-L * 0.5 + eps * L, latAt(eps)),
      yTail = lineY(L * 0.5, latAt(1)),
      yTailIn = lineY(L * 0.5 - eps * L, latAt(1 - eps));
    const wN = latAt(0),
      wNi = latAt(eps),
      wT = latAt(1),
      wTi = latAt(1 - eps);
    // 横向：Hermite 延续车头/车尾的走势（车头略收、车尾略张），首端斜率与车身段对齐
    const wAt = (t) => {
      if (t < 0) return hermite(wN, (wN - wNi) * -a0, wN * 0.95, 0, t / a0);
      if (t > 1)
        return hermite(
          wT,
          (wT - wTi) * (b0 - 1),
          wT * 1.1,
          0,
          (t - 1) / (b0 - 1),
        );
      return latAt(t);
    };
    // 纵向：同样用 Hermite —— 首端斜率接住车身段（C1 连续），远端平滑地下压
    const yAt = (t) => {
      if (t < 0)
        return hermite(
          yNose,
          (yNose - yNoseIn) * -a0,
          yNose - H * TUNING.aeroNoseDip,
          0,
          t / a0,
        );
      if (t > 1)
        return hermite(
          yTail,
          (yTail - yTailIn) * (b0 - 1),
          yTail - H * TUNING.aeroTrailDip,
          0,
          (t - 1) / (b0 - 1),
        );
      return lineY((t - 0.5) * L, latAt(t));
    };
    // ① 沿整条线（含两端的延长段）等距采样：采样间距一致，CatmullRom 才不会在接点处拐硬角
    const samples = Math.max(24, Math.round((b0 - a0) * 76));
    const raw = [];
    for (let s = 0; s <= samples; s++) {
      const t = a0 + (b0 - a0) * (s / samples);
      raw.push(pt((t - 0.5) * L, yAt(t), wAt(t)));
    }
    // ①.5 先在这批均匀采样点上轻度平滑：抹掉安全下限留下的细微台阶，
    //     同时保留车头/车顶/车尾的整体起伏（下面还有兜底，不会因为平滑而沉进车身）
    for (let pass = 0; pass < 3; pass++)
      for (let s = 1; s < raw.length - 1; s++)
        raw[s].y = (raw[s - 1].y + raw[s].y * 2 + raw[s + 1].y) / 4;
    // ② 曲线密采样 → 净空兜底 → 多遍平滑 → 再兜底，扫掉折点，走向更圆润
    const dense = new THREE.CatmullRomCurve3(raw).getSpacedPoints(160);
    const clampFloor = (p) => {
      // 车体之外是自由空间：安全下限平滑地"让开"，尾流才能自然地潜下去，端点处也不会折一下
      const out = THREE.MathUtils.smoothstep(
        Math.abs(carLengthAxisX ? p.x : p.z),
        L * 0.46,
        L * 0.58,
      );
      const floorY =
        (clearanceY(carLengthAxisX ? p.x : p.z, carLengthAxisX ? p.z : p.x) +
          H * TUNING.aeroFloor) *
          (1 - out) -
        H * 0.6 * out;
      p.y = smax(p.y, floorY, H * 0.012);
      return p;
    };
    let safe = dense.map(clampFloor);
    const smoothPasses = Math.max(0, Math.round(TUNING.aeroLineSmooth));
    for (let pass = 0; pass < smoothPasses; pass++) {
      const src = safe.map((p) => p.clone());
      for (let s = 1; s < safe.length - 1; s++)
        safe[s].y = (src[s - 1].y + src[s].y * 2 + src[s + 1].y) / 4;
    }
    // ③ B 样条重采样：控制点从 161 加密到 320 且曲率连续，管体走线不再有"一棱一棱"的曲率跳变；
    //    这里的二阶差分已被上面的平滑压得很小，重采样点相对控制点的内缩远小于净空余量，
    //    所以贴轮廓的程度不受影响（下面还会再兜底一次）
    safe = bSpline(safe, 320);
    safe = safe.map(clampFloor);
    for (let pass = 0; pass < 2; pass++) {
      const src = safe.map((p) => p.clone());
      for (let s = 1; s < safe.length - 1; s++)
        safe[s].y = (src[s - 1].y + src[s].y * 2 + src[s + 1].y) / 4;
    }
    safe = safe.map(clampFloor);
    const curve = new THREE.CatmullRomCurve3(safe);
    const tubeMat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const x = uv().x;
    // 线条序号走 uniform 而不是把 i 写死进节点图：34 条线的着色代码因此完全一致，
    // 管线只需编译一份（写死常量的话每条线都是一份独立的着色程序，首次进入会卡一下）
    const lineIdx = uniform(i);
    // ---- 阵风：线条不再常驻发光，而是一阵一阵地掠过，间隙里彻底看不见 ----
    // 相位 = 沿线推进 × 段数 + 时间推进（乘方向才是真的反向）+ 噪声抖动。
    // 均匀的 fract 会读成跑马灯，抖一下才是风。
    const phase = x
      .mul(TUNING.aeroGustCount)
      .mul(TUNING.aeroDirection)
      .sub(time.mul(TUNING.aeroFlowSpeed))
      .add(lineIdx.mul(0.618));
    const seg = fract(
      phase.add(
        mx_noise_float(
          vec3(phase.mul(1.7), lineIdx.mul(3.1), time.mul(0.17)),
        ).mul(TUNING.aeroGustVar),
      ),
    );
    // 占空比：只把锯齿的前 aeroGustDuty 段留作「有风」，其余整段为 0 —— 线条有一段完全看不见
    const b = seg.div(TUNING.aeroGustDuty);
    const gust = smoothstep(0, 0.16, b).mul(smoothstep(1, 0.6, b)); // 风痕窗口（b > 1 处恒为 0）
    const tail = float(1).sub(b.saturate()).pow(1.5); // 前缘亮、往后拖淡，像被风拉出来的痕
    // 强弱起伏：同一条线不同时段、不同线条同一时刻的阵风强度都不同
    const burst = float(0.55)
      .add(
        mx_noise_float(
          vec3(lineIdx.mul(7.3), time.mul(TUNING.aeroGustRate), 0),
        ).mul(TUNING.aeroGustBurst * 1.4),
      )
      .saturate();
    const tipFade = smoothstep(0, 0.15, x).mul(smoothstep(1, 0.78, x)); // 与几何锥度同步的渐隐
    tubeMat.colorNode = uniform(lineColor)
      .mul(float(TUNING.aeroBaseGlow).add(gust.mul(tail).mul(2).mul(burst)))
      .mul(tipFade)
      .mul(aeroMix);
    aeroGroup.add(
      new THREE.Mesh(
        taperedTube(curve, 320, 16, baseRadius * (0.8 + 0.5 * rnd)),
        tubeMat,
      ),
    );
  }
  scene.add(aeroGroup);
  // ---- 变色：水墨扩散 ---------------------------------------------------------
  // 换色不做整体 lerp，而是让新颜色像墨滴入水一样从墨心洇开：以车身包围盒里一个可调的
  // 种子点为中心算归一化距离场，用两级噪声（大墨团 + 细墨丝）+ 低频域扭曲扰动前沿，
  // 前沿外侧留一圈半透明渗透、前沿上压一道略深的「湿边」并让漆面稍失镜面感 —— 读起来
  // 才是水墨，而不是一块渐变的遮罩。全部在物体世界空间采样，跨钣金无接缝。
  const inkSeed = uniform(
    carBox
      .getCenter(new THREE.Vector3())
      .add(
        new THREE.Vector3(
          TUNING.inkSeed[0] * carSize.x * 0.5,
          TUNING.inkSeed[1] * carSize.y * 0.5,
          TUNING.inkSeed[2] * carSize.z * 0.5,
        ),
      ),
  );
  const inkFrom = uniform(new THREE.Color(paints[state.color].hex)); // 变色前颜色
  const inkTo = uniform(new THREE.Color(paints[state.color].hex)); // 变色后颜色
  const inkFront = uniform(99); // 前沿位置（归一化距离域；99 = 全车已是新色）
  const inkSeal = uniform(1); // 收尾因子：扩散最后 16% 把残余的边角整体平滑补齐，不会有硬跳
  const inkRel = positionWorld.sub(inkSeed);
  // 归一化距离场：0 = 墨心，1 ≈ 车长的一半；竖直方向加权，车顶比车头车尾稍晚染到
  const dInk = vec3(inkRel.x, inkRel.y.mul(TUNING.inkSquash), inkRel.z)
    .length()
    .div(L * 0.5);
  // 噪声坐标：沿车长方向拉伸（同一频率下墨丝更长），横向略密
  const nAxis = carLengthAxisX ? vec3(0.55, 0.9, 1.7) : vec3(1.7, 0.9, 0.55);
  const nq = positionWorld.mul(nAxis);
  const nBlotch = mx_noise_float(
    nq.mul(TUNING.inkBlotchScale).add(vec3(11.3, 4.7, 2.9)),
  );
  const nTendril = mx_noise_float(
    nq.mul(TUNING.inkTendrilScale).add(vec3(-3.1, 8.2, 5.4)),
  );
  // 低频域扭曲在移动端省掉（少一次 3D perlin，漆面片元开销大约减三分之一）
  const nWarp = mobile
    ? float(0)
    : mx_noise_float(positionWorld.mul(0.55).add(vec3(17.3, 5.1, 9.7)));
  const dField = dInk
    .sub(nBlotch.mul(TUNING.inkBlotch))
    .sub(nTendril.mul(TUNING.inkTendril))
    .sub(nWarp.mul(TUNING.inkWarp));
  const inkCore = smoothstep(
    inkFront.add(TUNING.inkSoft),
    inkFront.sub(TUNING.inkSoft),
    dField,
  );
  const inkBleed = smoothstep(
    inkFront.add(TUNING.inkSoft + TUNING.inkBleed),
    inkFront.add(TUNING.inkSoft * 0.5),
    dField,
  ).mul(TUNING.inkBleedAmount);
  const inkMask = inkCore.max(inkBleed).max(inkSeal);
  const inkWet = inkCore.mul(float(1).sub(inkCore)).mul(4).mul(TUNING.inkWet); // 边界处取最大
  const inkPaint = mix(inkFrom, inkTo, inkMask).mul(float(1).sub(inkWet));
  let inkT = 1; // 扩散进度（1 = 已完成）
  const triggerInk = (from, to) => {
    inkFrom.value.copy(from);
    inkTo.value.copy(to);
    inkT = reducedMotion ? 1 : 0;
    inkFront.value = reducedMotion ? 99 : TUNING.inkStart;
    inkSeal.value = reducedMotion ? 1 : 0;
  };
  inkTrigger = triggerInk;
  const materialCache = new Map();
  function materialFor(src) {
    if (materialCache.has(src.uuid)) return materialCache.get(src.uuid);
    const name = src.name;
    let m;
    const basic = { name, side: THREE.FrontSide };
    if (/^carpaint$|^carpaint_copy$/.test(name)) {
      // Candy paint: deep translucent colour coat under a sharp transparent clearcoat film.
      // Fresnel deepens the colour at facing angles and lifts it at grazing angles; the
      // low-roughness clearcoat layer supplies the bright mirror-like film reflections.
      m = new THREE.MeshPhysicalNodeMaterial({
        ...basic,
        metalness: 0.34,
        roughness: 0.28,
        clearcoat: 1,
        clearcoatRoughness: 0,
        envMapIntensity: 1.9,
      });
      const film = pow(
        float(1).sub(normalView.dot(positionViewDirection).saturate()),
        2.2,
      );
      // 换色：水墨扩散（inkPaint 由 inkFrom/inkTo + 噪声前沿的混合掩码组成）
      m.colorNode = inkPaint.mul(mix(float(0.45), float(1.15), film));
      m.roughnessNode = float(0.28)
        .add(mx_noise_float(positionGeometry.mul(135)).mul(0.018))
        .add(inkWet.mul(TUNING.inkWetRough)); // 湿边稍失镜面感，像墨吃进漆面
      // 风阻模式：车身反光。不是把亮线画在车漆上，而是按「反射方向」去采样环绕车身的
      // 竖直光柱环境：视线反射向量绕车一周给出条纹、沿车长方向给出流动相位，再乘菲涅尔。
      // 相机绕车转动时亮纹会随曲率滑动、被压缩拉长，读起来是真实反光而不是贴上去的线。
      const Vto = cameraWorldPos.sub(positionWorld).normalize();
      const Rdir = reflect(Vto.negate(), normalWorld);
      const az = atan(Rdir.z, Rdir.x); // 环绕角 → 光柱分布
      const along = carLengthAxisX ? Rdir.x : Rdir.z;
      const phase = az
        .mul(TUNING.aeroPaintDensity)
        .add(along.mul(TUNING.aeroPaintFlow).mul(TUNING.aeroDirection))
        .sub(time.mul(TUNING.aeroFlowSpeed * 1.6));
      const stripe = smoothstep(0.08, 0.012, abs(fract(phase).sub(0.5)));
      const horizon = smoothstep(1, 0.12, abs(Rdir.y)); // 反射越贴近水平越亮（掠过车身侧面）
      m.emissiveNode = uniform(new THREE.Color(TUNING.aeroLineColor))
        .mul(stripe)
        .mul(horizon)
        .mul(film.mul(0.9).add(float(0.12)))
        .mul(aeroMix.mul(TUNING.aeroPaintStrength));
      paintMaterials.push(m);
    } else if (name === "glass_window")
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#30414d",
        metalness: 0.08,
        roughness: 0.065,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        transparent: true,
        opacity: 0.43,
        depthWrite: false,
        envMapIntensity: 0.7,
        side: THREE.DoubleSide,
      });
    else if (name === "glass")
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#d4e4ee",
        metalness: 0,
        roughness: 0.04,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        clearcoat: 1,
      });
    else if (name === "mirror")
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#d1dce1",
        metalness: 1,
        roughness: 0.03,
      });
    else if (name === "carbon")
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#141b20",
        metalness: 0.35,
        roughness: 0.31,
        clearcoat: 0.7,
        clearcoatRoughness: 0.22,
      });
    else if (name === "rim")
      // 轮毂发亮根因：金属面镜面反射峰值 ∝ 基色 × envMapIntensity，清漆层再叠一层与基色无关的
      // 白色锐利高光（clearcoat 0.5 ≈ 3 倍白闪）。转到特定方位时整组辐条正好反射 HDRI 亮光柱，
      // HDR 冲过 bloom 阈值 0.5 → 单个轮毂泛光，orbit 滑走就恢复。压 envMapIntensity + 收清漆
      // 是全角度物理降压，不靠某个机位标定。
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#45494e",
        metalness: 0.95,
        roughness: 0.32,
        clearcoat: 0.15,
        envMapIntensity: 0.55,
      });
    else if (name === "Material.003")
      // 轮胎（GLB 里没名字，叫 Material.003）：哑光橡胶，色深、几乎无镜面。
      // 用 Physical 是因为 specularIntensity/clearcoat 只在 Physical 上存在（Standard 上赋值会静默失效），
      // 清漆层会给胎肩添一圈与基色无关的白闪，转视角时最容易被读成「某个轮子在发光」。
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#171a1e",
        metalness: 0,
        roughness: 0.92,
        clearcoat: 0,
        envMapIntensity: 0.5,
        specularIntensity: 0.35,
      });
    else if (name === "leather_b")
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#24282c",
        metalness: 0,
        roughness: 0.85,
      });
    else if (name === "brake_disc")
      // 刹车盘 F0≈0.14 且从轮辐缝隙里正对相机，是轮区最大的镜面反射面；
      // 压 envMapIntensity + 摊粗糙度，避免某个方位扫过 HDRI 亮光柱时整盘发白（注意 Standard 无 specularIntensity）
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#666b6d",
        metalness: 0.86,
        roughness: 0.55,
        envMapIntensity: 0.4,
      });
    else if (name.startsWith("carpaint_"))
      // 刹车卡钳：橙色是刻意点缀，但 #e58921(线性反射率0.35)+metalness0.45+clearcoat0.5 让它成为
      // 夜间场景里轮区最亮的可见面（遮挡感知实测 HDR 0.57~0.64，超过 bloom 阈值 0.5 → 泛光 halo，
      // 初始视角下读成「某个轮毂自己发光」，orbit 转过轮辐/高光滑走才正常）。
      // 压暗基色 + 收清漆，让它落在 bloom 阈值之下，回到「深色轮毂里的橙色点缀」。嫌暗就抬 color。
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#b36616",
        map: src.map,
        metalness: 0.25,
        roughness: 0.42,
        clearcoat: 0.2,
      });
    else if (["turn_signal", "brake_light", "SBBR_middle"].includes(name)) {
      const front = ["turn_signal", "headlight_chrome"].includes(name);
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: front ? "#aab7c1" : "#650b13",
        metalness: front ? 0.7 : 0.12,
        roughness: 0.18,
        clearcoat: 1,
        emissive: front ? lightColor : rearColor,
        emissiveIntensity: 0,
      });
      emitters.push({
        m,
        front,
        gain: name === "headlight_chrome" ? 2.8 : front ? 7 : 3.5,
      });
    } else if (name === "SBBR_glass_main")
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#61101a",
        metalness: 0.1,
        roughness: 0.13,
        clearcoat: 1,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
      });
    else if (name === "headlight_chrome" || name === "SBBR_chrome")
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#afb9bf",
        metalness: 1,
        roughness: 0.16,
      });
    else if (name === "lens")
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#101a22",
        metalness: 0.5,
        roughness: 0.1,
        clearcoat: 1,
      });
    else if (
      name === "brake_disc_black" ||
      name === "brake_disc_black_offset" ||
      name === "brake_pad"
    )
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#262b30",
        metalness: 0.65,
        roughness: 0.6,
      });
    else if (name === "side_marks")
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#5d1512",
        roughness: 0.3,
      });
    else {
      m = src.clone();
      m.side = THREE.FrontSide;
      m.envMapIntensity = 0.8;
      if (name === "engine") {
        m.color.set("#3d4248");
        m.roughness = 0.48;
      }
      if (name === "exhaust_heat_shield") {
        m.color.set("#59544e");
        m.roughness = 0.6;
      }
      if (
        name === "plastic_black" ||
        name === "plastic_black_b" ||
        name === "plastic_rough"
      ) {
        m.color.set("#12171b");
        m.metalness = 0.05;
      }
    }
    if (name === "glass_window") glassMaterials.push(m);
    materialCache.set(src.uuid, m);
    return m;
  }
  car.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = !/glass|window/i.test(o.name);
      o.receiveShadow = true;
      o.material = Array.isArray(o.material)
        ? o.material.map(materialFor)
        : materialFor(o.material);
      if (/window|windshield|headlight_glass/i.test(o.name)) o.renderOrder = 3;
    }
  });
  // 大灯：光锥顶点在灯罩处、目标落在车前地面上（已回退为原实现的朝向与角度）；
  // 灯罩处另留一个很小的点光源做热光。
  const y = car.getWorldPosition(new THREE.Vector3()).y;
  const lensZ = 1.97 - center.z; // 灯罩位置（世界 z）
  for (const sign of [-1, 1]) {
    const p = new THREE.Vector3(sign * 0.71, y - 0.06, lensZ);
    headlightPositions.push(p);
    const beamZ = lensZ + TUNING.headlightBeamLead; // 光锥顶点：默认与灯罩同 z
    const spot = new THREE.SpotLight(
      0xcdeaff,
      0,
      TUNING.headlightBeamRange,
      TUNING.headlightBeamAngle,
      TUNING.headlightBeamPenumbra,
      1.3,
    );
    spot.position.set(sign * 0.71, p.y, beamZ);
    spot.target.position.set(
      sign * TUNING.headlightBeamSpread,
      0,
      beamZ + TUNING.headlightBeamReach,
    );
    scene.add(spot, spot.target);
    spotlights.push(spot);
    const glow = new THREE.PointLight(
      0xcdeaff,
      0,
      TUNING.headlightSpillRange,
      2,
    );
    glow.position.copy(p);
    scene.add(glow);
    spotlights.push(glow);
  }
  $("#load-progress").style.width = "100%";
  state.loaded = true;
  $("#loader").classList.add("loaded");
  host.setAttribute(
    "aria-label",
    "McLaren Artura loaded. Drag to rotate, scroll to zoom.",
  );
  controls.update();
  focusPart(state.view);
  resize();
  draco.dispose();
  const clock = new THREE.Clock();
  let lastTime = performance.now();
  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const now = performance.now(),
      dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const smooth = 1 - Math.exp(-dt * 6);
    colorNow.lerp(colorTarget, reducedMotion ? 1 : smooth); // 兜底色（不参与车漆着色）
    paintMaterials.forEach((m) => m.color.copy(colorNow));
    // 水墨扩散：前沿推进（先快后慢，像墨初落时铺得快、越铺越慢），结束后整体落到新色
    if (inkT < 1) {
      inkT = Math.min(1, inkT + dt / TUNING.inkDuration);
      inkFront.value =
        inkT >= 1
          ? 99
          : TUNING.inkStart +
            (TUNING.inkEnd - TUNING.inkStart) * (1 - Math.pow(1 - inkT, 1.9));
      inkSeal.value = inkT >= 1 ? 1 : THREE.MathUtils.smoothstep(inkT, 0.84, 1);
    }
    for (const m of glassMaterials) {
      m.opacity = THREE.MathUtils.lerp(
        m.opacity,
        state.view === "cockpit" ? 0.14 : 0.43,
        smooth,
      );
      m.envMapIntensity = THREE.MathUtils.lerp(
        m.envMapIntensity,
        state.view === "cockpit" ? 0.18 : 0.7,
        smooth,
      );
    }
    lightAmount = THREE.MathUtils.lerp(
      lightAmount,
      state.lights ? 1 : 0,
      reducedMotion ? 1 : smooth,
    );
    nightAmount = THREE.MathUtils.lerp(
      nightAmount,
      state.studio === "night" ? 1 : 0,
      reducedMotion ? 1 : 1 - Math.exp(-dt * 2.5),
    );
    // 风阻模式混合系数：向目标平滑过渡，驱动流线淡入和灯光压暗
    aeroAmount = THREE.MathUtils.lerp(
      aeroAmount,
      state.aero ? 1 : 0,
      reducedMotion ? 1 : smooth,
    );
    aeroMix.value = aeroAmount;
    if (aeroGroup) aeroGroup.visible = aeroAmount > 0.02;
    for (const { m, gain } of emitters)
      m.emissiveIntensity = lightAmount * gain;
    spotlights.forEach(
      (l, i) =>
        (l.intensity =
          lightAmount *
          (i % 2 === 0 ? TUNING.headlightBeam : TUNING.headlightSpill)),
    );
    scene.background
      .copy(bgDay)
      .lerp(bgNight, nightAmount)
      .multiplyScalar(1 - 0.55 * aeroAmount);
    floor.material.color
      .set("#c4c9cf")
      .lerp(new THREE.Color("#141b23"), nightAmount)
      .multiplyScalar(1 - 0.3 * aeroAmount);
    roofStrip.intensity = (2.8 - nightAmount * 1.4) * (1 - 0.7 * aeroAmount);
    shoulderStrip.intensity =
      (2.2 - nightAmount * 0.8) * (1 - 0.7 * aeroAmount);
    key.intensity = (0.5 - nightAmount * 0.3) * (1 - 0.7 * aeroAmount);
    ambient.intensity = 0.06 * debugState.ambientScale;
    fill.intensity = 0.15;
    rim.intensity = (0.35 + nightAmount * 0.35) * (1 - 0.5 * aeroAmount);
    scene.environmentIntensity =
      (TUNING.envIntensityDay - nightAmount * TUNING.envNightDrop) *
      debugState.envScale *
      (1 - TUNING.aeroDim * aeroAmount);
    reflectionStrength.value = 0.16 + nightAmount * 0.04;
    bloom.strength.value = debugState.bloomStrength * (1 + lightAmount * 2);
    if (animation) {
      const t = Math.min(1, (now - animation.start) / animation.duration);
      const e = t * t * t * (t * (6 * t - 15) + 10);
      const { a, b } = animation;
      focusTarget.lerpVectors(animation.fromTarget, animation.toTarget, e);
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(a.radius, b.radius, e) +
          Math.sin(Math.PI * e) * 1.35,
        THREE.MathUtils.lerp(a.phi, b.phi, e) - Math.sin(Math.PI * e) * 0.14,
        THREE.MathUtils.lerp(a.theta, b.theta, e),
      );
      camera.position
        .copy(focusTarget)
        .add(new THREE.Vector3().setFromSpherical(sph));
      camera.lookAt(focusTarget);
      camera.fov =
        THREE.MathUtils.lerp(animation.fromFov, 30, e) +
        Math.sin(Math.PI * e) * 5;
      camera.updateProjectionMatrix();
      if (t === 1) {
        animation = null;
        state.transitioning = false;
        controls.enabled = true;
        syncOrbit();
      }
    } else updateOrbit();
    composer.render();
  }
  function resize() {
    const w = host.clientWidth,
      h = host.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  new ResizeObserver(resize).observe(host);
  frame();
  window.artura = {
    getState: () => ({ ...state }),
    setColor,
    setLights,
    setStudio,
    setAero,
    focusPart,
  };
  debugState.baseExposure = renderer.toneMappingExposure;
  attachDebugPanel();
  setDebug(location.hash.includes("debug"));
  addEventListener("hashchange", () =>
    setDebug(location.hash.includes("debug")),
  );
  window.artura.debug = {
    state: debugState,
    setDebug,
    setPaintProperty,
    paintMaterials,
    renderer: () => renderer,
    scene: () => scene,
    composer: () => composer,
    sceneColor: () => sceneColor,
    mirror: () => mirror,
  };
  if (renderer.inspector)
    console.info("[debug] renderer.inspector is available");
  // Structured configuration actions share exactly the same state as the visible controls.
  if (document.modelContext?.registerTool) {
    const lifecycle = new AbortController();
    window.addEventListener("pagehide", () => lifecycle.abort(), {
      once: true,
    });
    const tool = {
      name: "configure_artura",
      title: "Configure Artura",
      description:
        "Change the visible Artura paint, studio illumination, headlights, or camera focus.",
      inputSchema: {
        type: "object",
        properties: {
          color: { type: "string", enum: Object.keys(paints) },
          studio: { type: "string", enum: ["day", "night"] },
          lights: { type: "boolean" },
          view: { type: "string", enum: Object.keys(presets) },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).some(
            (k) => !["color", "studio", "lights", "view"].includes(k),
          )
        )
          throw new Error("Invalid configuration");
        if (
          (input.color !== undefined && !paints[input.color]) ||
          (input.studio !== undefined &&
            !["day", "night"].includes(input.studio)) ||
          (input.view !== undefined && !presets[input.view]) ||
          (input.lights !== undefined && typeof input.lights !== "boolean")
        )
          throw new Error("Invalid configuration value");
        if (input.color !== undefined) setColor(input.color);
        if (input.studio !== undefined) setStudio(input.studio);
        if (input.lights !== undefined) setLights(input.lights);
        if (input.view !== undefined) focusPart(input.view);
        await new Promise((resolve) =>
          setTimeout(resolve, reducedMotion ? 0 : 2350),
        );
        return { ...state };
      },
    };
    Promise.resolve(
      document.modelContext.registerTool(tool, { signal: lifecycle.signal }),
    ).catch(console.warn);
  }
}
