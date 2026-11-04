# fastify-file-manager

### 描述

用于管理静态文件上传查看等

### 安装

```shell
npm i --save @kne/fastify-file-manager
```

### 概述

#### 项目概述

Fastify File Manager 是一个基于 Fastify 框架构建的高性能文件管理服务，提供文件上传、存储、检索和管理功能。该项目采用模块化设计，支持多种存储后端，包括本地文件系统和云存储服务（如阿里云OSS、AWS S3等）。

##### 核心特性

- 🚀 **高性能文件处理**：基于 Fastify 的轻量级架构
- 🔒 **安全认证**：集成 JWT 认证和权限控制
- 📁 **多存储支持**：可配置本地存储或云存储
- 🏷️ **文件分类**：通过命名空间(namespace)组织文件
- 📂 **文件夹系统**：插件内部注册 `@kne/fastify-group`（命名空间 `file-manager-folder`），提供树形目录（`type` 域隔离，`options.kind` 区分文件/文件夹）
- 📊 **元数据管理**：记录文件大小、类型、上传时间等信息
- 🔍 **文件检索**：支持按命名空间查询文件列表
- 🖼️ **文件缩略图**：图片、PDF 首页、视频首帧生成 50x50 webp，本地缓存并限制并发、内存与缓存容量（依赖可选安装）



### 示例

### API

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
| `createAuthenticate`        | function | `() => []`                           | 否  | 扁平文件接口认证中间件工厂（`file:read` / `file:write` / `file:mange`）              |
| `enableFolder`              | boolean  | `true`                               | 否  | 是否启用文件夹能力（插件内部自动注册 `@kne/fastify-group`）                           |
| `groupName`                 | string   | `'file-manager-folder'`              | 否  | 内部 fastify-group 命名空间名（挂在 `fastify[groupName]`）                      |
| `groupPrefix`               | string   | `` `${prefix}/folder-group` ``       | 否  | 内部 group HTTP 前缀（`getAuthenticate` 固定 403，禁止直接访问）                 |
| `groupDbTableNamePrefix`    | string   | `'t_'`                               | 否  | 内部 group 表名前缀（最终表如 `t_file_manager_folder_tag`）                      |
| `defaultFolderType`         | string   | `'admin-file-system'`                | 否  | 文件夹相关默认业务域 type（上传自动挂载、`folder/tree`、`folder/add-files` 未传 type 时使用） |
| `getAuthenticate`           | function | `() => []`                           | 否  | 文件夹接口认证工厂，入参 `read` \| `write` \| `delete`，应在 hook 内按 `request.type` 鉴权 |
| **缩略图**                     |          |                                      |    |                                                                     |
| `thumbnailRoot`             | string   | `` `${root}-thumbnails` ``           | 否  | 缩略图本地缓存目录；不要放在 `root` 内（`root` 由静态文件服务公开，会绕过鉴权）               |
| `thumbnailConcurrency`      | number   | `max(1, min(4, CPU 核数 - 1))`         | 否  | 同时生成缩略图的任务数上限                                                       |
| `thumbnailHeavyConcurrency` | number   | `1`                                  | 否  | PDF / 视频任务同时运行上限（同时计入 `thumbnailConcurrency`）                      |
| `thumbnailMaxQueue`         | number   | `100`                                | 否  | 等待生成的任务数上限，超过返回 503 + `Retry-After: 1`                              |
| `thumbnailTimeout`          | number   | `15000`                              | 否  | 单个任务超时（毫秒），超时返回 404 并写失败标记                                         |
| `thumbnailBatchWait`        | number   | `8000`                               | 否  | 批量接口的整体等待上限（毫秒），没赶上的 id 返回 `pending`，生成任务继续在后台跑                      |
| `thumbnailMaxCacheSize`     | number   | `209715200` (200MB)                  | 否  | 缓存容量上限，超过后按最久未使用删到 80%；`0` 表示不限制                                  |
| `thumbnailMaxPixels`        | number   | `40000000`                           | 否  | 图片像素数上限（解码内存约为像素数 × 4 字节），超过不生成                                   |
| `thumbnailImageMaxFileSize` | number   | `52428800` (50MB)                    | 否  | 图片文件大小上限，超过不生成                                                      |
| `thumbnailPdfMaxFileSize`   | number   | `52428800` (50MB)                    | 否  | PDF 文件大小上限，超过不生成（视频只截一帧，不限制大小）                                    |

#### 配置示例

```javascript
const getAuthenticate = action => [
  async request => {
    const type = request.query?.type ?? request.body?.type;
    if (!type) {
      throw new Error('必须传入类型');
    }
    await assertTypePermission(request, { type, action });
  }
];

// 无需再单独注册 group，file-manager 会内部挂载 name=file-manager-folder 的 group
fastify.register(require('@kne/fastify-file-manager'), {
  root: '/data/uploads',
  namespace: 'user_files',
  prefix: `${apiPrefix}/static`,
  getAuthenticate,
  createAuthenticate: requiredPermission => [
    fastify.jwtVerify,
    checkPermission(requiredPermission)
  ]
});
```

#### 配置说明

1. **版本兼容性**  
   `prefix` 自动从 `package.json` 提取主版本号（如 `1.2.3` → `/api/v1/static`）

2. **存储目录**
    - 默认会在项目根目录创建 `static` 文件夹
    - 生产环境建议设置为绝对路径（如 `/var/www/uploads`）

3. **权限控制**  
   - 扁平文件接口使用 `createAuthenticate`
   - 文件夹接口使用 `getAuthenticate(action)`，请在 hook 内读取 `request.query.type` / `request.body.type` 做域鉴权

4. **文件夹节点约定**（存于内部 `file-manager-folder` group）
    - 业务域：`type`（与请求参数一致）
    - 文件夹：`options.kind = 'folder'`
    - 文件：`options.kind = 'file'`，`options.fileId` 为 file-manager 文件 uuid
#### 文件夹接口

##### `GET {prefix}/folder/tree`

查询指定 `type` 的文件树。

- 鉴权：`getAuthenticate('read')`
- Query：`type`（可选，默认 `defaultFolderType`）、`language`

##### `POST {prefix}/folder/mkdir`

新建文件夹节点。

- 鉴权：`getAuthenticate('write')`
- Body：`type`、`name`（必填）、`parentId?`、`language?`

##### `POST {prefix}/folder/upload`

上传文件并创建文件节点（multipart）。

- 鉴权：`getAuthenticate('write')`
- Query：`type`（必填）、`path?`（目标文件夹路径，空字符串或不传为根目录）、`namespace?`、`language?`

##### `POST {prefix}/folder/remove`

递归删除节点及其子孙；文件节点同步删除 file-record。

- 鉴权：`getAuthenticate('delete')`
- Body：`type`、`id`（必填）、`language?`

##### `POST {prefix}/folder/move`

将一个或多个文件/文件夹节点移动到目标文件夹。

- 鉴权：`getAuthenticate('write')`
- Body：`type`、`ids`（必填，数组）、`parentId?`（空为根目录）、`language?`

##### `POST {prefix}/folder/copy`

将一个或多个文件/文件夹节点复制到目标文件夹；文件以 `linked` 节点挂载，文件夹递归复制。

- 鉴权：`getAuthenticate('write')`
- Body：`type`、`ids`（必填，数组）、`parentId?`（空为根目录）、`language?`

##### `POST {prefix}/folder/add-files`

将文件库已有文件以 `linked` 节点挂到文件夹（删除树节点不删文件实体）。

- 鉴权：`getAuthenticate('write')`
- Body：`ids`（必填）、`type?`（默认 `defaultFolderType`）、`parentId?`、`language?`

扁平上传 `POST {prefix}/upload` / `uploadUrl`：保存成功后默认挂到 `admin-file-system` 根目录（可用 `defaultFolderType` / 请求 `type` 覆盖）；传 `path` 则按路径 `ensurePath` 后挂载（`linked: true`）。

#### 文件上传接口

##### `POST /api/v1/static/upload`

上传文件到服务器或配置的存储服务

###### 认证要求

- 需要 `file:write` 权限
- 通过 JWT 认证

###### 请求参数

| 参数        | 位置    | 类型     | 必填 | 描述       | 示例             |
|-----------|-------|--------|----|----------|----------------|
| namespace | query / form | string | 否  | 文件分类命名空间 | `user-avatars` |
| path      | query / form | string | 否  | 文件系统文件夹路径（如 `a/b/c`）；**未传则挂到根目录**；路径不存在则逐级创建 | `docs/inbox` |
| type      | query / form | string | 否  | 文件系统业务域，默认 `admin-file-system` | `admin-file-system` |
| language  | query / form | string | 否  | 语言 | `zh-CN` |
| file      | body  | file   | 是  | 要上传的文件   | -              |

上传成功后会自动以 `linked` 节点挂到文件系统，响应额外返回 `folder`。

###### 请求示例

```bash
curl -X POST \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -F "file=@test.jpg" \
  "http://localhost:3000/api/v1/static/upload?namespace=user-avatars"
```

指定子路径：

```bash
curl -X POST \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -F "file=@report.pdf" \
  "http://localhost:3000/api/v1/static/upload?path=docs/inbox&type=admin-file-system"
```

###### 响应状态码

| 状态码 | 描述        |
|-----|-----------|
| 200 | 文件上传成功    |
| 400 | 无效请求或缺少文件 |
| 401 | 未授权访问     |
| 413 | 文件大小超过限制  |
| 500 | 服务器错误     |

---

#### 文件缩略图接口

##### `GET {prefix}/thumbnail/:id`

返回 50x50 的 webp 缩略图（二进制，`Content-Type: image/webp`，`Cache-Control: private, max-age=86400`）。支持图片、PDF 首页、视频首帧，首次生成后按文件内容 hash 缓存到 `thumbnailRoot`。

- 鉴权：`createAuthenticate('file:read')`
- Params：`id`（文件 uuid，兼容主键）

##### `POST {prefix}/thumbnails`

一次获取最多 10 个文件的缩略图（JSON）。前端列表页推荐用这个接口：一屏只发少量请求，不支持缩略图的文件在结果里标记为 `none`，不会再在浏览器控制台留下大量 404。

- 鉴权：`createAuthenticate('file:read')`
- Body：`{ ids: string[] }`，`minItems: 1`、`maxItems: 10`

###### 响应结构

返回以文件 id 为 key 的对象（由宿主统一包装成 `{ code, data }`），每个 id 的 `status` 取值：

| status    | 含义                                                     | data           |
|-----------|--------------------------------------------------------|----------------|
| `ok`      | 生成成功                                                   | `data:image/webp;base64,...` |
| `none`    | 类型不支持、文件不存在、依赖未安装、超过大小/像素上限、生成失败或超时                    | 无              |
| `pending` | 生成队列已满，或超过 `thumbnailBatchWait` 仍未完成；任务仍在后台继续生成，稍后重试可直接命中缓存 | 无              |

```json
{
  "code": 0,
  "data": {
    "8f3c...": { "status": "ok", "data": "data:image/webp;base64,UklGR..." },
    "1a2b...": { "status": "none" },
    "5c6d...": { "status": "pending" }
  }
}
```

###### 响应状态码

| 状态码 | 描述                                                    |
|-----|-------------------------------------------------------|
| 200 | 已返回结果，单个文件的失败只体现在对应的 `status` 上                       |
| 400 | `ids` 缺失、为空或超过 10 个                                    |
| 401 | 未授权访问                                                 |

###### 与其他接口的关系

- 内部复用单文件缩略图的生成与缓存逻辑：同一文件（相同 hash）在一批内只生成一次，缓存、并发上限、失败标记全部共用
- 单个 `GET {prefix}/thumbnail/:id` 接口保留，供不需要批量能力的场景使用（如 `<img src>` + 自定义鉴权）

###### 依赖安装

生成依赖由宿主项目按需安装，没装的格式直接返回 404：

```bash
npm i sharp ffmpeg-static pdfjs-dist @napi-rs/canvas
```

| 缺少的依赖                               | 影响             |
|-------------------------------------|----------------|
| `sharp`                             | 所有格式都不生成缩略图    |
| `pdfjs-dist` 或 `@napi-rs/canvas`     | 只跳过 PDF        |
| `ffmpeg-static`                     | 只跳过视频          |

`pdfjs-dist` 6.x 要求 Node `>=22.13`，`sharp` 0.35 要求 Node `>=20.9`；Node 版本较低时请安装与之兼容的旧版本。

###### 响应状态码

| 状态码 | 描述                                           |
|-----|----------------------------------------------|
| 200 | 缩略图                                          |
| 404 | 类型不支持、依赖未安装、超过大小/像素上限、生成失败或超时（失败结果缓存 1 天）      |
| 503 | 生成队列已满，按 `Retry-After` 稍后重试                    |

###### 生成与缓存策略

- 同一文件（相同 hash）并发请求只生成一次
- 生成任务受 `thumbnailConcurrency` 限制，PDF / 视频额外受 `thumbnailHeavyConcurrency` 限制
- 缓存先写临时文件再 rename，多进程共享目录时不会读到写了一半的文件
- 每次准备生成前检查缓存容量，超过 `thumbnailMaxCacheSize` 时后台清理：按最久未使用删到上限的 80%，并清掉残留临时文件与过期失败标记
- OSS 文件：图片先落临时文件；PDF / 视频优先用 `ossAdapter.getFileLink` 的签名 URL 按需读取片段

###### 内存建议

- 默认配置下 Node 进程峰值额外占用约 600MB（3 个图片任务各约 160MB + 1 个 PDF 任务）；内存紧张时调小 `thumbnailConcurrency` 或 `thumbnailMaxPixels`
- Linux glibc 环境下 sharp 长期运行可能因内存碎片导致常驻内存只涨不降，生产环境建议使用 jemalloc（如 `LD_PRELOAD`）或 Alpine（musl）镜像

###### 前端用法

接口需要鉴权，若鉴权依赖请求头（token），`<img src>` 无法携带。改用批量接口：返回的 `ok` 结果本身就是 data URL，直接赋给 `src` 即可，不需要 objectURL 也就不需要 `revoke`。`@kne-components/components-file-manager` 的 `createThumbnailLoader` 就是这个策略——同一轮渲染内的 id 合并成一批，满 10 个或下一 tick 发送，最多 2 批在途：

```javascript
const fetchThumbnails = async (ids, headers) => {
  const res = await fetch(`${prefix}/thumbnails`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: ids.slice(0, 10) })
  });
  // 旧版服务端（3.1.x）没有这个路由，返回 404；此时前端应整体停用缩略图，回退为类型图标
  if (!res.ok) return null;
  const { code, data } = await res.json();
  if (code !== 0) return null;
  // data[id].status：ok 直接用 data；none 回退类型图标且不再请求；pending 稍后重试
  return data;
};
```

---

#### 文件列表查询

##### `POST /api/v1/static/file-list`

查询指定条件下的文件列表（支持分页和筛选）

##### 认证要求

- 需要 `file:mange` 权限
- 通过 JWT 认证

##### 请求参数

###### Body 参数 (application/json)

| 参数                 | 类型       | 必填 | 描述                  | 默认值 | 示例                |
|--------------------|----------|----|---------------------|-----|-------------------|
| `perPage`          | number   | 否  | 每页显示数量              | 20  | `10`              |
| `currentPage`      | number   | 否  | 当前页码                | 1   | `2`               |
| `filter`           | object   | 否  | 筛选条件                | -   | -                 |
| `filter.namespace` | string   | 否  | 文件分类命名空间            | -   | `"user-docs"`     |
| `filter.size`      | number[] | 否  | 文件大小范围[min,max]（字节） | -   | `[1024, 1048576]` |
| `filter.filename`  | string   | 否  | 文件名模糊匹配             | -   | `"report.pdf"`    |

###### 请求示例

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

###### 响应状态码

| 状态码 | 描述      |
|-----|---------|
| 200 | 查询成功    |
| 400 | 参数验证失败  |
| 401 | 未授权访问   |
| 500 | 服务器内部错误 |

###### 筛选逻辑说明

1. **命名空间筛选**：精确匹配传入的 `namespace` 值
2. **文件大小筛选**：
    - 数组第一个元素为最小值
    - 数组第二个元素为最大值
3. **文件名筛选**：使用 `LIKE %value%` 模糊匹配

###### 分页说明

- 分页计算：`offset = (currentPage - 1) * perPage`
- 建议每页数量不超过 100 条
- 页码从 1 开始计数

---

#### 文件删除接口

##### `DELETE /api/v1/static/:fileId`

删除指定文件

###### 认证要求

- 需要 `file:write` 权限

###### 请求参数

| 参数     | 位置   | 类型     | 必填 | 描述       | 示例       |
|--------|------|--------|----|----------|----------|
| fileId | path | string | 是  | 要删除的文件ID | `abc123` |

###### 请求示例

```bash
curl -X DELETE \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  "http://localhost:3000/api/v1/static/abc123"
```

###### 响应状态码

| 状态码 | 描述     |
|-----|--------|
| 204 | 文件删除成功 |
| 404 | 文件不存在  |
| 500 | 服务器错误  |

---

#### 文件信息接口

##### `GET /api/v1/static/:fileId`

获取文件详细信息

###### 认证要求

- 需要 `file:read` 权限

###### 请求参数

| 参数     | 位置   | 类型     | 必填 | 描述       | 示例       |
|--------|------|--------|----|----------|----------|
| fileId | path | string | 是  | 要查询的文件ID | `abc123` |

###### 请求示例

```bash
curl -X GET \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  "http://localhost:3000/api/v1/static/abc123"
```

###### 响应示例

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

#### 接口使用说明

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