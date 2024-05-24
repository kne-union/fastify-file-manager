const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  fastify.post(`${options.prefix}/upload`, {}, async request => {
    const file = await request.file();
    //1. 保存到服务器目录 2.对接oss
    return await fastify.fileManagerServices.uploadToFileSystem({ file });
  });

  fastify.get(
    `${options.prefix}/file-url/:id`,
    {
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
      return await fastify.fileManagerServices.getFileUrl({ id });
    }
  );

  fastify.get(
    `${options.prefix}/file-id/:id`,
    {
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
      const { targetFileName, filename } = await fastify.fileManagerServices.getFileInfo({ id });
      return attachment ? reply.download(targetFileName, targetFilename || filename) : reply.sendFile(targetFileName);
    }
  );

  fastify.get(`${options.prefix}`, async () => {
    return 'living';
  });
});
