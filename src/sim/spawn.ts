import * as THREE from 'three';
import { World } from './world';
import { Vehicle } from './vehicle';
import { VehicleSpec } from './spec';
import { MU_E, R_E, MU_M, R_M } from './constants';
import { REGIONS } from './terrain';

// Plaats een voertuig vrij in de ruimte/atmosfeer
export function spawnFree(w: World, spec: VehicleSpec, role: Vehicle['role'], fills?: number[]) {
  const v = w.spawnOnPad(spec, role, w.regions[0].id, w.regions[0].pads[0].id, 0, fills);
  w.anchors.delete(v); v.state = 'flying';
  return v;
}
// Terugkeer-startpunt: 'D' meter vóór het doel op 120 km hoogte, richting via grootcirkel
export function placeEntry(w: World, v: Vehicle, regionId: string, tx: number, tz: number, D: number, gammaDeg = -1.2, speed = 7400, approachAz = 90) {
  const reg = REGIONS[regionId];
  const tgtNow = w.toWorld(regionId, new THREE.Vector3(tx, 0, tz));
  // doel na ~650 s (aarde draait)
  const tgt = tgtNow.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 7.2921159e-5 * 650);
  const up0 = tgt.clone().normalize();
  // startpunt: langs grootcirkel terug vanaf het doel in de aanvliegrichting
  const f = w.ephem.frameAt('earth', reg.lat, reg.lon, 0, w.t + 650);
  const az = approachAz * Math.PI / 180;
  const dirH = f.north.clone().multiplyScalar(Math.cos(az)).addScaledVector(f.east, Math.sin(az)).normalize();
  const axis = new THREE.Vector3().crossVectors(up0, dirH).normalize();
  const ang = D / R_E;
  const startUp = up0.clone().applyAxisAngle(axis, -ang);
  v.pos.copy(startUp).multiplyScalar(R_E + 120000);
  const hdir = tgt.clone().sub(v.pos); hdir.addScaledVector(startUp, -hdir.dot(startUp)).normalize();
  const g = gammaDeg * Math.PI / 180;
  v.vel.copy(hdir).multiplyScalar(speed * Math.cos(g)).addScaledVector(startUp, speed * Math.sin(g));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), hdir);
  v.q.copy(q); v.holdQuat.copy(q);
}
// Cirkelbaan om de aarde (of maan) met inclinatie en knoop t.o.v. een locatie
export function placeOrbit(w: World, v: Vehicle, alt: number, body: 'earth' | 'moon' = 'earth', overLat = 26, overLon = -97, azDeg = 90, phaseAheadDeg = 0) {
  const R = body === 'earth' ? R_E : R_M, mu = body === 'earth' ? MU_E : MU_M;
  const f = w.ephem.frameAt(body, overLat, overLon, alt, w.t);
  const center = f.center.clone();
  const up = f.up.clone();
  const az = azDeg * Math.PI / 180;
  let dir = f.north.clone().multiplyScalar(Math.cos(az)).addScaledVector(f.east, Math.sin(az)).normalize();
  if (phaseAheadDeg) {
    const axis = new THREE.Vector3().crossVectors(up, dir).normalize();
    up.applyAxisAngle(axis, phaseAheadDeg * Math.PI / 180);
    dir.applyAxisAngle(axis, phaseAheadDeg * Math.PI / 180);
  }
  const r = R + alt;
  v.pos.copy(center).addScaledVector(up, r);
  const vc = Math.sqrt(mu / r);
  v.vel.copy(dir).multiplyScalar(vc);
  if (body === 'moon') v.vel.add(w.ephem.moonVel(w.t, new THREE.Vector3()));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  v.q.copy(q); v.holdQuat.copy(q);
  return { up, dir };
}
