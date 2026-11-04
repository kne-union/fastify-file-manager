const fp = require('fastify-plugin');
const fs = require('fs-extra');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const createError = require('http-errors');
const MimeTypes = require('mime-types');

const SIZE = 50;
// PDF 页面与视频帧先渲染到长边约 200px，再由 sharp 裁成 SIZE，避免超大页面/高清视频产生巨大画布
const RENDER_SIZE = 200;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RESCAN_INTERVAL = 10 * 60 * 1000;
const CLEANUP_TARGET_RATIO = 0.8;
const FFMPEG_MAX_OUTPUT = 5 * 1024 * 1024;
const STDERR_TAIL = 4096;
const STAT_CONCURRENCY = 32;

const randomSuffix = () => crypto.randomBytes(6).toString('hex');

const createLimiter = max => {
  let active = 0;
  const queue = [];
  return {
    acquire: () =>
      new Promise(resolve => {
        if (active < max) {
          active++;
          resolve();
        } else {
          queue.push(resolve);
        }
      }),
    release: () => {
      const next = queue.shift();
      if (next) {
        next();
      } else {
        active--;
      }
    }
  };
};

const memoize = fn => {
  let cached;
  return () => {
    if (!cached) {
      cached = Promise.resolve()
        .then(fn)
        .catch(() => null);
    }
    return cached;
  };
};

module.exports = fp(async (fastify, fastifyOptions) => {
  const { services } = fastify.fileManager;
  const thumbnailRoot = fastifyOptions.thumbnailRoot;
  const maxCacheSize = fastifyOptions.thumbnailMaxCacheSize;

  // 可选依赖：宿主未安装时对应格式直接忽略
  const loaders = {
    sharp: memoize(() => {
      const sharp = require('sharp');
      sharp.cache(false);
      sharp.concurrency(1);
      return sharp;
    }),
    ffmpeg: memoize(() => require('ffmpeg-static') || null),
    pdfjs: memoize(async () => {
      require.resolve('@napi-rs/canvas');
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
      return {
        pdfjs,
        assets: {
          standardFontDataUrl: path.join(pdfjsRoot, 'standard_fonts') + path.sep,
          cMapUrl: path.join(pdfjsRoot, 'cmaps') + path.sep,
          cMapPacked: true,
          wasmUrl: path.join(pdfjsRoot, 'wasm') + path.sep
        }
      };
    })
  };

  const globalLimiter = createLimiter(fastifyOptions.thumbnailConcurrency);
  const heavyLimiter = createLimiter(fastifyOptions.thumbnailHeavyConcurrency);
  const inflight = new Map();
  let waiting = 0;

  let usedSize = null;
  let lastScanAt = 0;
  let cleaning = null;

  const getMimetype = file => {
    if (file.mimetype && file.mimetype !== 'application/octet-stream') {
      return file.mimetype;
    }
    return MimeTypes.lookup(file.filename) || '';
  };

  const resolveKind = async file => {
    if (!(await loaders.sharp())) {
      return null;
    }
    const mimetype = getMimetype(file);
    const size = file.size || 0;
    if (mimetype.startsWith('image/')) {
      return size > fastifyOptions.thumbnailImageMaxFileSize ? null : 'image';
    }
    if (mimetype === 'application/pdf') {
      if (size > fastifyOptions.thumbnailPdfMaxFileSize || !(await loaders.pdfjs())) {
        return null;
      }
      return 'pdf';
    }
    if (mimetype.startsWith('video/')) {
      return (await loaders.ffmpeg()) ? 'video' : null;
    }
    return null;
  };

  const getStorageFilename = file => `${file.hash}${path.extname(file.filename)}`;

  // 本地存储直接用文件路径；OSS 先落临时文件（sharp 读流会把整个文件攒进内存）
  const withSourceFile = async (file, fn) => {
    if (file.storageType !== 'oss') {
      return fn(path.resolve(fastifyOptions.root, getStorageFilename(file)));
    }
    const tmpPath = path.resolve(os.tmpdir(), `thumbnail_src_${randomSuffix()}${path.extname(file.filename)}`);
    try {
      await pipeline(await services.fileRecord.getFileReadStream(file), fs.createWriteStream(tmpPath));
      return await fn(tmpPath);
    } finally {
      fs.remove(tmpPath).catch(() => {});
    }
  };

  // PDF / 视频在 OSS 上优先用签名 URL 让 pdfjs、ffmpeg 按需读取片段，避免整文件下载
  const withSourceUrl = async (file, fn) => {
    if (file.storageType === 'oss') {
      const ossServices = fastifyOptions.ossAdapter();
      if (typeof ossServices.getFileLink === 'function') {
        return fn(await ossServices.getFileLink({ filename: getStorageFilename(file) }));
      }
    }
    return withSourceFile(file, fn);
  };

  const writeThumbnail = async (input, output, { flatten } = {}) => {
    const sharp = await loaders.sharp();
    let pipe = sharp(input, { limitInputPixels: fastifyOptions.thumbnailMaxPixels, sequentialRead: true }).rotate();
    if (flatten) {
      pipe = pipe.flatten({ background: '#ffffff' });
    }
    await pipe.resize(SIZE, SIZE, { fit: 'cover' }).webp({ quality: 80 }).toFile(output);
  };

  const runFfmpeg = (ffmpegPath, input, seek, signal) =>
    new Promise((resolve, reject) => {
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-threads',
        '1',
        '-ss',
        String(seek),
        '-i',
        input,
        '-frames:v',
        '1',
        '-vf',
        `scale=${RENDER_SIZE}:${RENDER_SIZE}:force_original_aspect_ratio=increase`,
        '-f',
        'image2pipe',
        '-vcodec',
        'png',
        'pipe:1'
      ];
      const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks = [];
      let size = 0;
      let stderr = '';
      const onAbort = () => child.kill('SIGKILL');
      signal.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', chunk => {
        size += chunk.length;
        if (size > FFMPEG_MAX_OUTPUT) {
          child.kill('SIGKILL');
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL);
      });
      child.on('error', error => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
      child.on('close', code => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) {
          return reject(new Error('ffmpeg 已超时终止'));
        }
        if (size > FFMPEG_MAX_OUTPUT) {
          return reject(new Error('ffmpeg 输出超出上限'));
        }
        if (code !== 0) {
          return reject(new Error(`ffmpeg 退出码 ${code}: ${stderr}`));
        }
        resolve(Buffer.concat(chunks));
      });
    });

  const generators = {
    image: ({ file, output }) => withSourceFile(file, input => writeThumbnail(input, output)),
    pdf: async ({ file, output, signal }) => {
      const { pdfjs, assets } = await loaders.pdfjs();
      await withSourceUrl(file, async url => {
        const loadingTask = pdfjs.getDocument(Object.assign({ url, disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }, assets));
        const onAbort = () => loadingTask.destroy();
        signal.addEventListener('abort', onAbort, { once: true });
        try {
          const doc = await loadingTask.promise;
          const page = await doc.getPage(1);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: RENDER_SIZE / Math.max(base.width, base.height) });
          const { canvas, context } = doc.canvasFactory.create(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
          await page.render({ canvas, canvasContext: context, viewport }).promise;
          const png = canvas.toBuffer('image/png');
          page.cleanup();
          await writeThumbnail(png, output, { flatten: true });
        } finally {
          signal.removeEventListener('abort', onAbort);
          await loadingTask.destroy();
        }
      });
    },
    video: async ({ file, output, signal }) => {
      const ffmpegPath = await loaders.ffmpeg();
      await withSourceUrl(file, async input => {
        let frame = await runFfmpeg(ffmpegPath, input, 1, signal);
        // 视频不足 1 秒时第 1 秒取不到帧，退回第 0 秒
        if (frame.length === 0) {
          frame = await runFfmpeg(ffmpegPath, input, 0, signal);
        }
        if (frame.length === 0) {
          throw new Error('视频未能截取到画面');
        }
        await writeThumbnail(frame, output);
      });
    }
  };

  const scanDir = async () => {
    const entries = [];
    const pending = new Set();
    const dir = await fs.promises.opendir(thumbnailRoot);
    for await (const dirent of dir) {
      if (!dirent.isFile()) {
        continue;
      }
      const task = fs
        .stat(path.join(thumbnailRoot, dirent.name))
        .then(stat => {
          entries.push({ name: dirent.name, size: stat.size, mtimeMs: stat.mtimeMs });
        })
        .catch(() => {})
        .finally(() => pending.delete(task));
      pending.add(task);
      if (pending.size >= STAT_CONCURRENCY) {
        await Promise.race(pending);
      }
    }
    await Promise.all(pending);
    return entries;
  };

  const removeCacheFile = name => fs.remove(path.join(thumbnailRoot, name)).catch(() => {});

  const cleanup = async () => {
    const entries = await scanDir();
    const now = Date.now();
    const thumbnails = [];
    let total = 0;
    for (const entry of entries) {
      if (entry.name.endsWith('.tmp')) {
        if (now - entry.mtimeMs > HOUR) await removeCacheFile(entry.name);
      } else if (entry.name.endsWith('.fail')) {
        if (now - entry.mtimeMs > DAY) await removeCacheFile(entry.name);
      } else if (entry.name.endsWith('.webp')) {
        thumbnails.push(entry);
        total += entry.size;
      }
    }
    if (total > maxCacheSize) {
      // 按修改时间从旧到新删到上限的 80%，命中缓存时会刷新修改时间，所以淘汰的是最久未使用的
      thumbnails.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const target = maxCacheSize * CLEANUP_TARGET_RATIO;
      for (const entry of thumbnails) {
        if (total <= target) break;
        await removeCacheFile(entry.name);
        total -= entry.size;
      }
    }
    usedSize = total;
    lastScanAt = Date.now();
  };

  const runCleanup = () => {
    if (!cleaning) {
      cleaning = cleanup()
        .catch(error => fastify.log.warn(error, '缩略图缓存清理失败'))
        .finally(() => {
          cleaning = null;
        });
    }
    return cleaning;
  };

  const checkCacheLimit = () => {
    if (!maxCacheSize) {
      return;
    }
    if (usedSize === null || Date.now() - lastScanAt > RESCAN_INTERVAL || usedSize > maxCacheSize) {
      runCleanup();
    }
  };

  const isFailed = async failPath => {
    try {
      const stat = await fs.stat(failPath);
      if (Date.now() - stat.mtimeMs <= DAY) {
        return true;
      }
      await fs.remove(failPath).catch(() => {});
    } catch (e) {}
    return false;
  };

  const readCache = async cachePath => {
    try {
      const [buffer, stat] = await Promise.all([fs.readFile(cachePath), fs.stat(cachePath)]);
      const now = Date.now();
      if (now - stat.mtimeMs > DAY) {
        const time = new Date(now);
        fs.utimes(cachePath, time, time).catch(() => {});
      }
      return buffer;
    } catch (e) {
      return null;
    }
  };

  const generate = async ({ file, kind, cachePath, failPath }) => {
    checkCacheLimit();
    if (waiting >= fastifyOptions.thumbnailMaxQueue) {
      throw createError(503, '缩略图生成繁忙，请稍后重试', { headers: { 'Retry-After': '1' } });
    }
    waiting++;
    const acquired = [];
    try {
      if (kind !== 'image') {
        await heavyLimiter.acquire();
        acquired.push(heavyLimiter);
      }
      await globalLimiter.acquire();
      acquired.push(globalLimiter);
    } finally {
      waiting--;
    }

    const output = `${cachePath}.${randomSuffix()}.tmp`;
    const controller = new AbortController();
    const work = Promise.resolve().then(() => generators[kind]({ file, output, signal: controller.signal }));
    // 名额在任务真正结束后才释放：sharp/pdf 无法中途取消，提前释放会让实际并发超过上限
    work
      .catch(() => {})
      .finally(() => {
        acquired.forEach(limiter => limiter.release());
        if (controller.signal.aborted) {
          fs.remove(output).catch(() => {});
        }
      });

    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`缩略图生成超时（${fastifyOptions.thumbnailTimeout}ms）`));
      }, fastifyOptions.thumbnailTimeout);
    });

    try {
      await Promise.race([work, timeout]);
      await fs.rename(output, cachePath);
      const { size } = await fs.stat(cachePath);
      if (usedSize !== null) {
        usedSize += size;
      }
      return await fs.readFile(cachePath);
    } catch (error) {
      fastify.log.warn(error, `缩略图生成失败: ${file.uuid}`);
      fs.remove(output).catch(() => {});
      await fs.writeFile(failPath, String(Date.now())).catch(() => {});
      throw new createError.NotFound('无法生成缩略图');
    } finally {
      clearTimeout(timer);
    }
  };

  const getThumbnail = async ({ id }) => {
    const file = await services.fileRecord.getFileInstance({ id });
    const kind = await resolveKind(file);
    if (!kind) {
      throw new createError.NotFound('该文件不支持缩略图');
    }
    const key = `${file.hash}_${SIZE}x${SIZE}`;
    const cachePath = path.join(thumbnailRoot, `${key}.webp`);
    const failPath = path.join(thumbnailRoot, `${key}.fail`);

    const cached = await readCache(cachePath);
    if (cached) {
      return cached;
    }
    if (await isFailed(failPath)) {
      throw new createError.NotFound('无法生成缩略图');
    }
    if (!inflight.has(key)) {
      inflight.set(
        key,
        generate({ file, kind, cachePath, failPath }).finally(() => inflight.delete(key))
      );
    }
    return inflight.get(key);
  };

  Object.assign(services, {
    thumbnail: {
      getThumbnail,
      runCleanup,
      loaders,
      generators
    }
  });
});
