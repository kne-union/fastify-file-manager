const fp = require('fastify-plugin');
const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');
const { NotFound } = require('http-errors');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify.fileManager;
  const { Op } = fastify.sequelize.Sequelize;
  const uploadToFileSystem = async ({ id, file, namespace }) => {
    const { filename, encoding, mimetype } = file;
    const hash = crypto.createHash('md5');
    const extension = path.extname(filename);
    let buffer = Buffer.alloc(0);

    // 使用流处理文件数据
    const stream = file.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk);
      buffer = Buffer.concat([buffer, chunk]);
    }
    const digest = hash.digest('hex');

    let storageType;
    const ossServices = options.ossAdapter();
    if (typeof ossServices.uploadFile === 'function') {
      // 使用流上传到OSS
      const uploadStream = file.createReadStream();
      await ossServices.uploadFileStream({ stream: uploadStream, filename: `${digest}${extension}` });
      storageType = 'oss';
    } else {
      // 使用流写入本地文件
      const filepath = path.resolve(options.root, `${digest}${extension}`);
      const writeStream = fs.createWriteStream(filepath);
      const readStream = file.createReadStream();
      await new Promise((resolve, reject) => {
        readStream.pipe(writeStream)
          .on('finish', resolve)
          .on('error', reject);
      });
      storageType = 'local';
    }

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
      file.size = buffer.byteLength;
      file.storageType = storageType;
      await file.save();
      return file;
    })(() =>
      models.fileRecord.create({
        filename,
        namespace: namespace || options.namespace,
        encoding,
        mimetype,
        hash: digest,
        size: buffer.byteLength,
        storageType
      })
    );
    return Object.assign({}, outputFile.get({ plain: true }), { id: outputFile.uuid });
  };

  const uploadFromUrl = async ({ id, url, namespace }) => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('下载文件失败');
    }
    const chunks = [];
    for await (const chunk of response.body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const tempFile = {
      filename: path.basename(url).split('?')[0],
      mimetype: response.headers.get('content-type'),
      encoding: 'binary',
      createReadStream: () => {
        const readable = new require('stream').Readable();
        readable.push(buffer);
        readable.push(null);
        return readable;
      }
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
      id: file.uuid,
      filePath: targetFileName,
      targetFile
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
      where: queryFilter,
      offset: perPage * (currentPage - 1),
      limit: perPage
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
    uploadToFileSystem, uploadFromUrl, getFileUrl, getFileInfo, getFileList, deleteFiles, renameFile,
    // 兼容之前api，后面可能会删掉
    fileRecord: { uploadToFileSystem, uploadFromUrl, getFileUrl, getFileInfo, getFileList, deleteFiles, renameFile }
  });
});
