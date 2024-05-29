const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify.fileManager;
  fastify.post(
    `${options.prefix}/upload`,
    {
      onRequest: [options.authenticateFileUpload]
    },
    async request => {
      const file = await request.file();
      if (!file) {
        throw new Error('不能获取到上传文件');
      }
      //1. 保存到服务器目录 2.对接oss
      return await services.fileRecord.uploadToFileSystem({ file, namespace: options.namespace });
    }
  );

  fastify.get(
    `${options.prefix}/file-url/:id`,
    {
      onRequest: [options.authenticateFileRead],
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    async request => {
      const { id } = request.params;
      return await services.fileRecord.getFileUrl({ id, namespace: options.namespace });
    }
  );

  fastify.get(
    `${options.prefix}/file-id/:id`,
    {
      onRequest: [options.authenticateFileRead],
      schema: {
        query: {
          type: 'object',
          properties: {
            attachment: { type: 'boolean' },
            filename: { type: 'string' }
          }
        },
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { attachment, filename: targetFilename } = request.query;
      const { targetFileName, filename } = await services.fileRecord.getFileInfo({
        id,
        namespace: options.namespace
      });
      return attachment ? reply.download(targetFileName, targetFilename || filename) : reply.sendFile(targetFileName);
    }
  );

  fastify.get(
    `${options.prefix}/file-list`,
    {
      onRequest: [options.authenticateFileMange],
      schema: {
        query: {}
      }
    },
    async request => {
      const { filter, perPage, currentPage } = Object.assign({}, request.query, {
        perPage: 20,
        currentPage: 1
      });
      return await services.fileRecord.getFileList({
        filter,
        namespace: options.namespace,
        perPage,
        currentPage
      });
    }
  );

  fastify.post(
    `${options.prefix}/delete-file`,
    {
      onRequest: [options.authenticateFileMange],
      schema: {
        body: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' }
          }
        }
      }
    },
    async request => {
      const { id } = request.body;
      await services.fileRecord.deleteFile({ id, namespace: options.namespace });
      return {};
    }
  );

  fastify.get(`${options.prefix}`, async () => {
    return 'living';
  });
});
