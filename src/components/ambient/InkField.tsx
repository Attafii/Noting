import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../lib/theme';
import { cn } from '../../lib/utils';

/**
 * InkField — the brand's ambient shader background (landing, unlock, invite).
 *
 * A WebGL2 fragment shader: slow domain-warped noise drifting between ink
 * near-black and a low ember glow. Deliberately low-contrast so headline
 * text keeps WCAG AA margins on top of it.
 *
 * Performance contract:
 *  - DPR capped at 1.5, render loop capped at 30fps.
 *  - Pauses on tab-hide (visibilitychange) and when scrolled offscreen
 *    (IntersectionObserver) — zero GPU work while not visible.
 *  - prefers-reduced-motion, or the Settings → "Ambient motion" switch off,
 *    renders ONE static frame.
 *  - No WebGL2 → the CSS gradient fallback below (identical palette).
 *
 * Lazy-loaded by every page that uses it, so the shader never ships in the
 * main chunk.
 */

const VERTEX = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAGMENT = `#version 300 es
precision mediump float;
out vec4 outColor;
uniform vec2 u_res;
uniform float u_time;
uniform float u_light; // 0 = ink dark palette, 1 = paper light palette

// -- hash / value noise / fbm -------------------------------------------------
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * noise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 p = vec2(uv.x * aspect, uv.y) * 2.6;
  float t = u_time * 0.045;

  // Domain warp: two fbm passes curl the field so it reads as slow ink.
  vec2 q = vec2(fbm(p + vec2(0.0, 0.0) + t * 0.6), fbm(p + vec2(5.2, 1.3) - t * 0.4));
  vec2 r = vec2(fbm(p + 3.4 * q + vec2(1.7, 9.2) + t * 0.25), fbm(p + 3.4 * q + vec2(8.3, 2.8)));
  float f = fbm(p + 3.0 * r);

  // Palette: base -> raised surface, in ink (dark) or paper (light).
  vec3 inkDark     = vec3(0.047, 0.043, 0.039); // #0c0b0a
  vec3 surfDark    = vec3(0.102, 0.094, 0.082); // #1a1815
  vec3 inkLight    = vec3(0.961, 0.957, 0.953); // #f5f4f3
  vec3 surfLight   = vec3(1.0, 0.988, 0.976);   // #fffdf9
  vec3 base = mix(inkDark, inkLight, u_light);
  vec3 surf = mix(surfDark, surfLight, u_light);
  vec3 ember = vec3(0.910, 0.455, 0.231); // #e8743b

  vec3 col = mix(base, surf, smoothstep(0.25, 0.85, f));

  // Ember glow rides the warp's crests, masked to keep overall intensity low
  // and concentrated away from the top-left where headlines sit. On paper the
  // tint is weaker still — ember on light needs far less to read as warm.
  float glow = smoothstep(0.55, 0.95, f) * (0.5 + 0.5 * r.x);
  float corner = smoothstep(0.15, 1.0, uv.x) * smoothstep(0.1, 0.9, 1.0 - uv.y);
  col += ember * glow * mix(0.16, 0.07, u_light) * mix(0.35, 1.0, corner);

  // Gentle vignette: keeps edges (and any overlaid text) readable. On light
  // mode it barely darkens — paper wants flat, ink wants depth.
  float vig = smoothstep(1.35, 0.35, length(uv - 0.5));
  col *= mix(mix(0.82, 1.0, vig), mix(0.97, 1.0, vig), u_light);

  outColor = vec4(col, 1.0);
}
`;

const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function InkField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Set when WebGL2 is unavailable → CSS gradient fallback renders instead.
  const [unsupported, setUnsupported] = useState(false);
  const theme = useTheme();
  // Read by the draw call each frame; a theme flip repaints without
  // rebuilding the GL context (see the effect below).
  const lightRef = useRef(theme.mode === 'light' ? 1 : 0);
  // Bumped on theme change so the still-frame branch can repaint once.
  const repaintRef = useRef<() => void>(() => {});
  const light = theme.mode === 'light' ? 1 : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      // Let the compositor own the frame; we only ever paint a still field.
      powerPreference: 'low-power',
    });
    if (!gl) {
      setUnsupported(true);
      return;
    }
    // Aliases: function declarations below are hoisted, so the guard narrowing
    // on canvas/gl can't reach their bodies — the aliases' types can.
    const cnv = canvas;
    const ctx = gl;

    const vs = compile(ctx, ctx.VERTEX_SHADER, VERTEX);
    const fs = compile(ctx, ctx.FRAGMENT_SHADER, FRAGMENT);
    const program = ctx.createProgram();
    if (!vs || !fs || !program) {
      setUnsupported(true);
      return;
    }
    ctx.attachShader(program, vs);
    ctx.attachShader(program, fs);
    ctx.linkProgram(program);
    if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) {
      setUnsupported(true);
      return;
    }
    ctx.useProgram(program);

    // Fullscreen triangle-strip quad.
    const buffer = ctx.createBuffer();
    ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer);
    ctx.bufferData(
      ctx.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      ctx.STATIC_DRAW,
    );
    const pos = ctx.getAttribLocation(program, 'a_pos');
    ctx.enableVertexAttribArray(pos);
    ctx.vertexAttribPointer(pos, 2, ctx.FLOAT, false, 0, 0);
    const resLoc = ctx.getUniformLocation(program, 'u_res');
    const timeLoc = ctx.getUniformLocation(program, 'u_time');
    const lightLoc = ctx.getUniformLocation(program, 'u_light');

    let width = 0;
    let height = 0;
    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const w = Math.max(1, Math.floor(cnv.clientWidth * dpr));
      const h = Math.max(1, Math.floor(cnv.clientHeight * dpr));
      if (w === width && h === height) return;
      width = w;
      height = h;
      cnv.width = w;
      cnv.height = h;
      ctx.viewport(0, 0, w, h);
      ctx.uniform2f(resLoc, w, h);
    }

    function draw(timeSeconds: number) {
      ctx.uniform1f(timeLoc, timeSeconds);
      ctx.uniform1f(lightLoc, lightRef.current);
      ctx.drawArrays(ctx.TRIANGLE_STRIP, 0, 4);
    }

    // Motion policy: OS preference or the Settings switch → one still frame.
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    function motionAllowed(): boolean {
      return !motionQuery.matches && readAmbientPref();
    }

    let raf = 0;
    let lastPaint = 0;
    let running = false;
    let visible = !document.hidden;
    let onscreen = true;
    const started = performance.now();

    function loop(now: number) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (now - lastPaint < FRAME_MS) return;
      lastPaint = now;
      resize();
      draw((now - started) / 1000);
    }

    function sync() {
      const shouldRun = visible && onscreen && motionAllowed();
      if (shouldRun && !running) {
        running = true;
        resize();
        raf = requestAnimationFrame(loop);
      } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(raf);
        // Park on a still frame so the background never blanks mid-fade.
        if (visible && onscreen) {
          resize();
          draw((performance.now() - started) / 1000);
        }
      } else if (!shouldRun && visible && onscreen) {
        // Motion off: paint exactly one frame, never loop.
        resize();
        draw(0);
      }
    }

    const onVisibility = () => {
      visible = !document.hidden;
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // The field is fixed-position full-viewport, but pages taller than it can
    // scroll the canvas region away — observe the canvas itself.
    const observer = new IntersectionObserver((entries) => {
      onscreen = entries.some((e) => e.isIntersecting);
      sync();
    });
    observer.observe(canvas);

    const onMotionChange = () => sync();
    motionQuery.addEventListener('change', onMotionChange);
    // Settings toggle flips a custom event before the pref read below.
    window.addEventListener('noting:ambient-motion', onMotionChange);

    // Theme flips repaint even when the loop is parked (motion off): the
    // canvas would otherwise keep the previous palette until the next frame.
    repaintRef.current = () => {
      if (running) return; // loop repaints continuously anyway
      resize();
      draw(motionAllowed() ? (performance.now() - started) / 1000 : 0);
    };

    sync();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      motionQuery.removeEventListener('change', onMotionChange);
      window.removeEventListener('noting:ambient-motion', onMotionChange);
      observer.disconnect();
      repaintRef.current = () => {};
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  // Theme switch: sync the palette uniform, then repaint the (possibly
  // parked) canvas with it.
  useEffect(() => {
    lightRef.current = light;
    repaintRef.current();
  }, [light]);

  if (unsupported) {
    // CSS fallback: same palette, same position, no JS.
    return (
      <div
        aria-hidden
        className={cn(
          'pointer-events-none fixed inset-0 -z-10',
          theme.mode === 'light'
            ? 'bg-[radial-gradient(120%_90%_at_85%_15%,rgb(232_116_59/0.10),transparent_55%),radial-gradient(90%_70%_at_10%_90%,rgb(255_253_249/0.9),transparent_60%)]'
            : 'bg-[radial-gradient(120%_90%_at_85%_15%,rgb(232_116_59/0.14),transparent_55%),radial-gradient(90%_70%_at_10%_90%,rgb(26_24_21/0.9),transparent_60%)]',
        )}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}

/** Read without importing prefs (keeps this module dependency-light). */
function readAmbientPref(): boolean {
  try {
    return localStorage.getItem('ambient-motion') !== '0';
  } catch {
    return true;
  }
}

/** Fired by Settings when the ambient-motion switch changes. */
// (The event is dispatched by setAmbientMotion in ../lib/prefs so callers
// can't forget it — this module only listens for `noting:ambient-motion`.)
