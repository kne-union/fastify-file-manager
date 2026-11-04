const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('fs-extra');
const { execFileSync } = require('node:child_process');
const sharp = require('sharp');
const ffmpegPath = require('ffmpeg-static');
const createTestApp = require('./helper');

const prefix = '/api/v3/static';

const createPng = (width, height, color = { r: 255, g: 0, b: 0 }) =>
  sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();

const createPdf = (width = 595, height = 842) => {
  const content = `0 0 1 rg 10 10 ${width - 20} ${height - 20} re f`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];
  let output = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = output.length;
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, 'latin1');
};

const createVideo = async duration => {
  const target = path.resolve(os.tmpdir(), `thumbnail_test_${duration}_${Date.now()}.mp4`);
  execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=duration=${duration}:size=320x240:rate=10`, '-pix_fmt', 'yuv420p', '-y', target]);
  const buffer = await fs.readFile(target);
  await fs.remove(target);
  return buffer;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

describe('thumbnail', () => {
  let testApp, app, services, thumbnailRoot;

  const setup = async (options = {}) => {
    // 同一用例内换配置时先关掉上一个实例，避免残留连接与临时目录
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
    testApp = await createTestApp(options);
    app = testApp.app;
    services = testApp.services;
    thumbnailRoot = testApp.thumbnailRoot;
  };

  const upload = (filename, buffer, mimetype) => services.fileRecord.uploadToFileSystem({ file: { filename, mimetype, encoding: 'binary', buffer } });

  const request = id => app.inject({ method: 'GET', url: `${prefix}/thumbnail/${id}` });

  const batch = (ids, payload) =>
    app.inject({
      method: 'POST',
      url: `${prefix}/thumbnails`,
      payload: payload === undefined ? { ids } : payload
    });

  const spyGenerator = (kind, { delay = 0 } = {}) => {
    const original = services.thumbnail.generators[kind];
    const stats = { calls: 0, active: 0, maxActive: 0 };
    services.thumbnail.generators[kind] = async args => {
      stats.calls++;
      stats.active++;
      stats.maxActive = Math.max(stats.maxActive, stats.active);
      try {
        await sleep(delay);
        return await original(args);
      } finally {
        stats.active--;
      }
    };
    return stats;
  };

  const listCache = async () => (await fs.readdir(thumbnailRoot)).sort();

  afterEach(async () => {
    if (testApp) {
      await testApp.close();
      testApp = null;
    }
  });

  describe('生成', () => {
    beforeEach(() => setup());

    it('图片生成 50x50 webp', async () => {
      const file = await upload('a.png', await createPng(200, 100), 'image/png');
      const res = await request(file.id);
      assert.equal(res.statusCode, 200);
      assert.equal(res.headers['content-type'], 'image/webp');
      assert.equal(res.headers['cache-control'], 'private, max-age=86400');
      const meta = await sharp(res.rawPayload).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, 50);
      assert.equal(meta.height, 50);
    });

    it('第二次请求命中缓存，不重复生成', async () => {
      const stats = spyGenerator('image');
      const file = await upload('a.png', await createPng(200, 100), 'image/png');
      assert.equal((await request(file.id)).statusCode, 200);
      assert.equal((await request(file.id)).statusCode, 200);
      assert.equal(stats.calls, 1);
      assert.ok((await listCache()).some(name => name.endsWith('_50x50.webp')));
    });

    it('不支持的类型返回 404；octet-stream 按后缀识别', async () => {
      const txt = await upload('a.txt', Buffer.from('hello'), 'text/plain');
      assert.equal((await request(txt.id)).statusCode, 404);
      const png = await upload('b.png', await createPng(80, 80), 'application/octet-stream');
      assert.equal((await request(png.id)).statusCode, 200);
    });

    it('PDF 生成首页缩略图', async () => {
      const file = await upload('a.pdf', createPdf(), 'application/pdf');
      const res = await request(file.id);
      assert.equal(res.statusCode, 200);
      const meta = await sharp(res.rawPayload).metadata();
      assert.equal(meta.width, 50);
      assert.equal(meta.height, 50);
    });

    it('视频生成首帧缩略图，不足 1 秒的视频退回第 0 秒', async () => {
      const long = await upload('a.mp4', await createVideo(2), 'video/mp4');
      const short = await upload('b.mp4', await createVideo(0.5), 'video/mp4');
      for (const file of [long, short]) {
        const res = await request(file.id);
        assert.equal(res.statusCode, 200);
        const meta = await sharp(res.rawPayload).metadata();
        assert.equal(meta.width, 50);
        assert.equal(meta.height, 50);
      }
    });

    it('损坏文件返回 404 并写失败标记，之后不再生成', async () => {
      const stats = spyGenerator('image');
      const file = await upload('broken.png', Buffer.from('not a png'), 'image/png');
      assert.equal((await request(file.id)).statusCode, 404);
      assert.ok((await listCache()).some(name => name.endsWith('.fail')));
      assert.equal((await request(file.id)).statusCode, 404);
      assert.equal(stats.calls, 1);
    });

    it('生成结束后不残留 .tmp 文件', async () => {
      const file = await upload('a.png', await createPng(100, 100), 'image/png');
      await request(file.id);
      assert.deepEqual(
        (await listCache()).filter(name => name.endsWith('.tmp')),
        []
      );
    });
  });

  describe('并发', () => {
    it('同一文件并发 10 个请求只生成一次', async () => {
      await setup();
      const stats = spyGenerator('image', { delay: 50 });
      const file = await upload('a.png', await createPng(100, 100), 'image/png');
      const results = await Promise.all(Array.from({ length: 10 }, () => request(file.id)));
      assert.ok(results.every(res => res.statusCode === 200));
      assert.equal(stats.calls, 1);
    });

    it('全局并发上限生效', async () => {
      await setup({ thumbnailConcurrency: 1 });
      const stats = spyGenerator('image', { delay: 20 });
      const files = [];
      for (let i = 0; i < 10; i++) {
        files.push(await upload(`${i}.png`, await createPng(60, 60, { r: i * 20, g: 0, b: 0 }), 'image/png'));
      }
      const results = await Promise.all(files.map(file => request(file.id)));
      assert.ok(results.every(res => res.statusCode === 200));
      assert.equal(stats.calls, 10);
      assert.equal(stats.maxActive, 1);
    });

    it('排队超过上限返回 503', async () => {
      await setup({ thumbnailConcurrency: 1, thumbnailMaxQueue: 2 });
      spyGenerator('image', { delay: 100 });
      const files = [];
      for (let i = 0; i < 6; i++) {
        files.push(await upload(`${i}.png`, await createPng(60, 60, { r: 0, g: i * 30, b: 0 }), 'image/png'));
      }
      const results = await Promise.all(files.map(file => request(file.id)));
      const busy = results.filter(res => res.statusCode === 503);
      assert.ok(busy.length > 0);
      assert.equal(busy[0].headers['retry-after'], '1');
      assert.ok(results.some(res => res.statusCode === 200));
    });

    it('超时返回 404，写失败标记', async () => {
      await setup({ thumbnailTimeout: 50 });
      spyGenerator('image', { delay: 200 });
      const file = await upload('a.png', await createPng(60, 60), 'image/png');
      assert.equal((await request(file.id)).statusCode, 404);
      assert.ok((await listCache()).some(name => name.endsWith('.fail')));
    });
  });

  describe('内存保护', () => {
    it('像素数超过上限的图片返回 404 并写失败标记', async () => {
      await setup({ thumbnailMaxPixels: 1000 * 1000 });
      const file = await upload('big.png', await createPng(2000, 2000), 'image/png');
      assert.equal((await request(file.id)).statusCode, 404);
      assert.ok((await listCache()).some(name => name.endsWith('.fail')));
    });

    it('超过文件大小上限的图片和 PDF 不进入生成', async () => {
      await setup({ thumbnailImageMaxFileSize: 10, thumbnailPdfMaxFileSize: 10 });
      const imageStats = spyGenerator('image');
      const pdfStats = spyGenerator('pdf');
      const png = await upload('a.png', await createPng(60, 60), 'image/png');
      const pdf = await upload('a.pdf', createPdf(), 'application/pdf');
      assert.equal((await request(png.id)).statusCode, 404);
      assert.equal((await request(pdf.id)).statusCode, 404);
      assert.equal(imageStats.calls, 0);
      assert.equal(pdfStats.calls, 0);
    });

    it('超大页面 PDF 按页面尺寸缩放渲染，画布长边不超过 200px', async () => {
      await setup();
      const { pdfjs, assets } = await services.thumbnail.loaders.pdfjs();
      const canvasSizes = [];
      const wrapped = Object.assign({}, pdfjs, {
        getDocument: params => {
          const task = pdfjs.getDocument(params);
          return {
            promise: task.promise.then(doc => {
              const factory = doc.canvasFactory;
              const create = factory.create.bind(factory);
              factory.create = (width, height) => {
                canvasSizes.push([width, height]);
                return create(width, height);
              };
              return doc;
            }),
            destroy: () => task.destroy()
          };
        }
      });
      services.thumbnail.loaders.pdfjs = async () => ({ pdfjs: wrapped, assets });
      const file = await upload('big.pdf', createPdf(14400, 14400), 'application/pdf');
      const res = await request(file.id);
      assert.equal(res.statusCode, 200);
      const meta = await sharp(res.rawPayload).metadata();
      assert.equal(meta.width, 50);
      assert.ok(canvasSizes.length > 0);
      assert.ok(canvasSizes.every(([width, height]) => Math.max(width, height) <= 200));
    });
  });

  describe('批量接口', () => {
    beforeEach(() => setup());

    it('混合 ok、none 和不存在的 id，全部返回 200', async () => {
      const png = await upload('a.png', await createPng(200, 100), 'image/png');
      const txt = await upload('a.txt', Buffer.from('hello'), 'text/plain');
      const res = await batch([png.id, txt.id, 'not-exist-id']);
      assert.equal(res.statusCode, 200);
      const data = res.json();
      assert.equal(data[png.id].status, 'ok');
      assert.match(data[png.id].data, /^data:image\/webp;base64,/);
      const buffer = Buffer.from(data[png.id].data.split(',')[1], 'base64');
      const meta = await sharp(buffer).metadata();
      assert.equal(meta.format, 'webp');
      assert.equal(meta.width, 50);
      assert.equal(meta.height, 50);
      assert.deepEqual(data[txt.id], { status: 'none' });
      assert.deepEqual(data['not-exist-id'], { status: 'none' });
    });

    it('重复 id 只生成一次', async () => {
      const stats = spyGenerator('image');
      const file = await upload('a.png', await createPng(100, 100), 'image/png');
      const res = await batch([file.id, file.id, file.id]);
      assert.equal(res.statusCode, 200);
      assert.equal(res.json()[file.id].status, 'ok');
      assert.equal(stats.calls, 1);
    });

    it('ids 不合法返回 400', async () => {
      assert.equal((await batch([], { ids: [] })).statusCode, 400);
      assert.equal((await batch([], {})).statusCode, 400);
      assert.equal((await batch([], { ids: Array.from({ length: 11 }, (_, i) => `id-${i}`) })).statusCode, 400);
    });

    it('队列满时该文件返回 pending，整批仍为 200', async () => {
      await setup({ thumbnailConcurrency: 1, thumbnailMaxQueue: 2 });
      spyGenerator('image', { delay: 100 });
      const ids = [];
      for (let i = 0; i < 6; i++) {
        ids.push((await upload(`${i}.png`, await createPng(60, 60, { r: i * 30, g: 0, b: 0 }), 'image/png')).id);
      }
      const res = await batch(ids);
      assert.equal(res.statusCode, 200);
      const data = res.json();
      const statuses = ids.map(id => data[id].status);
      assert.ok(statuses.includes('ok'));
      assert.ok(statuses.includes('pending'));
      assert.ok(statuses.every(status => ['ok', 'pending'].includes(status)));
    });

    it('超过等待上限返回 pending，任务继续生成，下次请求命中缓存', async () => {
      await setup({ thumbnailBatchWait: 50 });
      spyGenerator('image', { delay: 300 });
      const file = await upload('a.png', await createPng(60, 60), 'image/png');
      const first = await batch([file.id]);
      assert.equal(first.statusCode, 200);
      assert.deepEqual(first.json()[file.id], { status: 'pending' });

      await sleep(400);
      const second = await batch([file.id]);
      assert.equal(second.json()[file.id].status, 'ok');
    });
  });

  describe('缓存清理', () => {
    const daysAgo = days => (Date.now() - days * 86400 * 1000) / 1000;

    it('超过上限后删到 80% 以下，先删最久未使用的，并清理残留 .tmp 与过期 .fail', async () => {
      const maxCacheSize = 1000;
      await setup({ thumbnailMaxCacheSize: maxCacheSize });
      const file = await upload('a.png', await createPng(120, 120), 'image/png');
      assert.equal((await request(file.id)).statusCode, 200);
      await services.thumbnail.runCleanup();
      const [hitName] = (await listCache()).filter(name => name.endsWith('.webp'));

      // 10 个 200 字节的缓存文件，fake0 最旧（10 天前）
      for (let i = 0; i < 10; i++) {
        const target = path.join(thumbnailRoot, `fake${i}_50x50.webp`);
        await fs.writeFile(target, Buffer.alloc(200));
        await fs.utimes(target, daysAgo(10 - i), daysAgo(10 - i));
      }
      await fs.utimes(path.join(thumbnailRoot, hitName), daysAgo(20), daysAgo(20));
      for (const name of ['x.webp.abc.tmp', 'x_50x50.fail']) {
        await fs.writeFile(path.join(thumbnailRoot, name), 'x');
        await fs.utimes(path.join(thumbnailRoot, name), daysAgo(2), daysAgo(2));
      }

      // 命中缓存会把修改时间刷新为当前时间
      assert.equal((await request(file.id)).statusCode, 200);
      await sleep(20);
      await services.thumbnail.runCleanup();

      const rest = await listCache();
      const total = (await Promise.all(rest.filter(name => name.endsWith('.webp')).map(name => fs.stat(path.join(thumbnailRoot, name))))).reduce((sum, stat) => sum + stat.size, 0);
      assert.ok(total <= maxCacheSize * 0.8, `total ${total}`);
      assert.ok(rest.includes(hitName), '最近命中的文件应保留');
      assert.ok(!rest.includes('fake0_50x50.webp'), '最久未使用的文件应被删除');
      assert.ok(rest.includes('fake9_50x50.webp'), '较新的文件应保留');
      assert.ok(!rest.includes('x.webp.abc.tmp'));
      assert.ok(!rest.includes('x_50x50.fail'));
    });

    it('thumbnailMaxCacheSize 为 0 时不清理', async () => {
      await setup({ thumbnailMaxCacheSize: 0 });
      for (let i = 0; i < 5; i++) {
        const file = await upload(`${i}.png`, await createPng(60, 60, { r: i * 40, g: 0, b: 0 }), 'image/png');
        assert.equal((await request(file.id)).statusCode, 200);
      }
      await sleep(50);
      assert.equal((await listCache()).filter(name => name.endsWith('.webp')).length, 5);
    });
  });

  describe('缺少依赖', () => {
    beforeEach(() => setup());

    it('缺少 pdfjs 时 PDF 返回 404，图片不受影响', async () => {
      services.thumbnail.loaders.pdfjs = async () => null;
      const pdf = await upload('a.pdf', createPdf(), 'application/pdf');
      const png = await upload('a.png', await createPng(60, 60), 'image/png');
      assert.equal((await request(pdf.id)).statusCode, 404);
      assert.equal((await request(png.id)).statusCode, 200);
    });

    it('缺少 ffmpeg 时视频返回 404', async () => {
      services.thumbnail.loaders.ffmpeg = async () => null;
      const video = await upload('a.mp4', await createVideo(1), 'video/mp4');
      assert.equal((await request(video.id)).statusCode, 404);
    });

    it('缺少 sharp 时所有格式返回 404', async () => {
      services.thumbnail.loaders.sharp = async () => null;
      const png = await upload('a.png', await createPng(60, 60), 'image/png');
      assert.equal((await request(png.id)).statusCode, 404);
    });
  });
});
