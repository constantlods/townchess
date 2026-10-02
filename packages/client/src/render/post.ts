import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';

export type Quality = 'low' | 'medium' | 'high';

/**
 * Final grade: done in display space after tone mapping.
 * Split-tone (cold shadows, warm dirty highlights), desaturation toward olive, vignette, grain,
 * slight lens chromatic fringe, plus game-state accents (check / checkmate) and a fade.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uGrain: { value: 0.035 },
    uVignette: { value: 0.18 },
    uSaturation: { value: 0.78 },
    uShadowTint: { value: new THREE.Vector3(0.92, 1.0, 0.97) },
    uHighTint: { value: new THREE.Vector3(1.04, 0.98, 0.88) },
    uLift: { value: 0.012 },
    uContrast: { value: 1.08 },
    uFringe: { value: 0.0012 },
    uCheck: { value: 0 },
    uMate: { value: 0 },
    uFade: { value: 0 },
    uResolution: { value: new THREE.Vector2(1920, 1080) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uVignette, uSaturation, uLift, uContrast, uFringe, uCheck, uMate, uFade;
    uniform vec3 uShadowTint, uHighTint;
    uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * r2 * uFringe * 8.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      // desaturate toward luminance, keep a hint of warmth
      col = mix(vec3(l), col, uSaturation);
      // split tone
      vec3 tint = mix(uShadowTint, uHighTint, smoothstep(0.05, 0.6, l));
      col *= tint;
      // contrast around mid-grey + lift (never crush to pure black)
      col = (col - 0.18) * uContrast + 0.18;
      col = max(col, 0.0) + uLift * (1.0 - col);
      // vignette: ~10-20% at the corners
      float vig = 1.0 - uVignette * smoothstep(0.08, 0.55, r2 * 1.6);
      col *= vig;
      // game state accents: muted red creeping in from the edges only
      float edge = smoothstep(0.12, 0.5, r2 * 1.8);
      col = mix(col, col * vec3(1.25, 0.7, 0.66) + vec3(0.03, 0.0, 0.0), edge * uCheck * 0.55);
      col = mix(col, col * vec3(1.15, 0.45, 0.42), edge * uMate * 0.7);
      col *= 1.0 - uFade;
      // film grain (luma-weighted, 2-5%)
      float g = hash(vUv * uResolution + fract(uTime * 7.31) * 100.0) - 0.5;
      col += g * uGrain * (0.6 + 0.4 * (1.0 - l));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export class PostFX {
  composer: EffectComposer;
  grade: ShaderPass;
  bloom: UnrealBloomPass;
  gtao?: GTAOPass;
  bokeh?: BokehPass;
  fxaa?: ShaderPass;
  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    public quality: Quality,
    dof: boolean,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality === 'high' ? 4 : 0,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (quality !== 'low') {
      const gtao = new GTAOPass(scene, camera, size.x, size.y);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.9;
      gtao.updateGtaoMaterial({ radius: 0.12, distanceExponent: 1.5, thickness: 0.6, scale: 1.0, samples: quality === 'high' ? 16 : 8 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      this.composer.addPass(gtao);
      this.gtao = gtao;
    }
    if (dof && quality === 'high') {
      this.bokeh = new BokehPass(scene, camera, { focus: 0.7, aperture: 0.0016, maxblur: 0.0045 });
      this.composer.addPass(this.bokeh);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.55, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    if (quality !== 'high') {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.setSize(size.x, size.y);
  }

  setSize(w: number, h: number) {
    this.composer.setSize(w / this.renderer.getPixelRatio(), h / this.renderer.getPixelRatio());
    this.grade.uniforms.uResolution.value.set(w, h);
    if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  setFocus(dist: number) {
    if (this.bokeh) (this.bokeh.uniforms as Record<string, THREE.IUniform>).focus.value = dist;
  }

  render(t: number) {
    this.grade.uniforms.uTime.value = t;
    this.composer.render();
  }

  dispose() {
    this.composer.dispose();
    this.gtao?.dispose();
  }
}
