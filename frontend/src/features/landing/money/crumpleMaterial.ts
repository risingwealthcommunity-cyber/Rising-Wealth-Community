import * as THREE from 'three';

export interface CrumpleUniforms {
  uCrumple: { value: number };
  uSeed: { value: number };
}

export interface CrumpleMaterial {
  material: THREE.MeshStandardMaterial;
  uniforms: CrumpleUniforms;
}

const NOISE = /* glsl */ `
float hash31(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
        mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
        mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
`;

/**
 * A paper-like material whose vertices are pushed around on the GPU by a single
 * `uCrumple` uniform (0 = flat, 1 = fully scrunched). No geometry is rebuilt per
 * frame, so crumpling many notes costs almost nothing. Flat shading turns the
 * displaced triangles into sharp creases.
 */
export function createCrumpleMaterial(map: THREE.Texture, seed: number): CrumpleMaterial {
  const uniforms: CrumpleUniforms = {
    uCrumple: { value: 0 },
    uSeed: { value: seed }
  };

  const material = new THREE.MeshStandardMaterial({
    map,
    side: THREE.DoubleSide,
    flatShading: true,
    roughness: 0.62,
    metalness: 0.04
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCrumple = uniforms.uCrumple;
    shader.uniforms.uSeed = uniforms.uSeed;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uCrumple;
uniform float uSeed;
varying float vFold;
${NOISE}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec2 cp = position.xy;
float fa = vnoise(vec3(cp * 1.3, uSeed));
float fb = vnoise(vec3(cp * 3.1, uSeed + 7.3));
float fc = vnoise(vec3(cp * 6.8, uSeed + 13.1));
float ridgeB = 1.0 - abs(2.0 * fb - 1.0);
float ridgeA = 1.0 - abs(2.0 * fa - 1.0);
vFold = ridgeA * 0.6 + ridgeB * 0.7 + fc * 0.4;
vec2 pulled = cp * (1.0 - 0.6 * uCrumple);
vec2 jitter = vec2(fb - 0.5, fc - 0.5) * 0.75 * uCrumple;
transformed = vec3(pulled + jitter, (vFold - 0.85) * 1.5 * uCrumple + (1.0 - dot(cp, cp) * 0.18) * 0.35 * uCrumple);`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uCrumple;
varying float vFold;`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb *= 1.0 + (0.8 - vFold) * 0.55 * uCrumple;`
      );
  };
  // Every note shares the same compiled program; only the uniform values differ.
  material.customProgramCacheKey = () => 'rwc-crumple-v1';

  return { material, uniforms };
}
