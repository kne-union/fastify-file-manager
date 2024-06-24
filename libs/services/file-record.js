const fp = require('fastify-plugin');
const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');

module.exports = fp(async (fastify, options) => {
  const { models, services } = fastify.fileManager;
  const uploadToFileSystem = async ({ file, namespace }) => {
    const { filename, encoding, mimetype } = file;
    const buffer = await file.toBuffer();
    const hash = crypto.createHash('md5');
    hash.update(buffer);
    const digest = hash.digest('hex');
    const extension = path.extname(filename);
    const filepath = path.resolve(options.root, `${digest}${extension}`);
    await fs.writeFile(filepath, buffer);
    const outputFile = await models.fileRecord.create({
      filename,
      namespace: namespace || options.namespace,
      encoding,
      mimetype,
      hash: digest,
      size: buffer.byteLength
    });
    return Object.assign({}, outputFile.get({ plain: true }), { id: outputFile.uuid });
  };

  const getFileUrl = async ({ id, namespace }) => {
    const file = await models.fileRecord.findOne({
      where: { uuid: id, namespace: namespace || options.namespace }
    });
    if (!file) {
      throw new Error('文件不存在');
    }
    const extension = path.extname(file.filename);
    return `${options.prefix}/file/${file.hash}${extension}?filename=${file.filename}`;
  };

  const getFileInfo = async ({ id, namespace }) => {
    const file = await models.fileRecord.findOne({
      where: { uuid: id, namespace: namespace || options.namespace }
    });
    if (!file) {
      throw new Error('文件不存在');
    }
    const extension = path.extname(file.filename);
    return Object.assign({}, file, {
      id: file.uuid,
      targetFileName: `${file.hash}${extension}`
    });
  };

  const getFileList = async ({ filter, namespace, currentPage, perPage }) => {
    const queryFilter = { namespace: namespace || options.namespace };
    const { count, rows } = await models.fileRecord.findAndCountAll({
      where: queryFilter,
      offset: currentPage * (currentPage - 1),
      limit: perPage
    });
    return {
      pageData: rows.map(item => Object.assign({}, item.get({ plain: true }), { id: item.uuid })),
      totalCount: count
    };
  };

  const deleteFile = async ({ id, namespace }) => {
    const file = await models.fileRecord.findOne({
      where: { uuid: id, namespace: namespace || options.namespace }
    });
    if (!file) {
      throw new Error('文件不存在');
    }

    await file.destroy();
  };
  services.fileRecord = { uploadToFileSystem, getFileUrl, getFileInfo, getFileList, deleteFile };
});
