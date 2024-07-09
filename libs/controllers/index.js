const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  const { services } = fastify.fileManager;
  fastify.post(
    `${options.prefix}/upload`,
    {
      onRequest: [options.authenticateFileWrite],
      schema: {
        query: {
          type: 'object',
          properties: {
            namespace: { type: 'string' }
          }
        }
      }
    },
    async request => {
      const file = await request.file();
      if (!file) {
        throw new Error('不能获取到上传文件');
      }
      //1. 保存到服务器目录 2.对接oss
      return await services.fileRecord.uploadToFileSystem({
        file,
        namespace: request.query.namespace || options.namespace
      });
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
      return await services.fileRecord.getFileUrl({ id });
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
        id
      });
      return attachment ? reply.download(targetFileName, targetFilename || filename) : reply.sendFile(targetFileName);
    }
  );

  fastify.post(
    `${options.prefix}/file-list`,
    {
      onRequest: [options.authenticateFileMange],
      schema: {
        body: {
          type: 'object',
          properties: {
            perPage: { type: 'number' },
            currentPage: { type: 'number' },
            filter: {
              type: 'object',
              properties: {
                namespace: { type: 'string' },
                size: { type: 'array', items: { type: 'number' } },
                filename: { type: 'string' }
              }
            }
          }
        }
      }
    },
    async request => {
      const { filter, perPage, currentPage } = Object.assign(
        {},
        {
          perPage: 20,
          currentPage: 1
        },
        request.body
      );
      return await services.fileRecord.getFileList({
        filter,
        perPage,
        currentPage
      });
    }
  );

  // Replace file

  fastify.post(
    `${options.prefix}/replace-file`,
    {
      onRequest: [options.authenticateFileMange],
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' }
        }
      }
    },
    async request => {
      const file = await request.file();
      if (!file) {
        throw new Error('不能获取到上传文件');
      }
      return await services.fileRecord.uploadToFileSystem({ id: request.query.id, file });
    }
  );

  fastify.post(
    `${options.prefix}/rename-file`,
    {
      onRequest: [options.authenticateFileMange],
      schema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          filename: { type: 'string' }
        }
      }
    },
    async request => {
      await services.fileRecord.renameFile(request.body);
      return {};
    }
  );

  fastify.post(
    `${options.prefix}/delete-files`,
    {
      onRequest: [options.authenticateFileMange],
      schema: {
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            ids: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    },
    async request => {
      const { ids } = request.body;
      await services.fileRecord.deleteFiles({ ids });
      return {};
    }
  );
});
