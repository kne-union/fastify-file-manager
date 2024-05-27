const fp = require('fastify-plugin');
const fs = require('fs-extra');
const crypto = require('crypto');
const path = require('path');

module.exports = fp(async (fastify, options) => {
  const uploadToFileSystem = async ({ file, namespace }) => {
    const { filename, encoding, mimetype } = file;
    const buffer = await file.toBuffer();
    const hash = crypto.createHash('md5');
    hash.update(buffer);
    const digest = hash.digest('hex');
    const extension = path.extname(filename);
    const filepath = path.resolve(options.root, `${digest}${extension}`);
    await fs.writeFile(filepath, buffer);
    return await fastify.models.fileManager.create({
      filename,
      namespace,
      encoding,
      mimetype,
      hash: digest,
      size: buffer.byteLength
    });
  };

  const getFileUrl = async ({ id, namespace }) => {
    const file = await fastify.models.fileManager.findByPk(id, {
      where: { namespace }
    });
    if (!file) {
      throw new Error('文件不存在');
    }
    const extension = path.extname(file.filename);
    return `${options.prefix}/file/${file.hash}${extension}?filename=${file.filename}`;
  };

  const getFileInfo = async ({ id, namespace }) => {
    const file = await fastify.models.fileManager.findByPk(id, {
      where: { namespace }
    });
    if (!file) {
      throw new Error('文件不存在');
    }
    const extension = path.extname(file.filename);
    return Object.assign({}, file, {
      targetFileName: `${file.hash}${extension}`
    });
  };

  const getFileList = async ({ filter, namespace, currentPage, perPage }) => {
    const queryFilter = { namespace };
    const { count, rows } = await fastify.models.fileManager.findAndCountAll({
      where: queryFilter,
      offset: currentPage * (currentPage - 1),
      limit: perPage
    });
    return {
      pageData: rows,
      totalCount: count
    };
  };

  const deleteFile = async ({ id, namespace }) => {
    const file = await fastify.models.fileManager.findByPk(id, {
      where: { namespace }
    });
    if (!file) {
      throw new Error('文件不存在');
    }

    await file.destroy();
  };

  fastify.decorate('fileManagerServices', { uploadToFileSystem, getFileUrl, getFileInfo, getFileList, deleteFile });
});
