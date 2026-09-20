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
  positionWorld,
  positionGeometry,
  mx_noise_float,
  mx_worley_noise_float,
  float,
  normalView,
  positionViewDirection,
  mix,
  pow,
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
  studio: "day",
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
  lightAmount = 0,
  nightAmount = 0,
  raf = 0;
let glassMaterials = [],
  paintMaterials = [],
  emitters = [],
  spotlights = [],
  headlightPositions = [];
// Debug mode (#debug in the URL). Environment/ambient are recomputed every frame, so the panel keeps
// multipliers that the render loop applies; paint clearcoat values are written straight onto the materials.
const debugState = {
  active: false,
  envScale: 1,
  ambientScale: 1,
  baseExposure: 1,
  bloomStrength: 0.1,
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
const presets = {
  overview: { pos: [4.0, 1.71, 4.4], target: [0, 0.68, 0], name: "Overview" },
  front: {
    pos: [2.3, 1.05, 5.1],
    target: [0, 0.63, 1.54],
    name: "Front signature",
  },
  wheels: {
    pos: [3.05, 0.8, 2.4],
    target: [0.88, 0.36, 1.19],
    name: "Forged wheels",
  },
  side: {
    pos: [4.15, 1.5, -0.65],
    target: [0.6, 0.82, -0.2],
    name: "Aerodynamics",
  },
  cockpit: {
    pos: [1.56, 1.63, 1.67],
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
  colorTarget.set(paints[id].hex);
  if (reducedMotion) colorNow.copy(colorTarget);
  document.querySelectorAll(".swatch").forEach((b) => {
    const s = b.dataset.color === id;
    b.classList.toggle("selected", s);
    b.setAttribute("aria-pressed", String(s));
  });
  $("#paint-name").textContent = paints[id].name;
  $("#paint-subtitle").innerHTML =
    `${paints[id].cn} <span>·</span> ${paints[id].finish}`;
  $("#summary-color").textContent = paints[id].name;
  $("#summary-chip").style.background = paints[id].hex;
  $("#paint-line-color").style.background = paints[id].hex;
  $("#paint-counter").textContent =
    `0${Object.keys(paints).indexOf(id) + 1} — 06`;
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
    $("#dbg-env").value = 1;
    $("#dbg-ambient").value = 1;
    $("#dbg-exposure").value = debugState.baseExposure;
    $("#dbg-coat").value = 1;
    $("#dbg-coat-r").value = 0;
    $("#dbg-envmap").value = 1.9;
    $("#dbg-bloom").value = 0.1;
    $("#dbg-bloom-r").value = 0.15;
    $("#dbg-bloom-t").value = 0.5;
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
  $("#lights-label").textContent = state.lights
    ? "Headlights on"
    : "Signature LEDs & rear lights";
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
function cameraPosition(p) {
  const v = new THREE.Vector3(...p.pos);
  if (
    host.clientWidth / host.clientHeight < 1.05 &&
    state.view === "overview"
  ) {
    v.multiplyScalar(1.34);
    v.y = 3.1;
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
  $("#focus-name").textContent = presets[id].name;
  $("#focus-number").textContent =
    `0${Object.keys(presets).indexOf(id) + 1} / 06`;
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
$("#reset").addEventListener("click", () => focusPart("overview"));
$("#retry").addEventListener("click", () => location.reload());
function fail(e) {
  console.error(e);
  $("#load-label").textContent = "Unable to load the studio. Please try again.";
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
  renderer.toneMappingExposure = 1.3;
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
  $("#load-label").textContent = "Loading the HDRI studio";
  const hdri = await new HDRLoader().loadAsync(
    `${import.meta.env.BASE_URL}assets/studio_small_09_2k.hdr`,
  );
  hdri.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = hdri;
  scene.environmentRotation.y = Math.PI * 0.65;
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
  bloom = bloomNode(sceneColor, 0.1, 0.15, 0.5);
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
      // Metallic flakes: sparse worley cells glint as the camera moves, like metalflake clearcoat.
      const flakes = mx_worley_noise_float(positionGeometry.mul(280));
      const glint = pow(float(1).sub(flakes.saturate()), 6)
        .mul(pow(film, 0.4))
        .mul(mobile ? 0.1 : 0.16);
      m.colorNode = uniform(colorNow)
        .mul(mix(float(0.45), float(1.15), film))
        .add(glint);
      m.roughnessNode = float(0.28).add(
        mx_noise_float(positionGeometry.mul(135)).mul(0.018),
      );
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
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#45494e",
        metalness: 0.95,
        roughness: 0.23,
        clearcoat: 0.5,
      });
    else if (name === "Material.003")
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#171a1e",
        metalness: 0,
        roughness: 0.87,
      });
    else if (name === "leather_b")
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#24282c",
        metalness: 0,
        roughness: 0.85,
      });
    else if (name === "brake_disc")
      m = new THREE.MeshStandardMaterial({
        ...basic,
        color: "#666b6d",
        metalness: 0.86,
        roughness: 0.43,
      });
    else if (name.startsWith("carpaint_"))
      m = new THREE.MeshPhysicalMaterial({
        ...basic,
        color: "#e58921",
        map: src.map,
        metalness: 0.45,
        roughness: 0.3,
        clearcoat: 0.5,
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
  // Aim actual light beams from the headlight locations to the ground ahead of the car.
  const y = car.getWorldPosition(new THREE.Vector3()).y;
  for (const sign of [-1, 1]) {
    const p = new THREE.Vector3(sign * 0.71, y - 0.06, 1.97 - center.z);
    headlightPositions.push(p);
    const spot = new THREE.SpotLight(0xcdeaff, 0, 11, 0.31, 0.65, 1.3);
    spot.position.copy(p);
    spot.target.position.set(sign * 1.3, 0, 8);
    scene.add(spot, spot.target);
    spotlights.push(spot);
    const glow = new THREE.PointLight(0xcdeaff, 0, 1.3, 2);
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
    colorNow.lerp(colorTarget, reducedMotion ? 1 : smooth);
    paintMaterials.forEach((m) => m.color.copy(colorNow));
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
    for (const { m, gain } of emitters)
      m.emissiveIntensity = lightAmount * gain;
    spotlights.forEach(
      (l, i) => (l.intensity = lightAmount * (i % 2 === 0 ? 35 : 1.8)),
    );
    scene.background.copy(bgDay).lerp(bgNight, nightAmount);
    floor.material.color
      .set("#c4c9cf")
      .lerp(new THREE.Color("#141b23"), nightAmount);
    roofStrip.intensity = 2.8 - nightAmount * 1.4;
    shoulderStrip.intensity = 2.2 - nightAmount * 0.8;
    key.intensity = 0.5 - nightAmount * 0.3;
    ambient.intensity = 0.06 * debugState.ambientScale;
    fill.intensity = 0.15;
    rim.intensity = 0.35 + nightAmount * 0.35;
    scene.environmentIntensity =
      (0.85 - nightAmount * 0.5) * debugState.envScale;
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
