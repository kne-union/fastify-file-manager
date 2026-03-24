const fastify = require('fastify');
const path = require('node:path');
const fs = require('fs-extra');
const os = require('node:os');

let counter = 0;

module.exports = async function createTestApp() {
  const tmpDir = path.resolve(os.tmpdir(), `test_file_manager_${Date.now()}_${++counter}_${Math.random().toString(36).slice(2)}`);
  await fs.ensureDir(tmpDir);

  const app = fastify({ logger: false });

  app.register(require('@kne/fastify-sequelize'), {
    db: { storage: ':memory:' },
    modelsGlobOptions: { syncOptions: {} }
  });

  app.register(
    require('fastify-plugin')(async (fastify) => {
      await fastify.register(require('../index'), {
        root: tmpDir,
        namespace: 'test',
        prefix: '/api/v3/static',
        ossAdapter: () => ({}),
        createAuthenticate: () => async () => {}
      });
    })
  );

  app.register(
    require('fastify-plugin')(async (fastify) => {
      await fastify.sequelize.sync();
    })
  );

  await app.ready();

  return {
    app,
    services: app.fileManager.services,
    models: app.fileManager.models,
    tmpDir,
    async close() {
      await app.close();
      await fs.remove(tmpDir).catch(() => {});
    }
  };
};
