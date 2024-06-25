const fp = require('fastify-plugin');
const path = require('path');
const fs = require('fs-extra');

module.exports = fp(
  async (fastify, options) => {
    options = Object.assign(
      {
        root: path.join(process.cwd(), 'static'),
        namespace: 'default',
        prefix: '/api/static',
        multipart: {},
        static: {},
        authenticateFileRead: async () => {},
        authenticateFileMange: async () => {},
        authenticateFileUpload: async () => {}
      },
      options
    );
    await fs.ensureDir(options.root);
    fastify.register(require('@fastify/multipart'), options.multipart);
    fastify.register(require('@kne/fastify-namespace'), {
      name: 'fileManager',
      options,
      modules: [
        [
          'models',
          await fastify.sequelize.addModels(path.resolve(__dirname, './libs/models'), {
            prefix: 't_file_manager_'
          })
        ],
        ['services', path.resolve(__dirname, './libs/services')],
        ['controllers', path.resolve(__dirname, './libs/controllers')]
      ]
    });
    fastify.register(
      require('@fastify/static'),
      Object.assign({}, options.static, {
        root: options.root,
        prefix: options.prefix + '/file/',
        index: false,
        list: false
      })
    );
  },
  {
    name: 'fastify-file-manager',
    dependencies: ['fastify-sequelize']
  }
);
