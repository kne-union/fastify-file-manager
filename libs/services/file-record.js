const fp = require('fastify-plugin');
const fs = require('fs-extra');
const crypto = require('node:crypto');
const path = require('node:path');
const { NotFound } = require('http-errors');
const os = require('node:os');
const { Readable } = require('node:stream');
const compressing = require('compressing');
const { glob } = require('glob');
const MimeTypes = require('mime-types');

module.exports = fp(async (fastify, fastifyOptions) => {
  const { models, services } = fastify.fileManager;
  const { Op } = fastify.sequelize.Sequelize;

  const detail = async ({ id, uuid, namespace }) => {
    const file = await models.fileRecord.findOne({
      where: { uuid: String(id || uuid).split('?')[0] }
    });

    if (!file) {
      throw new Error('文件不存在');
    }

    return file;
  };
  const uploadToFileSystem = async ({ id, file, namespace, options }) => {
    const { filename, encoding, mimetype } = file;
    const hash = crypto.createHash('md5');
    const extension = path.extname(filename);
    const tmpPath = path.resolve(os.tmpdir(), `temp_${filename}_${crypto.randomBytes(6).toString('hex')}`);
    const writeStream = fs.createWriteStream(tmpPath);
    let fileSize = 0;
    if (file.file) {
      file.file.on('data', chunk => {
        hash.update(chunk); // 更新哈希
        writeStream.write(chunk); // 写入文件
        fileSize += chunk.length; // 更新文件大小
      });

      await new Promise((resolve, reject) => {
        file.file.on('end', () => {
          writeStream.end(); // 关闭写入流
          resolve();
        });
        file.file.on('error', reject);
      });
    } else if (file.toBuffer) {
      const buffer = await file.toBuffer();
      hash.update(buffer);
      writeStream.write(buffer);
      fileSize = buffer.byteLength;
      writeStream.end();
    } else {
      throw new Error('文件类型不支持');
    }

    await new Promise((resolve, reject) => {
      writeStream.on('finish', () => {
        resolve();
      });
      writeStream.on('error', reject);
    });

    const digest = hash.digest('hex');

    let storageType;
    const ossServices = fastifyOptions.ossAdapter();
    if (typeof ossServices.uploadFile === 'function') {
      // 使用流上传到OSS
      const readStream = fs.createReadStream(tmpPath);
      await ossServices.uploadFileStream({ stream: readStream, filename: `${digest}${extension}` });
      storageType = 'oss';
    } else {
      // 使用流写入本地文件
      const filepath = path.resolve(fastifyOptions.root, `${digest}${extension}`);
      const writeStream = fs.createWriteStream(filepath);
      const readStream = fs.createReadStream(tmpPath);
      await new Promise((resolve, reject) => {
        readStream.pipe(writeStream).on('finish', resolve).on('error', reject);
      });
      storageType = 'local';
    }

    //清除临时文件
    fs.remove(tmpPath).catch(console.error);

    const outputFile = await (async create => {
      if (!id) {
        return await create();
      }
      const file = await detail({ id });
      file.filename = filename;
      file.encoding = encoding;
      file.mimetype = mimetype;
      file.hash = digest;
      file.size = fileSize;
      file.storageType = storageType;
      file.options = options;
      await file.save();
      return file;
    })(() =>
      models.fileRecord.create({
        filename,
        namespace: namespace || fastifyOptions.namespace,
        encoding,
        mimetype,
        hash: digest,
        size: fileSize,
        storageType,
        options
      })
    );
    return Object.assign({}, outputFile.get({ plain: true }), { id: outputFile.uuid });
  };

  const uploadFromUrl = async ({ id, url, filename: originFilename, namespace, options }) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('下载文件失败');
    }

    const nodeStream = new Readable({
      read() {
        // 空实现，数据通过push方法手动添加
      }
    });

    const reader = response.body.getReader();
    const readChunk = async () => {
      try {
        const { done, value } = await reader.read();
        if (done) {
          nodeStream.push(null);
          return;
        }
        nodeStream.push(value);
        readChunk();
      } catch (err) {
        nodeStream.emit('error', err);
      }
    };
    readChunk().catch(err => {
      throw err;
    });

    let filename = path.basename(url).split('?')[0];

    const contentDisposition = response.headers.get('content-disposition');

    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
      if (filenameMatch && filenameMatch[1]) {
        filename = filenameMatch[1];
      }
    }

    if (originFilename) {
      filename = originFilename;
    }

    const searchParams = new URLSearchParams(url.split('?')[1]);
    if (searchParams.get('filename')) {
      filename = searchParams.get('filename');
    }

    const tempFile = {
      filename,
      mimetype: response.headers.get('content-type'),
      encoding: 'binary',
      file: nodeStream
    };
    return await uploadToFileSystem({ id, file: tempFile, namespace, options });
  };

  const getFileUrl = async ({ id, namespace }) => {
    const file = await detail({ id, namespace });
    const extension = path.extname(file.filename);
    const ossServices = fastifyOptions.ossAdapter();
    if (file.storageType === 'oss' && typeof ossServices.getFileLink !== 'function') {
      throw new Error('ossAdapter未正确配置无法读取oss类型存储文件');
    }
    if (file.storageType === 'oss') {
      return await ossServices.getFileLink({ filename: `${file.hash}${extension}` });
    }

    if (!(await fs.exists(`${fastifyOptions.root}/${file.hash}${extension}`))) {
      throw new NotFound();
    }
    return `${fastifyOptions.prefix}/file/${file.hash}${extension}?filename=${file.filename}`;
  };

  const getFileInfo = async ({ id, namespace }) => {
    const file = await detail({ id, namespace });
    const extension = path.extname(file.filename);
    const targetFileName = `${file.hash}${extension}`;
    const ossServices = fastifyOptions.ossAdapter();
    if (file.storageType === 'oss' && typeof ossServices.downloadFile !== 'function') {
      throw new Error('ossAdapter未正确配置无法读取oss类型存储文件');
    }
    let targetFile;
    if (file.storageType === 'oss') {
      targetFile = await ossServices.downloadFile({ filename: targetFileName });
    }
    return Object.assign({}, file.get({ pain: true }), {
      id: file.uuid,
      filePath: targetFileName,
      targetFile
    });
  };

  const getFileList = async ({ filter = {}, namespace, currentPage, perPage }) => {
    const queryFilter = {};

    if (filter?.filename) {
      queryFilter.filename = {
        [Op.like]: `%${filter.filename}%`
      };
    }
    if (filter?.size && filter.size.length > 0) {
      queryFilter.size = {};
      if (filter.size[0]) {
        queryFilter.size[Op.gt] = filter.size[0] * 1024;
      }
      if (filter.size[1]) {
        queryFilter.size[Op.lt] = filter.size[1] * 1024;
      }
    }
    if (filter?.namespace) {
      queryFilter.namespace = {
        [Op.like]: `%${filter.namespace}%`
      };
    }
    if (namespace) {
      queryFilter.namespace = namespace;
    }

    if (filter?.id) {
      queryFilter.uuid = filter.id;
    }

    ['createdAt', 'updatedAt'].forEach(name => {
      if (filter?.[name]) {
        if (filter[name].startTime && filter[name].endTime) {
          queryFilter[name] = {
            [Op.between]: [filter[name].startTime, filter[name].endTime]
          };
        }
        if (filter[name].startTime && !filter[name].endTime) {
          queryFilter[name] = {
            [Op.gte]: filter[name].startTime
          };
        }
        if (!filter[name].startTime && filter[name].endTime) {
          queryFilter[name] = {
            [Op.lte]: filter[name].endTime
          };
        }
      }
    });

    const { count, rows } = await models.fileRecord.findAndCountAll({
      where: queryFilter,
      offset: perPage * (currentPage - 1),
      limit: perPage,
      order: [['createdAt', 'desc']]
    });
    return {
      pageData: rows.map(item => Object.assign({}, item.get({ plain: true }), { id: item.uuid })),
      totalCount: count
    };
  };

  const deleteFiles = async ({ ids }) => {
    await models.fileRecord.destroy({
      where: {
        uuid: {
          [Op.in]: ids.map(str => str.split('?')[0])
        }
      }
    });
  };

  const renameFile = async ({ id, filename }) => {
    const file = await detail({ id });
    file.filename = filename;
    await file.save();
  };

  const getFileBlob = async ({ id, namespace }) => {
    const file = await detail({ id, namespace });
    if (!file) {
      throw new Error('文件不存在');
    }

    const extension = path.extname(file.filename);
    const targetFileName = `${file.hash}${extension}`;
    const ossServices = fastifyOptions.ossAdapter();

    let buffer;
    if (file.storageType === 'oss') {
      if (typeof ossServices.downloadFile !== 'function') {
        throw new Error('ossAdapter未正确配置无法读取oss类型存储文件');
      }
      buffer = await ossServices.downloadFile({ filename: targetFileName });
    } else {
      const filePath = path.resolve(fastifyOptions.root, targetFileName);
      if (!(await fs.exists(filePath))) {
        throw new NotFound();
      }
      buffer = await fs.readFile(filePath);
    }

    return Object.assign({}, file.get({ plain: true }), {
      id: file.uuid,
      buffer
    });
  };

  const getFileReadStream = file => {
    const extension = path.extname(file.filename);
    const targetFileName = `${file.hash}${extension}`;
    const ossServices = fastifyOptions.ossAdapter();
    if (file.storageType === 'oss') {
      if (typeof ossServices.getFileStream !== 'function') {
        throw new Error('ossAdapter未正确配置无法读取oss类型存储文件');
      }
      return ossServices.getFileStream({ filename: targetFileName });
    } else {
      const filePath = path.resolve(fastifyOptions.root, targetFileName);
      return fs.createReadStream(filePath);
    }
  };

  const getFileStream = async ({ id }) => {
    const file = await detail({ id });
    return getFileReadStream(file);
  };

  const getCompressFileStream = async ({ ids, type = 'zip' }) => {
    const fileList = await models.fileRecord.findAll({
      where: {
        uuid: {
          [Op.in]: ids.map(str => str.split('?')[0])
        }
      }
    });
    const tmpPath = path.resolve(os.tmpdir(), `temp_compress_file_${crypto.randomBytes(6).toString('hex')}`);
    await fs.mkdir(tmpPath);
    const files = [];
    for (const file of fileList) {
      const filepath = path.resolve(tmpPath, file.filename);
      const writeStream = fs.createWriteStream(filepath);
      const fileStream = await getFileReadStream(file);
      fileStream.pipe(writeStream);
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });
      files.push(filepath);
    }
    const compressStream = new compressing[type].Stream();
    files.forEach(filepath => {
      compressStream.addEntry(path.resolve(filepath));
    });
    compressStream.on('error', () => {
      fs.remove(tmpPath).catch(console.error);
    });
    compressStream.on('end', () => {
      fs.remove(tmpPath).catch(console.error);
    });
    return compressStream;
  };

  const getCompressFileBlob = async (...args) => {
    const compressStream = await getCompressFileStream(...args);
    const chunks = [];
    return new Promise((resolve, reject) => {
      compressStream.on('data', chunk => chunks.push(chunk));
      compressStream.on('end', () => resolve(Buffer.concat(chunks)));
      compressStream.on('error', reject);
    });
  };

  //文件解压缩
  const uncompressFile = async ({ id, type = 'zip', namespace, globOptions = '**/*' }) => {
    const file = await detail({ id });
    const fileStream = await getFileReadStream(file);
    const tmpPath = path.resolve(os.tmpdir(), `temp_${id}_${crypto.randomBytes(6).toString('hex')}`);
    await compressing[type].uncompress(fileStream, tmpPath);
    const files = await glob(globOptions, {
      cwd: tmpPath,
      nodir: true
    });
    //将文件上传到文件系统
    const fileList = await Promise.all(
      files.map(async dir => {
        const filepath = path.resolve(tmpPath, dir);
        const filename = path.basename(dir);
        const fileStream = fs.createReadStream(filepath);

        const mimetype = MimeTypes.lookup(filepath) || 'application/octet-stream';
        const file = await uploadToFileSystem({
          file: {
            filename,
            mimetype,
            encoding: 'binary',
            file: fileStream
          },
          filename,
          namespace
        });
        return {
          dir,
          file
        };
      })
    );
    fs.remove(tmpPath).catch(console.error);
    return fileList;
  };

  const getFileInstance = async ({ id, uuid }) => {
    return detail({ id, uuid });
  };

  Object.assign(services, {
    uploadToFileSystem,
    uploadFromUrl,
    getFileUrl,
    getFileInfo,
    getFileList,
    deleteFiles,
    renameFile,
    getFileBlob,
    getFileStream,
    getFileReadStream,
    getCompressFileStream,
    getCompressFileBlob,
    uncompressFile,
    getFileInstance, // 兼容之前api，后面可能会删掉
    fileRecord: {
      uploadToFileSystem,
      uploadFromUrl,
      getFileUrl,
      getFileInfo,
      getFileList,
      deleteFiles,
      renameFile,
      getFileBlob,
      getFileStream,
      getFileReadStream,
      getCompressFileStream,
      getCompressFileBlob,
      uncompressFile,
      getFileInstance
    }
  });
});
