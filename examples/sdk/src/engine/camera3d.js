/**
 * Graph Nexus 3D camera. Original code.
 *
 * Orbit camera used by the chart's 3D view. It only does projection maths.
 * The camera turns the world about an orbit pivot (`target`); the chart's
 * existing view ({ zoom, panX, panY }) then applies as a screen-plane offset
 * and scale, so 2D pan / zoom code keeps working unchanged in 3D:
 *
 *   c      = rotate(world - target)            yaw about Y, then pitch about X
 *   s      = focal / (focal + c.z)             perspective scale (1 on the pivot plane)
 *   screen = (c.xy * s + pan) * zoom + centre
 *
 * With yaw = pitch = 0, target = 0 and z = 0 this is exactly the 2D projection.
 *
 *   project(x, y, z, view, size)         -> { x, y, depth, s } | null (behind the eye)
 *   unproject(sx, sy, depth, view, size) -> { x, y, z }   inverse at a camera depth
 *   orbit(dx, dy)                         drag in px -> yaw / pitch
 */

const MAX_PITCH = Math.PI / 2 - 0.01;
const ORBIT_SPEED = 0.005; // radians per dragged pixel
const KEYS = ['yaw', 'pitch', 'focal', 'targetX', 'targetY', 'targetZ'];

export function createCamera3D(opts = {}) {
  const cam = { yaw: 0, pitch: 0, focal: 1500, targetX: 0, targetY: 0, targetZ: 0 };
  // cos / sin of yaw and pitch, refreshed by set() (the only writer of cam), not per point.
  let cy = 1; let sy = 0; let cp = 1; let sp = 0;

  function rotate(x, y, z) {
    const x1 = x * cy + z * sy;
    const z1 = -x * sy + z * cy;
    return { x: x1, y: y * cp - z1 * sp, z: y * sp + z1 * cp };
  }

  function unrotate(x, y, z) {
    const y1 = y * cp + z * sp;
    const z1 = -y * sp + z * cp;
    return { x: x * cy - z1 * sy, y: y1, z: x * sy + z1 * cy };
  }

  const api = {
    /** A copy of { yaw, pitch, focal, targetX, targetY, targetZ }. */
    get state() { return { ...cam }; },
    set(next = {}) {
      KEYS.forEach(k => { if (Number.isFinite(next[k])) cam[k] = next[k]; });
      cam.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, cam.pitch));
      cam.focal = Math.max(1, cam.focal);
      cy = Math.cos(cam.yaw); sy = Math.sin(cam.yaw);
      cp = Math.cos(cam.pitch); sp = Math.sin(cam.pitch);
    },

    /** Camera-space point: depth > 0 is behind the pivot plane, < 0 in front of it. */
    toCamera(x, y, z) { return rotate(x - cam.targetX, y - cam.targetY, (z || 0) - cam.targetZ); },

    project(x, y, z, view, size) {
      const c = api.toCamera(x, y, z);
      const d = cam.focal + c.z;
      if (d <= 1) return null;
      const s = cam.focal / d;
      return {
        x: (c.x * s + view.panX) * view.zoom + size.w / 2,
        y: (c.y * s + view.panY) * view.zoom + size.h / 2,
        depth: c.z,
        s,
      };
    },

    unproject(sx, sy, depth, view, size) {
      const s = cam.focal / (cam.focal + depth);
      const w = unrotate(
        ((sx - size.w / 2) / view.zoom - view.panX) / s,
        ((sy - size.h / 2) / view.zoom - view.panY) / s,
        depth,
      );
      return { x: w.x + cam.targetX, y: w.y + cam.targetY, z: w.z + cam.targetZ };
    },

    orbit(dx, dy) { api.set({ yaw: cam.yaw + dx * ORBIT_SPEED, pitch: cam.pitch + dy * ORBIT_SPEED }); },
  };
  api.set(opts);
  return api;
}

export const CAMERA_KEYS = KEYS;

/** Convex hull of 2D points {x, y} (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points) {
  const p = [...points].sort((m, n) => m.x - n.x || m.y - n.y);
  if (p.length < 3) return p;
  const turn = (o, q, r) => (q.x - o.x) * (r.y - o.y) - (q.y - o.y) * (r.x - o.x);
  const half = list => {
    const out = [];
    list.forEach(pt => {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], pt) <= 0) out.pop();
      out.push(pt);
    });
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

// The cone's 16-point base ring, as cos / sin of (k / 16) * 2 pi.
const RING_COS = Array.from({ length: 16 }, (_, k) => Math.cos((k / 16) * Math.PI * 2));
const RING_SIN = Array.from({ length: 16 }, (_, k) => Math.sin((k / 16) * Math.PI * 2));

/**
 * Screen outline of a 3D cone (an arrowhead): tip at `tip` (world [x, y, z]), pointing along
 * the unit vector `dir`, `length` long with a base of `radius`. `project(x, y, z)` returns
 * {x, y} or null. The outline is the convex hull of the projected tip and a 16-point base
 * ring, which is the cone's silhouette. Returns { base, outline }, or null if any point is
 * behind the eye.
 */
export function coneOutline(project, tip, dir, length, radius) {
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const u0 = cross(dir, Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  const ul = Math.hypot(u0[0], u0[1], u0[2]);
  const u = [u0[0] / ul, u0[1] / ul, u0[2] / ul];
  const v = cross(dir, u);
  const bx = tip[0] - dir[0] * length; const by = tip[1] - dir[1] * length; const bz = tip[2] - dir[2] * length;
  const tipScreen = project(tip[0], tip[1], tip[2]);
  const base = project(bx, by, bz);
  if (!tipScreen || !base) return null;
  const pts = [tipScreen];
  for (let k = 0; k < 16; k++) {
    const c = RING_COS[k]; const s = RING_SIN[k];
    const q = project(bx + radius * (c * u[0] + s * v[0]), by + radius * (c * u[1] + s * v[1]), bz + radius * (c * u[2] + s * v[2]));
    if (!q) return null;
    pts.push(q);
  }
  return { base, outline: convexHull(pts) };
}
