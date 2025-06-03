const fp = require('fastify-plugin');
const fs = require('fs-extra');
const crypto = require('node:crypto');
const path = require('node:path');
const { NotFound } = require('http-errors');
const os = require('node:os');
const { Readable } = require('stream');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify.fileManager;
  const { Op } = fastify.sequelize.Sequelize;
  const uploadToFileSystem = async ({ id, file, namespace }) => {
    const { filename, encoding, mimetype } = file;
    const hash = crypto.createHash('md5');
    const extension = path.extname(filename);
    const tmpPath = path.resolve(os.tmpdir(), `temp_${filename}_${crypto.randomBytes(6).toString('hex')}`);
    const writeStream = fs.createWriteStream(tmpPath);
    let fileSize = 0;
    if (file.file) {
      file.file.on('data', (chunk) => {
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
    } else {
      throw new Error('文件类型不支持');
    }

    const digest = hash.digest('hex');

    let storageType;
    const ossServices = options.ossAdapter();
    if (typeof ossServices.uploadFile === 'function') {
      // 使用流上传到OSS
      const readStream = fs.createReadStream(tmpPath);
      await ossServices.uploadFileStream({ stream: readStream, filename: `${digest}${extension}` });
      storageType = 'oss';
    } else {
      // 使用流写入本地文件
      const filepath = path.resolve(options.root, `${digest}${extension}`);
      const writeStream = fs.createWriteStream(filepath);
      const readStream = fs.createReadStream(tmpPath);
      await new Promise((resolve, reject) => {
        readStream.pipe(writeStream)
          .on('finish', resolve)
          .on('error', reject);
      });
      storageType = 'local';
    }

    //清楚临时文件
    await fs.remove(tmpPath);

    const outputFile = await (async create => {
      if (!id) {
        return await create();
      }
      const file = await models.fileRecord.findOne({ where: { uuid: id } });
      if (!file) {
        throw new Error('原文件不存在');
      }
      file.filename = filename;
      file.encoding = encoding;
      file.mimetype = mimetype;
      file.hash = digest;
      file.size = fileSize;
      file.storageType = storageType;
      await file.save();
      return file;
    })(() => models.fileRecord.create({
      filename, namespace: namespace || options.namespace, encoding, mimetype, hash: digest, size: fileSize, storageType
    }));
    return Object.assign({}, outputFile.get({ plain: true }), { id: outputFile.uuid });
  };

  const uploadFromUrl = async ({ id, url, namespace }) => {
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
    readChunk();
    const tempFile = {
      filename: path.basename(url).split('?')[0],
      mimetype: response.headers.get('content-type'),
      encoding: 'binary',
      file: nodeStream
    };
    return await uploadToFileSystem({ id, file: tempFile, namespace });
  };

  const getFileUrl = async ({ id, namespace }) => {
    const file = await models.fileRecord.findOne({
      where: { uuid: id }
    });
    if (!file) {
      throw new Error('文件不存在');
    }
    const extension = path.extname(file.filename);
    const ossServices = options.ossAdapter();
    if (file.storageType === 'oss' && typeof ossServices.getFileLink !== 'function') {
      throw new Error('ossAdapter未正确配置无法读取oss类型存储文件');
    }
    if (file.storageType === 'oss') {
      return await ossServices.getFileLink({ filename: `${file.hash}${extension}` });
    }

    if (!(await fs.exists(`${options.root}/${file.hash}${extension}`))) {
      throw new NotFound();
    }
    return `${options.prefix}/file/${file.hash}${extension}?filename=${file.filename}`;
  };

  const getFileInfo = async ({ id }) => {
    const file = await models.fileRecord.findOne({
      where: { uuid: id }
    });
    if (!file) {
      throw new Error('文件不存在');
    }
    const extension = path.extname(file.filename);
    const targetFileName = `${file.hash}${extension}`;
    const ossServices = options.ossAdapter();
    if (file.storageType === 'oss' && typeof ossServices.downloadFile !== 'function') {
      throw new Error('ossAdapter未正确配置无法读取oss类型存储文件');
    }
    let targetFile;
    if (file.storageType === 'oss') {
      targetFile = await ossServices.downloadFile({ filename: targetFileName });
    }
    return Object.assign({}, file.get({ pain: true }), {
      id: file.uuid, filePath: targetFileName, targetFile
    });
  };

  const getFileList = async ({ filter, currentPage, perPage }) => {
    // namespace: namespace || options.namespace
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

    const { count, rows } = await models.fileRecord.findAndCountAll({
      where: queryFilter, offset: perPage * (currentPage - 1), limit: perPage
    });
    return {
      pageData: rows.map(item => Object.assign({}, item.get({ plain: true }), { id: item.uuid })), totalCount: count
    };
  };

  const deleteFiles = async ({ ids }) => {
    await models.fileRecord.destroy({
      where: {
        uuid: {
          [Op.in]: ids
        }
      }
    });
  };

  const renameFile = async ({ id, filename }) => {
    const file = await models.fileRecord.findOne({
      where: { uuid: id }
    });
    if (!file) {
      throw new Error('文件不存在');
    }
    file.filename = filename;
    await file.save();
  };

  Object.assign(services, {
    uploadToFileSystem, uploadFromUrl, getFileUrl, getFileInfo, getFileList, deleteFiles, renameFile, // 兼容之前api，后面可能会删掉
    fileRecord: { uploadToFileSystem, uploadFromUrl, getFileUrl, getFileInfo, getFileList, deleteFiles, renameFile }
  });
});
