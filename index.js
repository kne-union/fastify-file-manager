const fp = require('fastify-plugin');
const autoload = require('@fastify/autoload');
const path = require('path');

module.exports = fp(
  async (fastify, options) => {
    fastify.register(require('@fastify/multipart'));
    fastify.register(autoload, {
      dir: path.resolve(__dirname, './libs'),
      options
    });
    fastify.register(require('@fastify/static'), {
      root: path.join(process.cwd(), 'static'),
      prefix: '/static/'
    });
  },
  {
    name: 'fastify-file-manager',
    dependencies: ['fastify-sequelize']
  }
);
