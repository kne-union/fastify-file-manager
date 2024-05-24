const fp = require('fastify-plugin');
const autoload = require('@fastify/autoload');
const path = require('path');
const fs = require('fs-extra');

module.exports = fp(
  async (fastify, options) => {
    options = Object.assign(
      {
        root: path.join(process.cwd(), 'static'),
        prefix: '/static'
      },
      options
    );
    await fs.ensureDir(options.root);
    await fastify.sequelize.addModels(path.resolve(__dirname, './models'));

    fastify.register(require('@fastify/multipart'));
    fastify.register(autoload, {
      dir: path.resolve(__dirname, './libs'),
      options
    });
    fastify.register(require('@fastify/static'), {
      root: options.root,
      prefix: options.prefix + '/file/'
    });
  },
  {
    name: 'fastify-file-manager',
    dependencies: ['fastify-sequelize']
  }
);
