// Load Poly Haven assets fetched by polyhaven.mjs into a three.js scene.
// ES module, no imports: pass THREE and the loaders you already load, so it
// works with any three build path. Everything is read from the local
// polyhaven/ folder, never from the network.

/** Hold HyperFrames render/check until `promise` settles (window.__hf.buildReady). */
export function holdRender(key, promise) {
  window.__hf = window.__hf || {};
  window.__hf.buildReady = window.__hf.buildReady || {};
  window.__hf.buildReady[key] = promise;
  return promise;
}

export async function loadManifest(url = "polyhaven/manifest.json") {
  const abs = new URL(url, document.baseURI);
  const res = await fetch(abs);
  if (!res.ok) throw new Error("polyhaven: " + res.status + " " + abs);
  const man = await res.json();
  man.base = new URL(".", abs).href;
  return man;
}

function entry(man, role) {
  const a = man.assets && man.assets[role];
  if (!a) throw new Error('polyhaven: no "' + role + '" in manifest');
  return a;
}

const href = (man, rel) => new URL(rel, man.base).href;

/**
 * HDRI as image-based lighting (and optionally the background).
 * HDRLoader is three/examples/jsm/loaders/HDRLoader.js (RGBELoader on older three).
 */
export async function loadHdri(opts) {
  const { THREE, HDRLoader, renderer, scene, manifest, role = "hdri" } = opts;
  const a = entry(manifest, role);
  const tex = await new HDRLoader().loadAsync(href(manifest, a.entry.hdr));
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = opts.intensity ?? 1;
  if (opts.rotation != null) scene.environmentRotation.y = opts.rotation;
  if (opts.background !== false) {
    scene.background = tex;
    scene.backgroundBlurriness = opts.blurriness ?? 0;
    scene.backgroundIntensity = opts.backgroundIntensity ?? 1;
    if (opts.rotation != null) scene.backgroundRotation.y = opts.rotation;
  }
  return { texture: tex, envMap: env, asset: a };
}

/** MeshStandardMaterial from a Poly Haven texture set (diffuse, nor_gl, arm or rough/ao/metal). */
export async function loadPbrMaterial(opts) {
  const { THREE, manifest, role = "material", repeat = [1, 1] } = opts;
  const a = entry(manifest, role);
  const loader = new THREE.TextureLoader();
  const maps = {};
  await Promise.all(
    Object.entries(a.entry).map(async ([k, rel]) => {
      const t = await loader.loadAsync(href(manifest, rel));
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat[0], repeat[1]);
      t.anisotropy = opts.anisotropy ?? 4;
      t.colorSpace = k === "diffuse" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      maps[k] = t;
    }),
  );
  // arm = AO (R), roughness (G), metalness (B): the glTF ORM layout three reads.
  const orm = maps.arm;
  const material = new THREE.MeshStandardMaterial({
    map: maps.diffuse,
    normalMap: maps.normal || null,
    roughnessMap: orm || maps.rough || null,
    metalnessMap: orm || maps.metal || null,
    aoMap: orm || maps.ao || null,
    roughness: 1,
    metalness: orm || maps.metal ? 1 : 0,
    displacementMap: maps.displacement || null,
    displacementScale: opts.displacementScale ?? 0,
  });
  return { material, maps, asset: a };
}

/** glTF model (GLTFLoader from three/examples/jsm/loaders/GLTFLoader.js). */
export async function loadModel(opts) {
  const { GLTFLoader, manifest, role = "model" } = opts;
  const a = entry(manifest, role);
  const gltf = await new GLTFLoader().loadAsync(href(manifest, a.entry.gltf));
  return { object: gltf.scene, gltf, asset: a };
}

/** Scale `object` so its largest side is `size`, centred on x/z and resting on y = 0. */
export function fitObject(THREE, object, size = 2) {
  const box = new THREE.Box3().setFromObject(object);
  const dim = box.getSize(new THREE.Vector3());
  const s = size / Math.max(dim.x, dim.y, dim.z, 1e-6);
  object.scale.multiplyScalar(s);
  box.setFromObject(object);
  const c = box.getCenter(new THREE.Vector3());
  object.position.x -= c.x;
  object.position.z -= c.z;
  object.position.y -= box.min.y;
  return object;
}

/** One-line on-screen credit, e.g. for an end card or corner label. */
export function creditLine(manifest) {
  const names = Object.values(manifest.assets).map((a) => a.name);
  return "Assets: " + names.join(", ") + " · Powered by Poly Haven (CC0)";
}
