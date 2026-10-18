// CLUB|HOUSE night stadium — a procedural Three.js scene (no models, no textures to download).
// Pitch markings are drawn on a canvas, the crowd is one InstancedMesh, camera flashes are a shader
// point cloud, and floodlight cones use additive blending for a cheap volumetric look.
// mountStadium(canvas, opts) → { celebrate(colorHex), destroy() }
import * as THREE from '/web/assets/vendor/three.module.min.js';

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function pitchTexture() {
  const W = 2100, H = 1360, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  // mowing stripes
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? '#1f6b3c' : '#24783f';
    g.fillRect((W / 14) * i, 0, W / 14 + 1, H);
  }
  // subtle grain
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 7;
  const m = 60, w = W - m * 2, h = H - m * 2;
  g.strokeRect(m, m, w, h);
  g.beginPath(); g.moveTo(W / 2, m); g.lineTo(W / 2, H - m); g.stroke();
  g.beginPath(); g.arc(W / 2, H / 2, 183, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(W / 2, H / 2, 9, 0, Math.PI * 2); g.fill();
  for (const side of [0, 1]) {
    const x = side ? W - m : m, dir = side ? -1 : 1;
    g.strokeRect(side ? x - 330 : x, H / 2 - 403, 330, 806);
    g.strokeRect(side ? x - 110 : x, H / 2 - 183, 110, 366);
    g.beginPath(); g.arc(x + dir * 220, H / 2, 8, 0, Math.PI * 2); g.fill();
    g.beginPath();
    g.arc(x + dir * 220, H / 2, 183, side ? Math.PI - 0.93 : -0.93, side ? Math.PI + 0.93 : 0.93);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function glowTexture(inner = 'rgba(255,248,220,1)', outer = 'rgba(255,220,140,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.25, 'rgba(255,236,180,0.55)');
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function mountStadium(canvas, opts = {}) {
  const small = window.innerWidth < 720;
  const still = reduceMotion() || opts.still;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !small, powerPreference: 'high-performance' });
  } catch (e) {
    return null; // caller shows the CSS/photo fallback
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0c1220, small ? 0.0072 : 0.0058);
  // Night sky: a big inverted sphere with a vertical gradient (horizon glow from the floodlights).
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = clamp(vP.y*1.6, 0.0, 1.0); vec3 top = vec3(0.02,0.03,0.07); vec3 hor = vec3(0.13,0.12,0.16); gl_FragColor = vec4(mix(hor, top, pow(h,0.55)), 1.0); }',
  }));
  scene.add(sky);

  const camera = new THREE.PerspectiveCamera(small ? 55 : 42, 1, 0.5, 600);

  // Lights
  scene.add(new THREE.HemisphereLight(0xb7c8ff, 0x10140f, 0.9));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.1);
  key.position.set(30, 80, 20);
  scene.add(key);

  // Pitch + surround
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.92, metalness: 0 }));
  pitch.rotation.x = -Math.PI / 2;
  scene.add(pitch);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(150, 110), new THREE.MeshStandardMaterial({ color: 0x15301f, roughness: 1 }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  scene.add(apron);

  // Crowd: tiered stands on four sides, one InstancedMesh
  const rows = small ? 10 : 16, perRow = small ? 70 : 120;
  const sides = [
    { len: 132, dist: 52, rot: 0 }, { len: 132, dist: 52, rot: Math.PI },
    { len: 96, dist: 70, rot: Math.PI / 2 }, { len: 96, dist: 70, rot: -Math.PI / 2 },
  ];
  const count = sides.length * rows * perRow;
  const seat = new THREE.BoxGeometry(0.9, 1.2, 0.7);
  const crowd = new THREE.InstancedMesh(seat, new THREE.MeshStandardMaterial({ roughness: 0.8 }), count);
  const palette = [0xed5a49, 0xf4d35c, 0xe8e4da, 0x3a3a3f, 0xed5a49, 0x2f6fd6, 0x3a3a3f];
  const flashPos = [], flashPhase = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  let i = 0;
  for (const s of sides) {
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < perRow; k++) {
        const along = (k / (perRow - 1) - 0.5) * s.len;
        const out = s.dist + r * 1.6;
        const y = 1 + r * 1.15 + Math.random() * 0.25;
        const x = Math.cos(s.rot) * along - Math.sin(s.rot) * out;
        const z = Math.sin(s.rot) * along + Math.cos(s.rot) * out;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s.rot);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 0.8 + Math.random() * 0.5, 1));
        crowd.setMatrixAt(i, m4);
        col.setHex(palette[(Math.random() * palette.length) | 0]).multiplyScalar(0.35 + Math.random() * 0.35);
        crowd.setColorAt(i, col);
        if (Math.random() < 0.08) { flashPos.push(x, y + 0.9, z); flashPhase.push(Math.random() * 100); }
        i++;
      }
    }
  }
  scene.add(crowd);

  // Camera flashes / phone lights in the crowd (shader-driven twinkle)
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.Float32BufferAttribute(flashPos, 3));
  flashGeo.setAttribute('phase', new THREE.Float32BufferAttribute(flashPhase, 1));
  const flashMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() }, uBoost: { value: 0 } },
    vertexShader: `attribute float phase; uniform float uTime; uniform float uPx; uniform float uBoost; varying float vA;
      void main(){ float t = sin(uTime*2.3 + phase*7.0) * sin(uTime*0.7 + phase); vA = smoothstep(0.55, 1.0, t) + uBoost*0.8;
        vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = (2.0 + vA*5.0) * uPx * (60.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); if(d>0.5) discard; gl_FragColor = vec4(1.0,0.97,0.88, vA*(1.0-d*2.0)); }`,
  });
  scene.add(new THREE.Points(flashGeo, flashMat));

  // Floodlight towers with glowing heads and light cones
  const glowTex = glowTexture();
  const towerMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.6, metalness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 2.2 });
  const coneMat = new THREE.MeshBasicMaterial({ color: 0xfff1cf, transparent: true, opacity: 0.032, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const heads = [];
  // Towers stand outside the camera's orbit so they frame the shot instead of blocking it.
  for (const [x, z] of [[-86, -62], [86, -62], [-86, 62], [86, 62]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1, 50, 8), towerMat);
    pole.position.set(x, 25, z);
    scene.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(9, 4, 1.2), headMat);
    head.position.set(x * 0.98, 51, z * 0.98);
    head.lookAt(0, 0, 0);
    scene.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(34, 34, 1);
    glow.position.copy(head.position);
    scene.add(glow);
    heads.push(glow);
    // Cone apex sits on the light head, base on the pitch spot it aims at.
    const aim = new THREE.Vector3(x * 0.15, 0, z * 0.15);
    const dir = new THREE.Vector3().subVectors(head.position, aim);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(15, dir.length(), 32, 1, true), coneMat);
    cone.position.copy(aim).addScaledVector(dir, 0.5);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    scene.add(cone);
    const spot = new THREE.SpotLight(0xfff0d0, small ? 2200 : 3200, 260, 0.5, 0.65, 1.6);
    spot.position.copy(head.position);
    spot.target.position.copy(aim);
    scene.add(spot, spot.target);
  }

  // Match ball: faceted icosahedron with a blob shadow
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), new THREE.MeshStandardMaterial({ color: 0xf7f5ee, roughness: 0.35, flatShading: true }));
  const pentagons = new THREE.Mesh(new THREE.IcosahedronGeometry(1.62, 0), new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.5, flatShading: true, wireframe: true }));
  ball.add(pentagons);
  scene.add(ball);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.03;
  scene.add(blob);

  // Dust drifting through the light
  const dustN = small ? 260 : 600, dust = new Float32Array(dustN * 3);
  for (let d = 0; d < dustN; d++) { dust[d * 3] = (Math.random() - 0.5) * 140; dust[d * 3 + 1] = Math.random() * 40; dust[d * 3 + 2] = (Math.random() - 0.5) * 100; }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dust, 3));
  const dustPts = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xfff4d6, size: 0.25, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(dustPts);

  // Confetti burst for goals (pooled)
  const confN = 700, conf = new Float32Array(confN * 3), vel = new Float32Array(confN * 3);
  const confGeo = new THREE.BufferGeometry();
  confGeo.setAttribute('position', new THREE.BufferAttribute(conf, 3));
  const confMat = new THREE.PointsMaterial({ color: 0xf4d35c, size: 0.7, transparent: true, opacity: 0, depthWrite: false });
  scene.add(new THREE.Points(confGeo, confMat));
  let confLife = 0, boost = 0;

  // Interaction: pointer parallax + scroll dolly
  const target = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
  const onPointer = (e) => { target.x = (e.clientX / window.innerWidth - 0.5) * 2; target.y = (e.clientY / window.innerHeight - 0.5) * 2; };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const resize = () => {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // On wide screens, slide the scene right so the pitch sits beside the headline, not under it.
    const shift = w > 900 ? (opts.shift ?? 0.16) : 0;
    if (shift) camera.setViewOffset(w, h, -w * shift, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let visible = true, raf = 0, t0 = performance.now();
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible && !raf && !still) loop(); });
  io.observe(canvas);

  const orbitR = opts.orbitRadius ?? (small ? 88 : 76), height = opts.height ?? (small ? 44 : 33);
  function frame(now) {
    const t = (now - t0) / 1000;
    eased.x += (target.x - eased.x) * 0.04;
    eased.y += (target.y - eased.y) * 0.04;
    const a = (opts.angle ?? 0.6) + (still ? 0 : t * 0.045) + eased.x * 0.18;
    const scroll = Math.min(1, window.scrollY / (window.innerHeight || 800));
    camera.position.set(Math.sin(a) * orbitR * (1 - scroll * 0.15), height - eased.y * 4 - scroll * 10, Math.cos(a) * orbitR * (1 - scroll * 0.15));
    camera.lookAt(0, 9 - scroll * 3, 0);

    ball.position.set(Math.sin(t * 0.6) * 6, 3.2 + Math.abs(Math.sin(t * 2.2)) * 2.4, Math.cos(t * 0.4) * 3);
    ball.rotation.x = t * 1.7; ball.rotation.z = t * 0.9;
    blob.position.x = ball.position.x; blob.position.z = ball.position.z;
    blob.material.opacity = 0.42 - (ball.position.y - 3.2) * 0.07;

    dustPts.rotation.y = t * 0.01;
    boost = Math.max(0, boost - 0.012);
    flashMat.uniforms.uTime.value = t;
    flashMat.uniforms.uBoost.value = boost;
    for (const h of heads) h.material.opacity = 0.85 + Math.sin(t * 9 + h.position.x) * 0.04 + boost * 0.15;
    renderer.toneMappingExposure = 1.05 + boost * 0.55;

    if (confLife > 0) {
      confLife -= 1 / 60;
      for (let c = 0; c < confN; c++) {
        vel[c * 3 + 1] -= 0.012;
        conf[c * 3] += vel[c * 3]; conf[c * 3 + 1] += vel[c * 3 + 1]; conf[c * 3 + 2] += vel[c * 3 + 2];
      }
      confGeo.attributes.position.needsUpdate = true;
      confMat.opacity = Math.min(1, confLife);
    }
    renderer.render(scene, camera);
  }
  function loop() {
    raf = 0;
    if (!visible || document.hidden) return;
    frame(performance.now());
    raf = requestAnimationFrame(loop);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !raf && !still) loop(); });
  if (still) frame(performance.now()); else loop();

  return {
    celebrate(hex = '#f4d35c') {
      confMat.color.set(hex);
      for (let c = 0; c < confN; c++) {
        conf[c * 3] = ball.position.x; conf[c * 3 + 1] = ball.position.y + 2; conf[c * 3 + 2] = ball.position.z;
        const th = Math.random() * Math.PI * 2, sp = 0.25 + Math.random() * 0.6;
        vel[c * 3] = Math.cos(th) * sp; vel[c * 3 + 1] = 0.35 + Math.random() * 0.75; vel[c * 3 + 2] = Math.sin(th) * sp;
      }
      confLife = 2.4;
      boost = 1;
      if (still) frame(performance.now());
    },
    destroy() {
      cancelAnimationFrame(raf);
      io.disconnect();
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
