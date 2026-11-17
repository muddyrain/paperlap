import * as THREE from "three";
import { nearest, type Point, type TrackData } from "./geometry";
import type { Car } from "./vehicle";

export type PreparedRaceView = (() => void) & { dispose(): void };

const PAPER = 0xf2e7d1;
const INK = 0x46525a;
const positiveMod = (value: number, divisor: number) =>
  ((value % divisor) + divisor) % divisor;

function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function tile(paper: boolean): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d")!;
  const rng = random(paper ? 47 : 91);
  context.fillStyle = paper ? "#f2e7d1" : "#a6a3a0";
  context.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1300; i++) {
    context.fillStyle = `rgba(${paper ? "109,93,73" : "61,64,62"},${rng() * 0.055})`;
    context.fillRect(rng() * 256, rng() * 256, 1, 1 + rng() * 3);
  }
  if (paper) {
    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(143,166,176,.35)";
    context.beginPath();
    for (let i = 0; i <= 256; i += 64) {
      context.moveTo(i, 0);
      context.lineTo(i, 256);
      context.moveTo(0, i);
      context.lineTo(256, i);
    }
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 2;
  return texture;
}

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
      geometries.add(object.geometry);
      const list = Array.isArray(object.material)
        ? object.material
        : [object.material];
      list.forEach((material) => materials.add(material));
    }
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function normal(points: Point[], i: number) {
  const a = points[(i + points.length - 1) % points.length];
  const b = points[(i + 1) % points.length];
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
}

// A ribbon follows the authoritative centerline. No map-sized raster is made.
function ribbon(data: TrackData, width: number, offset: number, height: number) {
  const points = data.track.points;
  const positions: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= points.length; i++) {
    const p = points[i % points.length];
    const n = normal(points, i % points.length);
    for (const side of [-1, 1]) {
      const distance = offset + (side * width) / 2;
      const x = p.x + n.x * distance,
        z = p.y + n.y * distance;
      positions.push(x, height, z);
      uvs.push(x / 140, z / 140);
    }
    if (i < points.length) {
      const j = i * 2;
      indices.push(j, j + 1, j + 2, j + 1, j + 3, j + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function along(data: TrackData, distance: number) {
  const s = positiveMod(distance, data.length);
  let low = 0,
    high = data.track.points.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (data.lengths[middle] <= s) low = middle;
    else high = middle - 1;
  }
  const a = data.track.points[low];
  const b = data.track.points[(low + 1) % data.track.points.length];
  const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const t = (s - data.lengths[low]) / length;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function instances(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  values: { x: number; y: number; z: number; angle?: number; scale?: number }[],
) {
  const mesh = new THREE.InstancedMesh(geometry, material, values.length);
  const transform = new THREE.Object3D();
  values.forEach((value, i) => {
    transform.position.set(value.x, value.y, value.z);
    transform.rotation.set(0, -(value.angle ?? 0), 0);
    transform.scale.setScalar(value.scale ?? 1);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  group.add(mesh);
  return mesh;
}

function toyCar() {
  const car = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color: 0xd85935, roughness: 0.43 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2f383c, roughness: 0.9 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x769ca8, roughness: 0.24 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xffefce, roughness: 0.7 });
  const red = new THREE.MeshBasicMaterial({ color: 0xa52d27 });
  const box = (
    size: [number, number, number],
    position: [number, number, number],
    material: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    car.add(mesh);
    return mesh;
  };
  box([59, 8, 33], [0, 10, 0], dark);
  const shape = new THREE.Shape();
  shape.moveTo(-31, -20);
  shape.lineTo(29, -20);
  shape.quadraticCurveTo(35, -20, 35, -14);
  shape.lineTo(35, 14);
  shape.quadraticCurveTo(35, 20, 29, 20);
  shape.lineTo(-31, 20);
  shape.quadraticCurveTo(-36, 20, -36, 15);
  shape.lineTo(-36, -15);
  shape.quadraticCurveTo(-36, -20, -31, -20);
  const body = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 11,
      bevelEnabled: true,
      bevelSize: 2,
      bevelThickness: 2,
      bevelSegments: 2,
      curveSegments: 4,
      steps: 1,
    }),
    paint,
  );
  body.rotation.x = -Math.PI / 2;
  body.position.y = 13;
  car.add(body);
  box([28, 13, 31], [-6, 31, 0], glass);
  box([27, 4, 32], [-7, 39, 0], paint);
  instances(car, new THREE.BoxGeometry(3, 14, 3), paint,
    [-20, 7].flatMap(x => [-15, 15].map(z => ({ x, y: 31, z }))));
  box([35, 1, 7], [17, 26.4, 0], cream);
  box([4, 6, 8], [35, 18, -11], cream);
  box([4, 6, 8], [35, 18, 11], cream);
  box([3, 5, 8], [-36, 18, -11], red);
  box([3, 5, 8], [-36, 18, 11], red);
  box([3, 5, 27], [37, 10, 0], dark);
  box([3, 5, 27], [-38, 10, 0], dark);
  const wheels: THREE.Group[] = [];
  const rubber = new THREE.CylinderGeometry(9.5, 9.5, 9, 12);
  const hubGeometry = new THREE.CylinderGeometry(4.5, 4.5, 9.6, 10);
  for (const x of [-22, 22])
    for (const z of [-23, 23]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 10, z);
      const tire = new THREE.Mesh(rubber, dark);
      tire.rotation.x = Math.PI / 2;
      const hub = new THREE.Mesh(hubGeometry, cream);
      hub.rotation.x = Math.PI / 2;
      pivot.add(tire, hub);
      car.add(pivot);
      if (x > 0) wheels.push(pivot);
    }
  return { car, wheels };
}

/** Passive renderer: RaceScene owns simulation time and calls render once per frame. */
export class RaceView {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(47, 1, 2, 5200);
  private readonly paperTexture = tile(true);
  private readonly roadTexture = tile(false);
  private readonly car = toyCar();
  private readonly ground: THREE.Mesh;
  private readonly cameraTarget = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly pending = new Set<PreparedRaceView>();
  private readonly observer: ResizeObserver;
  private track: THREE.Group | null = null;
  private visible = true;
  private dirty = true;
  private snap = true;
  private disposed = false;
  private contextLost = false;
  private lastX = NaN;
  private lastY = NaN;
  private lastAngle = NaN;
  private lastSteering = NaN;
  private heading = 0;
  private lastCar: Car | null = null;
  private width = 0;
  private height = 0;

  constructor(private readonly container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "race-view";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: "low-power",
      });
    } catch (error) {
      this.paperTexture.dispose();
      this.roadTexture.dispose();
      disposeObject(this.car.car);
      throw new Error("无法创建 3D 驾驶画面：此浏览器需要可用的 WebGL 2。", {
        cause: error,
      });
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.scene.background = new THREE.Color(PAPER);
    this.scene.fog = new THREE.Fog(PAPER, 1500, 4000);
    this.scene.add(new THREE.HemisphereLight(0xfff9eb, 0x8c8879, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-600, 1400, -700);
    this.scene.add(sun);
    this.paperTexture.repeat.set(10000 / 256, 10000 / 256);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(10000, 10000),
      new THREE.MeshBasicMaterial({ map: this.paperTexture, toneMapped: false }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.4;
    this.scene.add(this.ground, this.car.car);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({
        color: 0x655945,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(43, 27, 1);
    shadow.position.set(-3, 1, 3);
    this.car.car.add(shadow);
    this.canvas.addEventListener("webglcontextlost", this.lost);
    this.canvas.addEventListener("webglcontextrestored", this.restored);
    this.container.append(this.canvas);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.resize();
  }

  private lost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
  };
  private restored = () => {
    this.contextLost = false;
    this.dirty = this.snap = true;
    if (this.lastCar) this.render(this.lastCar, 0);
  };

  private buildTrack(data: TrackData): THREE.Group {
    const group = new THREE.Group();
    try {
      const road = (width: number, offset: number, height: number, material: THREE.Material) =>
        group.add(new THREE.Mesh(ribbon(data, width, offset, height), material));
      road(data.track.width + 4, 0, 0, new THREE.MeshBasicMaterial({ color: 0x6f7777 }));
      road(data.track.width, 0, 0.3,
        new THREE.MeshBasicMaterial({ map: this.roadTexture, toneMapped: false }));
      const edge = new THREE.MeshBasicMaterial({ color: 0xe8dfca });
      road(2, -data.track.width / 2 + 4, 0.6, edge);
      road(2, data.track.width / 2 - 4, 0.6, edge);
      const marks = [];
      for (let s = 30; s < data.length; s += 58) {
        const p = along(data, s);
        marks.push({ x: p.x, y: 0.8, z: p.y, angle: p.angle });
      }
      instances(group, new THREE.BoxGeometry(24, 0.3, 2.5),
        new THREE.MeshBasicMaterial({ color: 0xf0e8d7 }), marks);

      const start = data.gates[0];
      const angle = Math.atan2(start.tangent.y, start.tangent.x);
      const checkers: { x: number; y: number; z: number; angle: number }[][] = [[], []];
      const cell = data.track.width / 10;
      for (let row = 0; row < 2; row++)
        for (let column = 0; column < 10; column++) {
          const across = (column - 4.5) * cell;
          const forward = (row - 0.5) * cell;
          checkers[(row + column) % 2].push({
            x: start.center.x + start.tangent.x * forward - start.tangent.y * across,
            y: 1,
            z: start.center.y + start.tangent.y * forward + start.tangent.x * across,
            angle,
          });
        }
      checkers.forEach((values, i) => instances(group,
        new THREE.BoxGeometry(cell, 0.4, cell),
        new THREE.MeshBasicMaterial({ color: i ? INK : 0xfff5dc }), values));
      const rng = random(2317 + data.track.points.length);
      const trees = [], stones = [];
      const propCount = Math.min(120, Math.ceil(data.length / 95));
      for (let i = 0; i < propCount; i++) {
        const p = along(data, (data.length * (i + 0.2)) / propCount);
        const side = i % 2 ? -1 : 1;
        const offset = side * (data.track.width / 2 + 75 + rng() * 150);
        const x = p.x - Math.sin(p.angle) * offset;
        const z = p.y + Math.cos(p.angle) * offset;
        if (nearest({ x, y: z }, data.track.points).distance < data.track.width / 2 + 45)
          continue;
        const scale = 0.7 + rng() * 0.65;
        if (i % 3) trees.push({ x, y: 30 * scale, z, scale, angle: rng() * 6 });
        else stones.push({ x, y: 7 * scale, z, scale, angle: rng() * 6 });
      }
      instances(group, new THREE.ConeGeometry(20, 52, 5),
        new THREE.MeshLambertMaterial({ color: 0x79928c }), trees);
      instances(group, new THREE.CylinderGeometry(2.5, 3, 17, 5),
        new THREE.MeshLambertMaterial({ color: 0x907c63 }),
        trees.map((t) => ({ ...t, y: 8.5 * t.scale })));
      instances(group, new THREE.DodecahedronGeometry(12, 0),
        new THREE.MeshLambertMaterial({ color: 0xa3acaa }), stones);
      const poles = [-1, 1].map((side) => ({
        x: start.center.x - start.tangent.y * side * (data.track.width / 2 + 14),
        y: 30,
        z: start.center.y + start.tangent.x * side * (data.track.width / 2 + 14),
        angle,
      }));
      instances(group, new THREE.CylinderGeometry(2.5, 3, 60, 6),
        new THREE.MeshLambertMaterial({ color: INK }), poles);
      instances(group, new THREE.BoxGeometry(25, 15, 1.5),
        new THREE.MeshLambertMaterial({ color: 0xd85935 }),
        poles.map((p) => ({ ...p, y: 53 })));
      return group;
    } catch (error) {
      disposeObject(group);
      throw error;
    }
  }

  prepareTrack(data: TrackData): PreparedRaceView {
    if (this.disposed) throw new Error("3D view is disposed");
    const candidate = this.buildTrack(data);
    let state: "pending" | "committed" | "disposed" = "pending";
    const commit = (() => {
      if (state === "committed") return;
      if (state === "disposed" || this.disposed)
        throw new Error("Prepared 3D track is disposed");
      state = "committed";
      this.pending.delete(commit);
      if (this.track) {
        this.scene.remove(this.track);
        disposeObject(this.track);
      }
      this.track = candidate;
      this.scene.add(candidate);
      this.dirty = this.snap = true;
    }) as PreparedRaceView;
    commit.dispose = () => {
      if (state !== "pending") return;
      state = "disposed";
      this.pending.delete(commit);
      disposeObject(candidate);
    };
    this.pending.add(commit);
    return commit;
  }

  setTrack(data: TrackData) {
    this.prepareTrack(data)();
  }

  setVisible(visible: boolean) {
    if (this.disposed || this.visible === visible) return;
    this.visible = visible;
    this.canvas.hidden = !visible;
    if (visible) {
      this.dirty = this.snap = true;
      this.resize();
    }
  }

  resize() {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 1.25);
    if (width === this.width && height === this.height && this.renderer.getPixelRatio() === ratio)
      return;
    this.width = width;
    this.height = height;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    if (this.lastCar && !this.contextLost) this.render(this.lastCar, 0);
  }

  render(car: Car, dt: number, reset = false) {
    if (this.disposed || !this.visible || document.hidden) return;
    if (this.contextLost) throw new Error("3D 图形连接已中断，请等待恢复或重新加载。");
    this.lastCar = { ...car };
    const elapsed = Math.min(Math.max(dt, 0), 0.1);
    const moved = car.x !== this.lastX || car.y !== this.lastY ||
      car.angle !== this.lastAngle || car.steering !== this.lastSteering;
    const snap = this.snap || reset || Math.hypot(car.x - this.lastX, car.y - this.lastY) > 600;
    this.car.car.position.set(car.x, 0, car.y);
    this.car.car.rotation.y = -car.angle;
    this.car.wheels.forEach((wheel) => { wheel.rotation.y = -car.steering * 0.32; });
    if (snap) this.heading = car.angle;
    else if (elapsed > 0) {
      const difference = Math.atan2(Math.sin(car.angle - this.heading), Math.cos(car.angle - this.heading));
      this.heading += difference * (1 - Math.exp(-7 * elapsed));
    }
    const forwardX = Math.cos(this.heading), forwardZ = Math.sin(this.heading);
    const speed = Math.min(car.speed / 260, 1);
    const distance = 300 + speed * 36;
    this.desiredPosition.set(car.x - forwardX * distance, 245 + speed * 25, car.y - forwardZ * distance);
    this.desiredTarget.set(car.x + forwardX * (105 + speed * 60), 6, car.y + forwardZ * (105 + speed * 60));
    if (snap) {
      this.camera.position.copy(this.desiredPosition);
      this.cameraTarget.copy(this.desiredTarget);
    } else if (elapsed > 0) {
      const blend = 1 - Math.exp(-10 * elapsed);
      this.camera.position.lerp(this.desiredPosition, blend);
      this.cameraTarget.lerp(this.desiredTarget, blend);
    }
    this.camera.lookAt(this.cameraTarget);
    // A fixed-size repeated tile follows in whole tiles, so the grid never swims.
    this.ground.position.x = Math.round(car.x / 256) * 256;
    this.ground.position.z = Math.round(car.y / 256) * 256;
    const settling = elapsed > 0 && this.camera.position.distanceToSquared(this.desiredPosition) > 0.01;
    if (moved || snap || this.dirty || settling)
      this.renderer.render(this.scene, this.camera);
    this.lastX = car.x;
    this.lastY = car.y;
    this.lastAngle = car.angle;
    this.lastSteering = car.steering;
    this.snap = this.dirty = false;
  }

  capture(): HTMLCanvasElement | null {
    if (this.disposed || !this.visible || this.contextLost) return null;
    this.renderer.render(this.scene, this.camera);
    const copy = document.createElement("canvas");
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    copy.getContext("2d")!.drawImage(this.canvas, 0, 0);
    return copy;
  }

  snapshot() {
    return {
      visible: this.visible,
      ready: !!this.track && !this.contextLost && !this.disposed,
      camera: this.camera.position.toArray(),
      target: this.cameraTarget.toArray(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
      pendingTracks: this.pending.size,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.lost);
    this.canvas.removeEventListener("webglcontextrestored", this.restored);
    for (const candidate of [...this.pending]) candidate.dispose();
    disposeObject(this.scene);
    this.paperTexture.dispose();
    this.roadTexture.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}
