const fp = require('fastify-plugin');
const path = require('node:path');
const fs = require('fs-extra');
const packageJson = require('./package.json');

module.exports = fp(
  async (fastify, options) => {
    options = Object.assign(
      {
        root: path.join(process.cwd(), 'static'),
        namespace: 'default',
        prefix: `/api/v${packageJson.version.split('.')[0]}/static`,
        dbTableNamePrefix: 't_file_manager_',
        multipart: {
          limits: {
            fileSize: 500 * 1024 * 1024
          }
        },
        static: {},
        ossAdapter: () => {
          return {};
        },
        createAuthenticate: () => {
          return [];
        }
      },
      options
    );
    await fs.ensureDir(options.root);
    fastify.register(require('@fastify/multipart'), options.multipart);
    fastify.register(require('@kne/fastify-namespace'), {
      name: 'fileManager',
      options,
      singleton: true,
      modules: [
        [
          'models',
          await fastify.sequelize.addModels(path.resolve(__dirname, './libs/models'), {
            prefix: options.dbTableNamePrefix
          })
        ],
        ['services', path.resolve(__dirname, './libs/services')],
        ['controllers', path.resolve(__dirname, './libs/controllers')]
      ]
    });
    fastify.register(require('@fastify/static'),
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
