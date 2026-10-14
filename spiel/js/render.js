'use strict';
// Darstellung mit three.js: Chunks, Himmel, Wolken, Auswahlrahmen, Hand.

const CHUNK_VS = `
attribute vec3 aLight;
varying vec2 vUv;
varying vec3 vLight;
varying float vFog;
uniform float uFogNear;
uniform float uFogFar;
void main() {
  vUv = uv;
  vLight = aLight;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vFog = smoothstep(uFogNear, uFogFar, length(mv.xyz));
}`;
const CHUNK_FS = `
uniform sampler2D uMap;
uniform float uDay;
uniform vec3 uFogColor;
uniform float uAlphaTest;
uniform float uGamma;
varying vec2 vUv;
varying vec3 vLight;
varying float vFog;
void main() {
  vec4 t = texture2D(uMap, vUv);
  if (t.a < uAlphaTest) discard;
  float sky = vLight.x * uDay;
  float bl = vLight.y;
  float l = max(sky, bl);
  float f1 = 1.0 - l;
  float br = (1.0 - f1) / (f1 * 3.0 + 1.0);
  br = pow(br, uGamma);
  br = 0.035 + br * 0.965;
  vec3 col = t.rgb * br * vLight.z;
  if (bl > sky + 0.05) col *= vec3(1.1, 1.0, 0.86);
  col = mix(col, uFogColor, vFog);
  gl_FragColor = vec4(col, t.a);
}`;

class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.handScene = new THREE.Scene();
    this.handCam = new THREE.PerspectiveCamera(70, 1, 0.01, 10);

    this.atlas = new THREE.CanvasTexture(atlasCanvas);
    this.atlas.magFilter = THREE.NearestFilter;
    this.atlas.minFilter = THREE.NearestFilter;
    this.atlas.generateMipmaps = false;

    const uniforms = () => ({
      uMap: { value: this.atlas }, uDay: { value: 1 }, uFogColor: { value: new THREE.Color() },
      uFogNear: { value: 50 }, uFogFar: { value: 80 }, uAlphaTest: { value: 0.5 }, uGamma: { value: 0.75 },
    });
    this.solidMat = new THREE.ShaderMaterial({ vertexShader: CHUNK_VS, fragmentShader: CHUNK_FS, uniforms: uniforms() });
    this.transMat = new THREE.ShaderMaterial({ vertexShader: CHUNK_VS, fragmentShader: CHUNK_FS, uniforms: uniforms(), transparent: true, depthWrite: false });
    this.transMat.uniforms.uAlphaTest.value = 0.02;
    this.mats = [this.solidMat, this.transMat];

    // Licht fuer Mobs und Items
    this.ambient = new THREE.AmbientLight(0xffffff, 0.75);
    this.sunLight = new THREE.DirectionalLight(0xffffff, 0.45);
    this.sunLight.position.set(0.3, 1, 0.5);
    this.scene.add(this.ambient, this.sunLight);
    this.handScene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const hl = new THREE.DirectionalLight(0xffffff, 0.4); hl.position.set(-0.5, 1, 1); this.handScene.add(hl);

    this.chunkMeshes = new Map();
    this.buildSky();
    this.buildSelection();
    this.buildHand();
    this.skyColor = new THREE.Color();
  }

  resize(w, h) {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h; this.handCam.updateProjectionMatrix();
  }

  setRenderDistance(chunks) {
    const far = chunks * 16;
    for (const m of this.mats) { m.uniforms.uFogNear.value = far * 0.6; m.uniforms.uFogFar.value = far * 0.95; }
    this.fogFar = far;
  }

  // ------------------------------------------------ Chunks
  updateChunkMesh(c, data) {
    const k = c.cx * 65536 + c.cz;
    let entry = this.chunkMeshes.get(k);
    if (!entry) { entry = { solid: null, trans: null }; this.chunkMeshes.set(k, entry); }
    const make = (buf, mat, old) => {
      if (old) { this.scene.remove(old); old.geometry.dispose(); }
      if (!buf.n) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.pos), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(buf.uv), 2));
      g.setAttribute('aLight', new THREE.BufferAttribute(new Float32Array(buf.light), 3));
      g.setIndex(new THREE.BufferAttribute(buf.n > 65535 ? new Uint32Array(buf.idx) : new Uint16Array(buf.idx), 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.position.set(c.cx * 16, 0, c.cz * 16);
      m.matrixAutoUpdate = false; m.updateMatrix();
      if (mat === this.transMat) m.renderOrder = 1;
      this.scene.add(m);
      return m;
    };
    entry.solid = make(data.solid, this.solidMat, entry.solid);
    entry.trans = make(data.trans, this.transMat, entry.trans);
  }

  removeChunkMesh(c) {
    const k = c.cx * 65536 + c.cz;
    const e = this.chunkMeshes.get(k);
    if (!e) return;
    for (const m of [e.solid, e.trans]) if (m) { this.scene.remove(m); m.geometry.dispose(); }
    this.chunkMeshes.delete(k);
  }

  clearChunks() { for (const [k, e] of this.chunkMeshes) for (const m of [e.solid, e.trans]) if (m) { this.scene.remove(m); m.geometry.dispose(); } this.chunkMeshes.clear(); }

  // ------------------------------------------------ Himmel
  buildSky() {
    const tex = (c) => { const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; return t; };
    const plane = new THREE.PlaneGeometry(60, 60);
    this.sun = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: tex(makeSunCanvas(false)), transparent: true, fog: false, depthWrite: false }));
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: tex(makeSunCanvas(true)), transparent: true, fog: false, depthWrite: false }));
    this.sun.renderOrder = -2; this.moon.renderOrder = -2;
    this.scene.add(this.sun, this.moon);
    const starPos = [];
    const r = mulberry32(42);
    for (let i = 0; i < 900; i++) {
      const u = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      starPos.push(Math.cos(a) * s * 400, u * 400, Math.sin(a) * s * 400);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, depthWrite: false }));
    this.stars.renderOrder = -3;
    this.scene.add(this.stars);
    this.cloudTex = tex(makeCloudCanvas(7));
    this.cloudTex.wrapS = this.cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex.repeat.set(8, 8);
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(1536, 1536), new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 2;
    this.scene.add(this.clouds);
  }

  updateSky(time, camPos, underwater) {
    // time 0..24000, 0 = Sonnenaufgang, 6000 = Mittag
    const ang = (time / 24000) * Math.PI * 2;
    const sunH = Math.sin(ang);
    const day = clamp(sunH * 2.2 + 0.45, 0, 1);
    const dayCol = new THREE.Color(0.47, 0.65, 1.0), nightCol = new THREE.Color(0.01, 0.01, 0.04);
    const sky = this.skyColor.copy(nightCol).lerp(dayCol, day);
    // Morgen- und Abendrot
    const dusk = Math.max(0, 1 - Math.abs(sunH) * 4) * (day > 0.05 ? 1 : 0.4);
    sky.lerp(new THREE.Color(0.95, 0.55, 0.3), dusk * 0.35);
    let fog = sky.clone();
    if (underwater === 'water') fog = new THREE.Color(0.05, 0.12, 0.45).multiplyScalar(0.3 + 0.7 * day);
    if (underwater === 'lava') fog = new THREE.Color(0.8, 0.25, 0.02);
    this.renderer.setClearColor(fog);
    const dayLight = 0.18 + 0.82 * day;
    for (const m of this.mats) {
      m.uniforms.uDay.value = dayLight;
      m.uniforms.uFogColor.value.copy(fog);
      if (underwater) { m.uniforms.uFogNear.value = 0; m.uniforms.uFogFar.value = underwater === 'lava' ? 2 : 22; }
      else { m.uniforms.uFogNear.value = this.fogFar * 0.6; m.uniforms.uFogFar.value = this.fogFar * 0.95; }
    }
    this.ambient.intensity = 0.25 + 0.5 * dayLight;
    this.sunLight.intensity = 0.15 + 0.35 * day;
    const sx = Math.cos(ang), sy = Math.sin(ang);
    this.sun.position.set(camPos.x + sx * 300, camPos.y + sy * 300, camPos.z);
    this.sun.lookAt(camPos);
    this.moon.position.set(camPos.x - sx * 300, camPos.y - sy * 300, camPos.z);
    this.moon.lookAt(camPos);
    this.sun.visible = sy > -0.15;
    this.moon.visible = sy < 0.15;
    this.stars.position.copy(camPos);
    this.stars.rotation.z = ang;
    this.stars.material.opacity = clamp(1 - day * 1.6, 0, 1);
    this.clouds.position.set(Math.floor(camPos.x / 192) * 192, 128.5, Math.floor(camPos.z / 192) * 192);
    const drift = (performance.now() / 1000) * 0.6;
    this.cloudTex.offset.set((this.clouds.position.x + drift) / 192, -this.clouds.position.z / 192);
    this.clouds.material.color.setScalar(0.25 + 0.75 * day);
    return dayLight;
  }

  // ------------------------------------------------ Auswahl & Risse
  buildSelection() {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selection = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.crackTex = [];
    for (let s = 0; s < 10; s++) {
      const t = new THREE.CanvasTexture(TILE_CANVAS['destroy' + s]);
      t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
      this.crackTex.push(t);
    }
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), new THREE.MeshBasicMaterial({ map: this.crackTex[0], transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.crack.visible = false;
    this.scene.add(this.crack);
  }

  showSelection(hit, stage) {
    if (!hit) { this.selection.visible = false; this.crack.visible = false; return; }
    const boxes = blockBoxes(hit.id, hit.meta);
    let b = [0, 0, 0, 1, 1, 1];
    if (boxes.length) {
      b = [1, 1, 1, 0, 0, 0];
      for (const x of boxes) for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], x[a]); b[a + 3] = Math.max(b[a + 3], x[a + 3]); }
    }
    const sx = b[3] - b[0], sy = b[4] - b[1], sz = b[5] - b[2];
    this.selection.visible = true;
    this.selection.position.set(hit.x + (b[0] + b[3]) / 2, hit.y + (b[1] + b[4]) / 2, hit.z + (b[2] + b[5]) / 2);
    this.selection.scale.set(sx + 0.004, sy + 0.004, sz + 0.004);
    if (stage >= 0) {
      this.crack.visible = true;
      this.crack.position.copy(this.selection.position);
      this.crack.scale.set(sx, sy, sz);
      this.crack.material.map = this.crackTex[Math.min(9, stage)];
    } else this.crack.visible = false;
  }

  // ------------------------------------------------ Hand / gehaltenes Item
  buildHand() {
    this.handGroup = new THREE.Group();
    this.handScene.add(this.handGroup);
    const armMat = new THREE.MeshLambertMaterial({ color: 0xd8a27c });
    this.arm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.7), armMat);
    this.handGroup.add(this.arm);
    this.heldId = -1;
    this.heldMesh = null;
    this.swing = 0;
  }

  makeItemMesh(id, size) {
    const item = ITEMS[id];
    const blk = item.block !== null && item.block !== undefined ? BLOCKS[item.block] : null;
    if (blk && ['cube', 'slab', 'stairs', 'farmland', 'cactus'].includes(blk.shape)) {
      const buf = new MeshBuf();
      const boxes = blk.shape === 'cube' ? [[0, 0, 0, 1, 1, 1]] : blockBoxes(blk.id, blk.shape === 'stairs' ? 2 : 0);
      for (const box of boxes) for (let d = 0; d < 6; d++) {
        const D = DIRS[d];
        const verts = [], uvs = [], lights = [];
        for (let k = 0; k < 4; k++) {
          const [su, sv] = CORNERS[k]; const p = [0, 0, 0];
          for (let a = 0; a < 3; a++) {
            if (D.n[a] !== 0) p[a] = D.n[a] > 0 ? box[a + 3] : box[a];
            else if (D.u[a] !== 0) p[a] = (D.u[a] * su > 0) ? box[a + 3] : box[a];
            else p[a] = (D.v[a] * sv > 0) ? box[a + 3] : box[a];
          }
          let s = 0, tt = 0;
          for (let a = 0; a < 3; a++) { if (D.u[a]) s = D.u[a] > 0 ? p[a] : 1 - p[a]; if (D.v[a]) tt = D.v[a] > 0 ? p[a] : 1 - p[a]; }
          const tex = d === 2 ? blk.faces.top : d === 3 ? blk.faces.bottom : (d === 4 && blk.facing ? blk.faces.front : blk.faces.side);
          verts.push([p[0] - 0.5, p[1] - 0.5, p[2] - 0.5]); uvs.push(tileUV(tex, s, tt)); lights.push([1, 0, D.shade]);
        }
        const n = buf.n;
        for (let k = 0; k < 4; k++) { buf.pos.push(...verts[k]); buf.uv.push(...uvs[k]); buf.light.push(...lights[k]); }
        buf.idx.push(n, n + 1, n + 2, n, n + 2, n + 3); buf.n += 4;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
      const cols = [];
      for (let i = 0; i < buf.light.length; i += 3) cols.push(buf.light[i + 2], buf.light[i + 2], buf.light[i + 2]);
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      g.setIndex(buf.idx);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide }));
      m.scale.setScalar(size);
      m.userData.isBlock = true;
      return m;
    }
    const tileName = blk ? null : item.icon;
    const canvas = blk ? TILE_CANVAS[blk.icon || Object.keys(TEX).find(k => TEX[k] === blk.faces.side)] : TILE_CANVAS[tileName];
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide }));
    m.scale.setScalar(size);
    return m;
  }

  updateHand(stack, dt, moving, brightness, bowCharge, eating) {
    const id = stack ? stack.id : 0;
    if (id !== this.heldId) {
      if (this.heldMesh) { this.handGroup.remove(this.heldMesh); this.heldMesh.geometry.dispose(); }
      this.heldMesh = null;
      this.heldId = id;
      if (id) {
        this.heldMesh = this.makeItemMesh(id, this.isCubeItem(id) ? 0.24 : 0.48);
        this.handGroup.add(this.heldMesh);
      }
      this.arm.visible = !id;
    }
    this.swing = Math.max(0, this.swing - dt * 4);
    const s = Math.sin(this.swing * Math.PI);
    this.bob = (this.bob || 0) + (moving ? dt * 9 : 0);
    const bx = Math.sin(this.bob) * 0.02, by = -Math.abs(Math.cos(this.bob)) * 0.02;
    const g = this.handGroup;
    g.position.set(0.6 + bx - s * 0.25, -0.52 + by + s * 0.12, -0.95 - s * 0.15);
    g.rotation.set(-s * 0.9, -s * 0.3, 0);
    if (eating) g.position.set(0.2, -0.35 + Math.sin(performance.now() / 60) * 0.03, -0.6);
    if (this.heldMesh) {
      const isBlock = this.heldMesh.userData.isBlock;
      if (isBlock) { this.heldMesh.position.set(-0.02, 0.06, -0.05); this.heldMesh.rotation.set(0.45, Math.PI / 4 + 0.15, 0); }
      else {
        this.heldMesh.position.set(0, 0.1, -0.1);
        this.heldMesh.rotation.set(0, -Math.PI / 2 + 0.35, 0.25);
        if (bowCharge > 0) { this.heldMesh.rotation.set(0, -0.2, 0.9); g.position.x = 0.3 - bowCharge * 0.05; g.position.z = -0.7 + bowCharge * 0.1; }
      }
      this.heldMesh.material.color && this.heldMesh.material.color.setScalar(brightness);
    } else {
      this.arm.position.set(0.05, -0.05, 0.1);
      this.arm.rotation.set(0.25, 0.15, 0);
      this.arm.material.color.setRGB(0.85 * brightness, 0.64 * brightness, 0.49 * brightness);
    }
  }

  isCubeItem(id) {
    const it = ITEMS[id];
    const b = it.block !== null && it.block !== undefined ? BLOCKS[it.block] : null;
    return !!b && ['cube', 'slab', 'stairs', 'farmland', 'cactus'].includes(b.shape);
  }

  render(showHand) {
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (showHand) {
      this.renderer.clearDepth();
      this.renderer.render(this.handScene, this.handCam);
    }
  }
}
