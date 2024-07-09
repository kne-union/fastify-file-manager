const fastify = require('fastify')({
  logger: true, querystringParser: str => require('qs').parse(str)
});

const fastifyEnv = require('@fastify/env');

const path = require('path');

const sqliteStorage = path.resolve('./database.sqlite');

fastify.register(fastifyEnv, {
  dotenv: true, schema: {
    type: 'object', required: [], properties: {
      ACCESS_KEY_ID: { type: 'string' }, ACCESS_KEY_SECRET: { type: 'string' }
    }
  }
});

fastify.register(require('@kne/fastify-sequelize'), {
  db: {
    storage: sqliteStorage
  }, modelsGlobOptions: {
    syncOptions: {}
  }
});

fastify.register(require('fastify-plugin')(async (fastify) => {
  fastify.register(require('../index'), {
    ossAdapter: () => {
      return fastify.aliyun.services.oss;
    }
  });
  fastify.register(require('@kne/fastify-aliyun'), {
    oss: {
      baseDir: 'test-project',
      region: 'oss-cn-shanghai',
      accessKeyId: fastify.config.ACCESS_KEY_ID,
      accessKeySecret: fastify.config.ACCESS_KEY_SECRET,
      bucket: 'fat-test-node'
    }
  });
}));

fastify.register(require('fastify-plugin')(async (fastify) => {
  await fastify.sequelize.sync();
}));

fastify.addHook('onSend', async (request, reply, payload) => {
  if (reply.getHeader('content-type').indexOf('application/json') > -1) {
    const responseData = JSON.parse(payload);
    if (responseData.statusCode && (responseData.message || responseData.error)) {
      return JSON.stringify({
        code: responseData.statusCode, msg: responseData.message || responseData.error
      });
    }
    return JSON.stringify({
      code: 0, data: JSON.parse(payload)
    });
  }
  return payload;
});

fastify.listen({ port: 3045 }, (err, address) => {
  if (err) throw err;
  // Server is now listening on ${address}
});
