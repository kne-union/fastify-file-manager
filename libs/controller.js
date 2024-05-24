const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
  fastify.post(`${options.prefix}/updload`, {}, async request => {
    const { file, filename, encoding, mimetype } = await request.file();
    //1. 保存到服务器目录 2.对接oss
  });

  fastify.get(`${options.prefix}/file-url`, {}, async () => {});
});
