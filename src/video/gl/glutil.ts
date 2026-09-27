// Small WebGL2 helpers.

export function compileShader(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader ${name} failed to compile:\n${log}`);
  }
  return sh;
}

export class Program {
  readonly prog: WebGLProgram;
  private uniforms = new Map<string, WebGLUniformLocation | null>();

  constructor(readonly gl: WebGL2RenderingContext, vs: string, fs: string, name: string, attribs: string[] = []) {
    const p = gl.createProgram()!;
    gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vs, `${name}.vert`));
    gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fs, `${name}.frag`));
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`Program ${name} failed to link:\n${gl.getProgramInfoLog(p)}`);
    }
    this.prog = p;
  }

  use(): void {
    this.gl.useProgram(this.prog);
  }

  loc(name: string): WebGLUniformLocation | null {
    if (!this.uniforms.has(name)) this.uniforms.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.uniforms.get(name)!;
  }

  i(name: string, v: number): void {
    this.gl.uniform1i(this.loc(name), v);
  }
  u(name: string, v: number): void {
    this.gl.uniform1ui(this.loc(name), v);
  }
  f(name: string, v: number): void {
    this.gl.uniform1f(this.loc(name), v);
  }
  f2(name: string, a: number, b: number): void {
    this.gl.uniform2f(this.loc(name), a, b);
  }
  f4(name: string, a: number, b: number, c: number, d: number): void {
    this.gl.uniform4f(this.loc(name), a, b, c, d);
  }
}

export interface TexOpts {
  internalFormat: number;
  format: number;
  type: number;
  filter?: number;
  wrap?: number;
}

export function createTexture(gl: WebGL2RenderingContext, w: number, h: number, o: TexOpts, data: ArrayBufferView | null = null): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internalFormat, w, h, 0, o.format, o.type, data);
  const filter = o.filter ?? gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, o.wrap ?? gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, o.wrap ?? gl.CLAMP_TO_EDGE);
  return t;
}

export class RenderTarget {
  fbo: WebGLFramebuffer;
  textures: WebGLTexture[];
  constructor(readonly gl: WebGL2RenderingContext, readonly w: number, readonly h: number, formats: TexOpts[]) {
    this.fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    this.textures = formats.map((f, i) => {
      const t = createTexture(gl, w, h, f);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
      return t;
    });
    gl.drawBuffers(formats.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incomplete: 0x${st.toString(16)}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  bind(): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo);
    this.gl.viewport(0, 0, this.w, this.h);
  }

  dispose(): void {
    this.gl.deleteFramebuffer(this.fbo);
    for (const t of this.textures) this.gl.deleteTexture(t);
  }
}

/** Fullscreen triangle vertex shader producing `uv` in [0,1]. */
export const FULLSCREEN_VS = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
