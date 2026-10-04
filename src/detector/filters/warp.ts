// Photo Booth-style face distortions: a WebGL pass that bulges, pinches,
// swirls or stretches small regions of the frame around face landmarks.

import type { FaceEffectId } from '../../shared/filters';
import type { Landmark, Point } from '../swipe';
import { faceGeometry } from './face';

export const WarpKind = {
  Bulge: 0,    // strength > 0 magnifies, < 0 shrinks
  Swirl: 1,    // strength = max rotation in radians
  StretchX: 2, // strength > 0 widens horizontally
} as const;
export type WarpKind = (typeof WarpKind)[keyof typeof WarpKind];

export interface WarpOp {
  kind: WarpKind;
  center: Point; // pixels
  radius: number; // pixels
  strength: number;
}

export const MAX_OPS = 6;

// FaceLandmarker mesh indices.
const NOSE_TIP = 1;
const UPPER_LIP = 13;
const LOWER_LIP = 14;
const CHIN = 152;
const FOREHEAD = 151;
const RIGHT_CHEEK = 205;
const LEFT_CHEEK = 425;

const px = (lms: readonly Landmark[], i: number, w: number, h: number): Point => ({ x: lms[i].x * w, y: lms[i].y * h });

/** Whether an effect is a distortion handled by the warp pass. */
export function isWarpEffect(effect: FaceEffectId): boolean {
  return effect === 'bugout' || effect === 'chipmunk' || effect === 'alien' || effect === 'twirl' || effect === 'frog';
}

/** The warp operations for a face effect (empty if it isn't a distortion). `t` is time in ms. */
export function warpOps(effect: FaceEffectId, lms: readonly Landmark[], w: number, h: number, t: number): WarpOp[] {
  const g = faceGeometry(lms, w, h);
  const d = g.eyeDistance;
  switch (effect) {
    case 'bugout':
      return [g.rightEye, g.leftEye].map((center) => ({ kind: WarpKind.Bulge, center, radius: d * 0.55, strength: 0.6 }));
    case 'chipmunk':
      return [
        ...[RIGHT_CHEEK, LEFT_CHEEK].map((i) => ({ kind: WarpKind.Bulge, center: px(lms, i, w, h), radius: d * 0.75, strength: 0.5 })),
        { kind: WarpKind.Bulge, center: px(lms, CHIN, w, h), radius: d * 0.6, strength: -0.3 },
      ];
    case 'alien': {
      const brow = px(lms, FOREHEAD, w, h);
      return [
        { kind: WarpKind.Bulge, center: { x: brow.x, y: brow.y - d * 0.2 }, radius: d * 1.3, strength: 0.45 },
        ...[g.rightEye, g.leftEye].map((center) => ({ kind: WarpKind.Bulge, center, radius: d * 0.45, strength: 0.35 })),
        { kind: WarpKind.Bulge, center: px(lms, UPPER_LIP, w, h), radius: d * 0.9, strength: -0.55 },
      ];
    }
    case 'twirl':
      return [{ kind: WarpKind.Swirl, center: px(lms, NOSE_TIP, w, h), radius: d * 1.0, strength: 2.6 * Math.sin(t / 450) }];
    case 'frog': {
      const up = px(lms, UPPER_LIP, w, h);
      const low = px(lms, LOWER_LIP, w, h);
      const mouth = { x: (up.x + low.x) / 2, y: (up.y + low.y) / 2 };
      return [
        { kind: WarpKind.StretchX, center: mouth, radius: d * 1.1, strength: 0.45 },
        ...[g.rightEye, g.leftEye].map((center) => ({ kind: WarpKind.Bulge, center, radius: d * 0.45, strength: 0.3 })),
      ];
    }
    default:
      return [];
  }
}

const VERTEX = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

// Works in top-left-origin pixel coordinates; each op moves the sample point.
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D tex;
uniform vec2 size;
uniform int count;
uniform vec4 ops[${MAX_OPS}];   // x, y, radius, strength
uniform int kinds[${MAX_OPS}];
out vec4 color;
void main() {
  vec2 p = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
  for (int i = 0; i < ${MAX_OPS}; i++) {
    if (i >= count) break;
    vec2 c = ops[i].xy;
    float r = ops[i].z;
    float s = ops[i].w;
    vec2 d = p - c;
    float dist = length(d);
    if (dist >= r) continue;
    float t = dist / r;
    float falloff = (1.0 - t * t);
    if (kinds[i] == 0) {
      p = c + d * (1.0 - s * falloff);
    } else if (kinds[i] == 1) {
      float a = s * falloff * falloff;
      float cs = cos(a), sn = sin(a);
      p = c + vec2(cs * d.x - sn * d.y, sn * d.x + cs * d.y);
    } else {
      p = c + vec2(d.x * (1.0 - s * falloff), d.y);
    }
  }
  color = texture(tex, p / size);
}`;

export class FaceWarp {
  private readonly canvas = new OffscreenCanvas(640, 480);
  private readonly gl: WebGL2RenderingContext | null;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private uniforms: Record<'size' | 'count' | 'ops' | 'kinds', WebGLUniformLocation | null> | null = null;

  constructor() {
    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (this.gl) this.setup(this.gl);
  }

  get available(): boolean {
    return !!this.program;
  }

  private setup(gl: WebGL2RenderingContext): void {
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('[swipe-skip] warp shader', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    if (!vs || !fs) return;
    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program);

    // One triangle that covers the screen.
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.uniforms = {
      size: gl.getUniformLocation(program, 'size'),
      count: gl.getUniformLocation(program, 'count'),
      ops: gl.getUniformLocation(program, 'ops'),
      kinds: gl.getUniformLocation(program, 'kinds'),
    };
    this.program = program;
  }

  /** Warps `ctx`'s canvas in place. */
  apply(ctx: OffscreenCanvasRenderingContext2D, ops: readonly WarpOp[]): void {
    const gl = this.gl;
    if (!gl || !this.program || !this.uniforms || !ops.length) return;
    const { width: w, height: h } = ctx.canvas;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);

    const used = ops.slice(0, MAX_OPS);
    const packed = new Float32Array(MAX_OPS * 4);
    const kinds = new Int32Array(MAX_OPS);
    used.forEach((op, i) => {
      packed.set([op.center.x, op.center.y, op.radius, op.strength], i * 4);
      kinds[i] = op.kind;
    });
    gl.uniform2f(this.uniforms.size, w, h);
    gl.uniform1i(this.uniforms.count, used.length);
    gl.uniform4fv(this.uniforms.ops, packed);
    gl.uniform1iv(this.uniforms.kinds, kinds);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    ctx.drawImage(this.canvas, 0, 0);
  }
}
