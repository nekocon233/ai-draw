// Deterministic still-frame extraction using the pinned Spine 2.1 runtime and CPU WebGL.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/opt/tools/czn/render/package.json');
const puppeteer = require('puppeteer-core');
const root = path.resolve(process.argv[2]);
const limit = Number(process.argv[3] || 0);
const jobs = JSON.parse(fs.readFileSync(path.join(root, 'jobs.json')));
fs.mkdirSync(path.join(root, 'poses'), { recursive: true });
const browser = await puppeteer.launch({executablePath: '/opt/google/chrome/chrome', headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage();
  await page.addScriptTag({path: path.join(root, 'tools/spine.js')});
  await page.evaluate(() => {
    window.renderPose = async ({json, atlasText, png, phase, action}) => {
      const image = new Image(); image.src = png; await image.decode();
      const atlas = new spine.Atlas(atlasText, {load(p) {
        p.width ||= image.width; p.height ||= image.height;
        p.rendererObject = image;
      }, unload() {}});
      if (atlas.pages.length !== 1) throw new Error('multiple_atlas_pages_not_supported');
      const reader = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
      const data = reader.readSkeletonData(json);
      const skeleton = new spine.Skeleton(data);
      skeleton.setToSetupPose();
      const animation = data.animations.find(item => item.name === action);
      if (!animation) throw new Error('matching_animation_missing:' + action);
      animation.apply(skeleton, -1, animation.duration * phase, false, []);
      skeleton.updateWorldTransform();
      const pieces = [], densities = [];
      for (const slot of skeleton.drawOrder) {
        const attachment = slot.attachment;
        if (!attachment || attachment.type === spine.AttachmentType.boundingbox ||
            /shadow|^fx|effect|smoke|dust|blood|trail|swoosh|slash/i.test(slot.data.name) || slot.data.additiveBlending) continue;
        const a = slot.a * attachment.a;
        if (a < 0.05) continue;
        const vertices = [];
        let indices;
        if (attachment.type === spine.AttachmentType.region) {
          attachment.computeVertices(0, 0, slot.bone, vertices);
          indices = [0, 1, 2, 0, 2, 3];
        } else {
          attachment.computeWorldVertices(0, 0, slot, vertices);
          indices = Array.from(attachment.triangles);
        }
        if (!vertices.every(Number.isFinite)) throw new Error('invalid_vertices:' + slot.data.name);
        const region = attachment.rendererObject;
        if (attachment.width > 0) densities.push(region.originalWidth / attachment.width * image.width / atlas.pages[0].width);
        pieces.push({vertices, indices, uv: attachment.uvs,
          color: [slot.r * attachment.r, slot.g * attachment.g, slot.b * attachment.b, a]});
      }
      if (!pieces.length) throw new Error('empty_pose');
      const all = pieces.flatMap(p => p.vertices);
      const xs = all.filter((_, i) => i % 2 === 0), ys = all.filter((_, i) => i % 2 === 1);
      const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
      densities.sort((a,b) => a-b);
      const scale = Math.min(densities[Math.floor(densities.length / 2)] || 1, 1400 / Math.max(maxX-minX, maxY-minY));
      const pad = 8;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil((maxX-minX) * scale) + pad * 2;
      canvas.height = Math.ceil((maxY-minY) * scale) + pad * 2;
      if (canvas.width < 16 || canvas.height < 16) throw new Error('invalid_bounds');
      const gl = canvas.getContext('webgl', {alpha:true, premultipliedAlpha:true, preserveDrawingBuffer:true, antialias:false});
      const shader = (type, source) => {
        const value = gl.createShader(type); gl.shaderSource(value, source); gl.compileShader(value);
        if (!gl.getShaderParameter(value, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(value));
        return value;
      };
      const program = gl.createProgram();
      gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 pos; attribute vec2 uv; varying vec2 v; void main(){gl_Position=vec4(pos,0.,1.);v=uv;}'));
      gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float; uniform sampler2D tex; uniform vec4 color; varying vec2 v; void main(){gl_FragColor=texture2D(tex,v)*color;}'));
      gl.linkProgram(program); gl.useProgram(program);
      const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.viewport(0,0,canvas.width,canvas.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      const position = gl.getAttribLocation(program,'pos'), uv = gl.getAttribLocation(program,'uv');
      gl.enableVertexAttribArray(position); gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(position,2,gl.FLOAT,false,16,0); gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
      for (const piece of pieces) {
        const values = [];
        for (const index of piece.indices) {
          values.push(((piece.vertices[index*2]-minX)*scale+pad)/canvas.width*2-1,
                      ((piece.vertices[index*2+1]-minY)*scale+pad)/canvas.height*2-1,
                      piece.uv[index*2],piece.uv[index*2+1]);
        }
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STREAM_DRAW);
        gl.uniform4fv(gl.getUniformLocation(program,'color'),piece.color);
        gl.drawArrays(gl.TRIANGLES,0,piece.indices.length);
      }
      const result = {png:canvas.toDataURL('image/png'),width:canvas.width,height:canvas.height,
                      animation:animation?.name,pieces:pieces.length,scale};
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return result;
    };
  });
  let count = 0;
  for (const job of jobs) {
    const target = path.join(root, 'poses', job.id + '.png');
    if (fs.existsSync(target) && fs.existsSync(target + '.json') &&
        JSON.parse(fs.readFileSync(target + '.json')).render_version === 2) continue;
    try {
      const result = await page.evaluate(windowJob => window.renderPose(windowJob), {
        json: JSON.parse(fs.readFileSync(path.join(root,job.skeleton))),
        atlasText: fs.readFileSync(path.join(root,job.atlas),'utf8'),
        png: 'data:image/png;base64,' + fs.readFileSync(path.join(root,job.texture)).toString('base64'), phase:job.phase, action:job.action});
      fs.writeFileSync(target + '.tmp',Buffer.from(result.png.split(',')[1],'base64')); fs.renameSync(target + '.tmp',target);
      delete result.png;
      fs.writeFileSync(target + '.json', JSON.stringify({...job,...result,render_version:2})+'\n');
      console.log(JSON.stringify({id:job.id,status:'ok',family:job.family,action:job.action}));
    } catch(error) {
      fs.appendFileSync(path.join(root,'render_errors.jsonl'),JSON.stringify({id:job.id,error:String(error)})+'\n');
      console.log(JSON.stringify({id:job.id,status:'error',error:String(error)}));
    }
    if (limit && ++count >= limit) break;
  }
} finally { await browser.close(); }
