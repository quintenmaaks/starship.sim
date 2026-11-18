import * as THREE from 'three';
import { MOON_A, MOON_INC, MOON_PERIOD, OMEGA_E, R_E, R_M, SITES, MU_E, MU_M } from './constants';

const YEAR = 365.25 * 86400;
const DECL = -19 * Math.PI / 180; // zonsdeclinatie (najaar)

// Ephemeris: aarde draait om +Y-as. Coördinaten ECI in meters.
export class Ephemeris {
  epoch: number;      // globale tijd (s) op missietijd 0
  theta0: number;     // aardrotatiehoek op t=0
  constructor(epoch = 0, theta0 = 0) { this.epoch = epoch; this.theta0 = theta0; }
  T(t: number) { return this.epoch + t; }
  earthTheta(t: number) { return this.theta0 + OMEGA_E * t; }
  sunDir(t: number, out = new THREE.Vector3()) {
    const s = 2 * Math.PI * this.T(t) / YEAR + 1.2;
    return out.set(Math.cos(DECL) * Math.cos(s), Math.sin(DECL), -Math.cos(DECL) * Math.sin(s));
  }
  // Kies theta0 zodat de lokale zonnetijd op (lon) gelijk is aan hour bij t=0
  setLocalHour(lon: number, hour: number) {
    const s = 2 * Math.PI * this.T(0) / YEAR + 1.2;
    this.theta0 = s + (hour - 12) / 24 * 2 * Math.PI - lon * Math.PI / 180;
  }
  moonAngle(t: number) { return 2 * Math.PI * this.T(t) / MOON_PERIOD + 0.7; }
  moonPos(t: number, out = new THREE.Vector3()) {
    const M = this.moonAngle(t);
    const x = MOON_A * Math.cos(M), z = -MOON_A * Math.sin(M);
    // kantelen om x-as
    return out.set(x, -z * Math.sin(MOON_INC), z * Math.cos(MOON_INC));
  }
  moonVel(t: number, out = new THREE.Vector3()) {
    const M = this.moonAngle(t);
    const w = 2 * Math.PI / MOON_PERIOD;
    const x = -MOON_A * w * Math.sin(M), z = -MOON_A * w * Math.cos(M);
    return out.set(x, -z * Math.sin(MOON_INC), z * Math.cos(MOON_INC));
  }
  moonNormal(out = new THREE.Vector3()) {
    // baan-normaal (h = r x v richting)
    return out.set(0, Math.cos(MOON_INC), Math.sin(MOON_INC)).normalize();
  }
  // Rotatiematrix maan-lokaal -> ECI: +x naar aarde, +y noord (baan-normaal)
  moonQuat(t: number, out = new THREE.Quaternion()) {
    const p = this.moonPos(t, _v1);
    const x = _v2.copy(p).multiplyScalar(-1).normalize();
    const y = this.moonNormal(_v3);
    y.sub(_v4.copy(x).multiplyScalar(y.dot(x))).normalize();
    const z = _v4.crossVectors(x, y);
    _m.makeBasis(x, y, z);
    return out.setFromRotationMatrix(_m);
  }
  earthQuat(t: number, out = new THREE.Quaternion()) {
    return out.setFromAxisAngle(_Y, this.earthTheta(t));
  }
  // Positie (ECI) van punt op lichaam
  surfacePoint(body: 'earth' | 'moon', lat: number, lon: number, alt: number, t: number, out = new THREE.Vector3()) {
    const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
    out.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo));
    if (body === 'earth') {
      out.multiplyScalar(R_E + alt).applyQuaternion(this.earthQuat(t, _q));
    } else {
      out.multiplyScalar(R_M + alt).applyQuaternion(this.moonQuat(t, _q)).add(this.moonPos(t, _v5));
    }
    return out;
  }
  // Lokaal frame (oost, noord, omhoog) + snelheid van een site
  siteFrame(siteId: string, t: number, alt = 0, latOff = 0, lonOff = 0) {
    const s = SITES[siteId];
    return this.frameAt(s.body, s.lat + latOff, s.lon + lonOff, alt, t);
  }
  frameAt(body: 'earth' | 'moon', lat: number, lon: number, alt: number, t: number) {
    const pos = this.surfacePoint(body, lat, lon, alt, t, new THREE.Vector3());
    const center = body === 'earth' ? new THREE.Vector3() : this.moonPos(t, new THREE.Vector3());
    const up = pos.clone().sub(center).normalize();
    const axis = body === 'earth' ? new THREE.Vector3(0, 1, 0) : this.moonNormal(new THREE.Vector3());
    const east = new THREE.Vector3().crossVectors(axis, up).normalize();
    const north = new THREE.Vector3().crossVectors(up, east).normalize();
    const vel = new THREE.Vector3();
    if (body === 'earth') vel.crossVectors(new THREE.Vector3(0, OMEGA_E, 0), pos);
    else {
      const w = 2 * Math.PI / MOON_PERIOD;
      vel.crossVectors(axis.clone().multiplyScalar(w), pos.clone().sub(center)).add(this.moonVel(t, new THREE.Vector3()));
    }
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, north.clone().multiplyScalar(-1)));
    // lokaal: x=oost, y=omhoog, z=zuid (rechtshandig)
    return { pos, up, east, north, vel, quat, center };
  }
  // Graviteitsversnelling (aarde + maan + indirecte term) op positie r
  gravity(r: THREE.Vector3, t: number, out: THREE.Vector3) {
    const d = r.length();
    out.copy(r).multiplyScalar(-MU_E / (d * d * d));
    const m = this.moonPos(t, _g1);
    const rel = _g2.copy(r).sub(m);
    const dm = rel.length();
    out.addScaledVector(rel, -MU_M / (dm * dm * dm));
    const mm = m.length();
    out.addScaledVector(m, -MU_M / (mm * mm * mm));
    return out;
  }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _g1 = new THREE.Vector3(), _g2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _Y = new THREE.Vector3(0, 1, 0);
export { R_E };
