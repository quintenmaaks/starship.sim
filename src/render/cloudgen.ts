import * as THREE from 'three';
// Wolkenkaart op de GPU genereren (naadloos equirectangulair, 3D-ruis met domeinvervorming)
export function gpuCloudTexture(renderer: THREE.WebGLRenderer, w: number) {
  const h = w / 2;
  const rt = new THREE.WebGLRenderTarget(w, h, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping });
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: `in vec3 position; out vec2 vUv; void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `precision highp float; in vec2 vUv; out vec4 o;
      float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
      float noise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
      float fbm(vec3 p, int oct){ float s=0.0,a=0.5; for(int i=0;i<10;i++){ if(i>=oct) break; s+=a*noise(p); p=p*2.03+vec3(1.7,9.2,3.1); a*=0.5;} return s; }
      void main(){
        float lat = (vUv.y - 0.5) * 3.14159265;
        float lon = vUv.x * 6.2831853;
        vec3 p = vec3(cos(lat)*cos(lon), sin(lat), cos(lat)*sin(lon)) * 3.0;
        float L = abs(lat) * 57.2958;
        float band = 0.55 + 0.25*exp(-L*L/60.0) + 0.2*exp(-(L-55.0)*(L-55.0)/200.0) - 0.18*exp(-(L-25.0)*(L-25.0)/90.0);
        vec3 q = vec3(fbm(p + vec3(5.2,1.3,0.0), 4), fbm(p + vec3(1.7,9.2,4.4), 4), fbm(p + vec3(8.3,2.8,7.1), 4));
        // cycloonwervels
        float n = fbm(p * 1.6 + q * 2.2, 9);
        float v = clamp((n - (1.02 - band * 0.62)) * 3.4, 0.0, 1.0);
        v = pow(v, 0.85);
        // fijne cumulusstructuur
        v *= 0.75 + 0.5 * fbm(p * 14.0, 4);
        o = vec4(1.0, 1.0, 1.0, clamp(v, 0.0, 1.0));
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  const sc = new THREE.Scene(); sc.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt); renderer.render(sc, cam); renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
  rt.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return rt.texture;
}
