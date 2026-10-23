const assert = require('node:assert/strict');
const createTestApp = require('./helper');

const prefix = '/api/v3/static';

describe('接口文档', () => {
  it('所有路由都有 tags、summary，参数都有用途说明，并声明 200 响应', async () => {
    const routes = [];
    const testApp = await createTestApp({}, app => {
      app.addHook('onRoute', route => {
        // 静态文件服务与内部 group 的 HTTP 路由（一律 403）不属于本插件接口
        if (route.method === 'HEAD' || route.url.startsWith(`${prefix}/file/`) || route.url.startsWith(`${prefix}/folder-group`)) {
          return;
        }
        routes.push(route);
      });
    });

    const missing = [];
    const checkProps = (where, schema) => {
      if (!schema) return;
      [].concat(schema.oneOf || [], schema.anyOf || [], schema).forEach(item => {
        Object.entries(item.properties || {}).forEach(([key, prop]) => {
          if (!prop.description) missing.push(`${where}.${key}`);
          if (prop.type === 'object') checkProps(`${where}.${key}`, prop);
        });
      });
    };
    routes.forEach(route => {
      const { schema = {} } = route;
      const name = `${route.method} ${route.url}`;
      if (!(schema.tags && schema.tags.length)) missing.push(`${name} tags`);
      if (!schema.summary) missing.push(`${name} summary`);
      if (!(schema.response && schema.response[200] && schema.response[200].description)) missing.push(`${name} response`);
      checkProps(`${name} body`, schema.body);
      checkProps(`${name} query`, schema.querystring || schema.query);
      checkProps(`${name} params`, schema.params);
    });
    await testApp.close();
    assert.equal(routes.length, 18);
    assert.deepEqual(missing, []);
  });
});
