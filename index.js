const fp = require('fastify-plugin');
const path = require('node:path');
const os = require('node:os');
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
        },
        // 文件夹能力；插件内部自行注册 @kne/fastify-group，无需宿主再挂一份
        enableFolder: true,
        groupName: 'file-manager-folder',
        // 上传自动挂载文件系统时的默认业务域
        defaultFolderType: 'admin-file-system',
        getAuthenticate: () => {
          return [];
        },
        thumbnailConcurrency: Math.max(1, Math.min(4, os.cpus().length - 1)),
        thumbnailHeavyConcurrency: 1,
        thumbnailMaxQueue: 100,
        thumbnailTimeout: 15 * 1000,
        // 批量接口的整体等待上限：没赶上的 id 返回 pending，生成任务继续在后台跑
        thumbnailBatchWait: 8 * 1000,
        thumbnailMaxCacheSize: 200 * 1024 * 1024,
        thumbnailMaxPixels: 40 * 1000 * 1000,
        thumbnailImageMaxFileSize: 50 * 1024 * 1024,
        thumbnailPdfMaxFileSize: 50 * 1024 * 1024
      },
      options
    );
    // 缩略图缓存默认与 root 同级：root 整个挂在静态文件服务下，放进去会绕过鉴权
    if (!options.thumbnailRoot) {
      options.thumbnailRoot = `${path.resolve(options.root)}-thumbnails`;
    }
    await fs.ensureDir(options.root);
    await fs.ensureDir(options.thumbnailRoot);

    if (options.enableFolder !== false) {
      const denyGroupHttp = () => [
        async () => {
          const err = new Error('Forbidden');
          err.statusCode = 403;
          throw err;
        }
      ];
      await fastify.register(require('@kne/fastify-group'), {
        name: options.groupName,
        // 表名 = prefix + snakeCase(name + Model)，默认 t_ + file_manager_folder_tag
        dbTableNamePrefix: options.groupDbTableNamePrefix || 't_',
        // 仅使用 group 的 models/services；HTTP API 一律 403，业务走 folder/*
        prefix: options.groupPrefix || `${options.prefix}/folder-group`,
        getAuthenticate: denyGroupHttp
      });
    }

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
