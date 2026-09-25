/**
 * Bathymetry WebGL Colorizer
 *
 * Pipeline:
 *   1. Float32Array (raw depth values, negative = ocean) uploaded as an R32F texture
 *   2. A WebGL2 fragment shader reads each texel, applies a deep-sea colormap,
 *      and outputs RGBA — transparent for land (depth >= 0), colored for ocean.
 *   3. The resulting canvas is converted to a PNG DataURL and fed into Cesium as
 *      a SingleTileImageryProvider covering the exact geographic bounds.
 *
 * Why WebGL2?
 *   - Native R32F texture → no precision loss from quantizing floats to bytes
 *   - GPU parallelism: ~10M pixels colored in a single draw call (~5ms)
 *   - CPU fallback would take ~500ms for a global tile
 */

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // Full-screen quad
  // Data is South-to-North (index 0 = South Pole).
  // WebGL texture reads index 0 into the bottom row (v_uv.y = 0.0), which naturally maps to the South Pole.
  v_uv = vec2(a_pos.x * 0.5 + 0.5, a_pos.y * 0.5 + 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 v_uv;
uniform sampler2D u_depth;   // R32F texture — raw depth metres (negative = ocean)
out vec4 fragColor;

// ── Deep-sea colormap matching reference style ──────────────────────────────
// Shallow → Semi-transparent cyan → Steel blue → Periwinkle → Deep indigo
vec3 oceanColor(float t) {
  // t = 0 (0m shelf) → 1 (6000m+ hadal)
  // Palette inspired by the reference: hazy periwinkle-indigo style
  vec3 c0 = vec3(0.55, 0.85, 0.92);  // 0m     bright cyan/turquoise (sunlit shelf)
  vec3 c1 = vec3(0.35, 0.65, 0.85);  // 300m   sky blue
  vec3 c2 = vec3(0.25, 0.48, 0.78);  // 800m   cornflower blue
  vec3 c3 = vec3(0.20, 0.36, 0.70);  // 1800m  medium periwinkle
  vec3 c4 = vec3(0.17, 0.26, 0.58);  // 3000m  slate indigo
  vec3 c5 = vec3(0.13, 0.18, 0.45);  // 4500m  deep indigo
  vec3 c6 = vec3(0.09, 0.12, 0.32);  // 6000m+ abyssal dark blue

  float s = t * 6.0;
  int lo  = int(clamp(floor(s), 0.0, 5.0));
  float f = fract(s);

  if (lo == 0) return mix(c0, c1, f);
  if (lo == 1) return mix(c1, c2, f);
  if (lo == 2) return mix(c2, c3, f);
  if (lo == 3) return mix(c3, c4, f);
  if (lo == 4) return mix(c4, c5, f);
               return mix(c5, c6, f);
}

void main() {
  float depth = texture(u_depth, v_uv).r;  // metres, negative for ocean

  // Land (depth >= 0) or sentinel → fully transparent so satellite map shows through
  if (depth >= -1.0) {
    fragColor = vec4(0.0);
    return;
  }

  // Normalise depth — use 6000m as full scale
  float absDep = clamp(-depth, 0.0, 6000.0);
  float t      = absDep / 6000.0;

  vec3 col = oceanColor(t);

  // Atmospheric scattering haze: mix a pale sky-blue into shallow areas
  // This creates the "light penetrating water" look from the reference images
  vec3 hazeTint = vec3(0.68, 0.88, 0.98);  // pale sky blue
  col = mix(mix(col, hazeTint, 0.28 * (1.0 - t)), col, t);

  // Alpha: shallow water semi-transparent (seafloor texture visible)
  //        deep water fully opaque (our color is all there is)
  float alpha = mix(0.55, 1.0, t * t);  // quadratic ramp for more realistic look

  fragColor = vec4(col * alpha, alpha);  // pre-multiplied alpha
}
`

function compileShader(gl, type, src) {
  const s = gl.createShader(type)
  gl.shaderSource(s, src)
  gl.compileShader(s)
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error('Shader compile: ' + gl.getShaderInfoLog(s))
  return s
}

/**
 * Render a Float32Array of depth values to an offscreen canvas using WebGL2.
 *
 * @param {Float32Array} depths  - Raw depth values in metres (ocean < 0, land ≥ 0)
 * @param {number}       width   - Number of longitude columns
 * @param {number}       height  - Number of latitude rows (north-to-south)
 * @returns {HTMLCanvasElement}  - Rendered RGBA canvas ready for Cesium
 */
export function renderBathymetryWebGL(depths, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width  = width
  canvas.height = height

  const gl = canvas.getContext('webgl2', { 
    premultipliedAlpha: true, 
    antialias: false,
    preserveDrawingBuffer: true 
  })
  if (!gl) throw new Error('WebGL2 not available')

  // ── Compile shaders ────────────────────────────────────────────────────────
  const prog = gl.createProgram()
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER,   VERT))
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FRAG))
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error('Program link: ' + gl.getProgramInfoLog(prog))
  gl.useProgram(prog)

  // ── Full-screen quad ───────────────────────────────────────────────────────
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'a_pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

  // ── Upload Float32Array as R32F texture ────────────────────────────────────
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  // MUST use NEAREST for float textures in WebGL unless OES_texture_float_linear is enabled
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, depths)
  gl.uniform1i(gl.getUniformLocation(prog, 'u_depth'), 0)

  // ── Render ─────────────────────────────────────────────────────────────────
  gl.viewport(0, 0, width, height)
  gl.clearColor(0, 0, 0, 0)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.enable(gl.BLEND)
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)   // pre-multiplied alpha
  gl.drawArrays(gl.TRIANGLES, 0, 6)

  return canvas
}
