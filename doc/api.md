| 参数                          | 类型       | 默认值                                  | 必填 | 描述                                                                  |
|-----------------------------|----------|--------------------------------------|----|---------------------------------------------------------------------|
| **基础配置**                    |          |                                      |    |                                                                     |
| `root`                      | string   | `path.join(process.cwd(), 'static')` | 否  | 文件存储根目录路径                                                           |
| `namespace`                 | string   | `'default'`                          | 否  | 默认文件分类命名空间                                                          |
| `prefix`                    | string   | `/api/v${majorVersion}/static`       | 否  | API路由前缀，自动从package.json提取主版本号                                       |
| `dbTableNamePrefix`         | string   | `'t_file_manager_'`                  | 否  | 数据库表名前缀                                                             |
| **文件上传**                    |          |                                      |    |                                                                     |
| `multipart.limits.fileSize` | number   | `524288000` (500MB)                  | 否  | 单个文件最大上传大小                                                          |
| **静态文件服务**                  |          |                                      |    |                                                                     |
| `static`                    | object   | `{}`                                 | 否  | 透传[@fastify/static](https://github.com/fastify/fastify-static)的所有配置 |
| **适配器配置**                   |          |                                      |    |                                                                     |
| `ossAdapter`                | function | `() => {}`                           | 否  | OSS适配器工厂函数，需返回OSS配置对象                                               |
| `createAuthenticate`        | function | `() => []`                           | 否  | 认证中间件工厂函数                                                           |

### 配置示例

```javascript
const options = {
    root: '/data/uploads',  // 自定义存储目录
    namespace: 'user_files', // 业务隔离命名空间
    multipart: {
        limits: {
            fileSize: 100 * 1024 * 1024 // 调整为100MB
        }
    },
    ossAdapter: () => {
        /** 需要注册 '@kne/fastify-aliyun' 插件
         * fastify.register(require('@kne/fastify-aliyun'), {
         prefix: `${apiPrefix}/aliyun`,
         oss: {
         baseDir: 'leapin-setting',
         region: fastify.config.OSS_REGION,
         accessKeyId: fastify.config.OSS_ACCESS_KEY_ID,
         accessKeySecret: fastify.config.OSS_ACCESS_KEY_SECRET,
         bucket: fastify.config.OSS_BUCKET
         }
         });
         * */
        return fastify.aliyun.services.oss;
    },
    createAuthenticate: (requiredPermission) => [
        fastify.jwtVerify,
        checkPermission(requiredPermission)
    ]
}
```

### 配置说明

1. **版本兼容性**  
   `prefix` 自动从 `package.json` 提取主版本号（如 `1.2.3` → `/api/v1/static`）

2. **存储目录**
    - 默认会在项目根目录创建 `static` 文件夹
    - 生产环境建议设置为绝对路径（如 `/var/www/uploads`）

3. **权限控制**  
   `createAuthenticate` 应返回 Fastify 钩子数组，典型实现：
   ```javascript
   createAuthenticate: (perm) => [
     fastify.authenticate,
     (req, reply, done) => {
       if(!req.user.permissions.includes(perm)) {
         return reply.code(403).send()
       }
       done()
     }
   ]
   ```

### 文件上传接口

#### `POST /api/v1/static/upload`

上传文件到服务器或配置的存储服务

##### 认证要求

- 需要 `file:write` 权限
- 通过 JWT 认证

##### 请求参数

| 参数        | 位置    | 类型     | 必填 | 描述       | 示例             |
|-----------|-------|--------|----|----------|----------------|
| namespace | query | string | 否  | 文件分类命名空间 | `user-avatars` |
| file      | body  | file   | 是  | 要上传的文件   | -              |

##### 请求示例

```bash
curl -X POST \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -F "file=@test.jpg" \
  "http://localhost:3000/api/v1/static/upload?namespace=user-avatars"
```

##### 响应状态码

| 状态码 | 描述        |
|-----|-----------|
| 200 | 文件上传成功    |
| 400 | 无效请求或缺少文件 |
| 401 | 未授权访问     |
| 413 | 文件大小超过限制  |
| 500 | 服务器错误     |

---

### 文件列表查询

#### `POST /api/v1/static/file-list`

查询指定条件下的文件列表（支持分页和筛选）

#### 认证要求

- 需要 `file:mange` 权限
- 通过 JWT 认证

#### 请求参数

##### Body 参数 (application/json)

| 参数                 | 类型       | 必填 | 描述                  | 默认值 | 示例                |
|--------------------|----------|----|---------------------|-----|-------------------|
| `perPage`          | number   | 否  | 每页显示数量              | 20  | `10`              |
| `currentPage`      | number   | 否  | 当前页码                | 1   | `2`               |
| `filter`           | object   | 否  | 筛选条件                | -   | -                 |
| `filter.namespace` | string   | 否  | 文件分类命名空间            | -   | `"user-docs"`     |
| `filter.size`      | number[] | 否  | 文件大小范围[min,max]（字节） | -   | `[1024, 1048576]` |
| `filter.filename`  | string   | 否  | 文件名模糊匹配             | -   | `"report.pdf"`    |

##### 请求示例

```bash
curl -X POST \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "perPage": 10,
    "currentPage": 2,
    "filter": {
      "namespace": "project-files",
      "size": [1024, 1048576],
      "filename": "report"
    }
  }' \
  "http://localhost:3000/api/v1/static/file-list"
```

##### 响应状态码

| 状态码 | 描述      |
|-----|---------|
| 200 | 查询成功    |
| 400 | 参数验证失败  |
| 401 | 未授权访问   |
| 500 | 服务器内部错误 |

##### 筛选逻辑说明

1. **命名空间筛选**：精确匹配传入的 `namespace` 值
2. **文件大小筛选**：
    - 数组第一个元素为最小值
    - 数组第二个元素为最大值
3. **文件名筛选**：使用 `LIKE %value%` 模糊匹配

##### 分页说明

- 分页计算：`offset = (currentPage - 1) * perPage`
- 建议每页数量不超过 100 条
- 页码从 1 开始计数

---

### 文件删除接口

#### `DELETE /api/v1/static/:fileId`

删除指定文件

##### 认证要求

- 需要 `file:write` 权限

##### 请求参数

| 参数     | 位置   | 类型     | 必填 | 描述       | 示例       |
|--------|------|--------|----|----------|----------|
| fileId | path | string | 是  | 要删除的文件ID | `abc123` |

##### 请求示例

```bash
curl -X DELETE \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  "http://localhost:3000/api/v1/static/abc123"
```

##### 响应状态码

| 状态码 | 描述     |
|-----|--------|
| 204 | 文件删除成功 |
| 404 | 文件不存在  |
| 500 | 服务器错误  |

---

### 文件信息接口

#### `GET /api/v1/static/:fileId`

获取文件详细信息

##### 认证要求

- 需要 `file:read` 权限

##### 请求参数

| 参数     | 位置   | 类型     | 必填 | 描述       | 示例       |
|--------|------|--------|----|----------|----------|
| fileId | path | string | 是  | 要查询的文件ID | `abc123` |

##### 请求示例

```bash
curl -X GET \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  "http://localhost:3000/api/v1/static/abc123"
```

##### 响应示例

```json
{
  "id": "abc123",
  "name": "document.pdf",
  "size": 102400,
  "mimeType": "application/pdf",
  "createdAt": "2023-01-01T00:00:00Z",
  "url": "/api/v1/static/file/documents/abc123.pdf"
}
```

---

### 接口使用说明

1. **认证方式**：
    - 所有接口都需要在 Header 中添加 `Authorization: Bearer <JWT_TOKEN>`
    - JWT 需要包含相应的权限声明

2. **命名空间规则**：
    - 命名空间支持字母、数字和下划线组合
    - 未指定时使用默认命名空间

3. **文件大小限制**：
    - 默认最大 500MB
    - 可在服务端配置中调整

4. **错误处理**：
    - 所有错误响应都包含标准格式的 error 字段
    - 客户端应检查状态码而非仅依赖响应体

> 注意：实际 API 路径前缀会根据配置的 `prefix` 参数变化