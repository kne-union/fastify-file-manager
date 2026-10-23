const fp = require('fastify-plugin');
const { num, list, success, empty, fileRecordProperties, fileRecord, folderNode, folderTreeNode } = require('../schema/response');

const DEFAULT_FOLDER_TYPE = 'admin-file-system';

const TAG_FILE = '文件管理-文件';
const TAG_LIBRARY = '文件管理-文件库';
const TAG_FOLDER = '文件管理-文件夹';

const uploadedRecord = description =>
  success(description, {
    type: 'object',
    additionalProperties: true,
    properties: Object.assign({}, fileRecordProperties, {
      folder: Object.assign({}, folderNode, { description: '自动挂载到文件系统生成的文件节点；同目录已挂载同一文件时不重复挂载，此时无该字段' })
    })
  });

const TENANT_ID = '租户 ID；接口不校验，按原样传给文件夹服务用于隔离不同租户的树（通常由宿主鉴权钩子注入）';

const readMultipartField = (file, name) => {
  const field = file?.fields?.[name];
  if (!field) {
    return undefined;
  }
  const target = Array.isArray(field) ? field[0] : field;
  return target?.value;
};

const pickUploadFolderParams = (request, file, defaultType) => {
  const path =
    request.query?.path !== undefined
      ? request.query.path
      : request.body?.path !== undefined
        ? request.body.path
        : readMultipartField(file, 'path');
  const type =
    request.query?.type || request.body?.type || readMultipartField(file, 'type') || defaultType || DEFAULT_FOLDER_TYPE;
  const language = request.query?.language || request.body?.language || readMultipartField(file, 'language');
  // 未传 path 时挂到根目录
  return { path: path === undefined ? '' : path, type, language };
};

const attachUploadedRecord = async ({ services, record, path, type, language }) => {
  if (!services.folder) {
    return null;
  }
  if (!type) {
    throw new Error('挂载文件系统时必须传入 type');
  }
  const parentId = await services.folder.ensurePath({ type, path, language });
  return await services.folder.attachRecord({
    type,
    parentId,
    record,
    language,
    linked: true
  });
};

module.exports = fp(async (fastify, options) => {
  const { services } = fastify.fileManager;
  const defaultFolderType = options.defaultFolderType || DEFAULT_FOLDER_TYPE;

  fastify.post(
    `${options.prefix}/upload`,
    {
      onRequest: options.createAuthenticate('file:write'),
      schema: {
        tags: [TAG_FILE],
        summary: '上传文件',
        description:
          '上传单个文件到服务器或配置的存储服务。保存成功后自动挂到文件系统（默认 type=admin-file-system，未传 path 时挂到根目录；传 path 则按路径创建并挂载）。请求为 multipart/form-data，文件字段名为 file；path、type、language 也可作为表单字段传入（query 优先）',
        query: {
          type: 'object',
          properties: {
            namespace: { type: 'string', description: '文件分类命名空间' },
            path: {
              type: 'string',
              description: '文件系统文件夹路径，如 a/b/c；未传则挂到根目录；路径不存在则自动创建'
            },
            type: {
              type: 'string',
              description: '文件系统业务域 type，默认 admin-file-system'
            },
            language: { type: 'string', description: '语言' }
          }
        },
        response: uploadedRecord('上传后的文件记录，挂载到文件系统时带 folder')
      }
    },
    async request => {
      const file = await request.file();
      if (!file) {
        throw new Error('不能获取到上传文件');
      }
      const record = await services.fileRecord.uploadToFileSystem({
        file,
        namespace: request.query.namespace || options.namespace
      });
      const { path, type, language } = pickUploadFolderParams(request, file, defaultFolderType);
      const folder = await attachUploadedRecord({ services, record, path, type, language });
      return folder ? Object.assign({}, record, { folder }) : record;
    }
  );

  fastify.post(
    `${options.prefix}/uploadUrl`,
    {
      onRequest: options.createAuthenticate('file:write'),
      schema: {
        tags: [TAG_FILE],
        summary: '上传URL文件',
        description:
          '服务端下载 url 指向的文件并保存到服务器或配置的存储服务，文件名优先取 url 的 filename 参数，其次响应头 Content-Disposition，再次 url 路径末段。保存成功后自动挂到文件系统（默认 type=admin-file-system，未传 path 时挂到根目录；传 path 则按路径创建并挂载）',
        body: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '文件url，服务端会发起下载，下载失败返回错误' },
            namespace: { type: 'string', description: '文件分类命名空间' },
            path: {
              type: 'string',
              description: '文件系统文件夹路径，如 a/b/c；未传则挂到根目录；路径不存在则自动创建'
            },
            type: {
              type: 'string',
              description: '文件系统业务域 type，默认 admin-file-system'
            },
            language: { type: 'string', description: '语言' }
          }
        },
        response: uploadedRecord('保存后的文件记录，挂载到文件系统时带 folder')
      }
    },
    async request => {
      const record = await services.fileRecord.uploadFromUrl({
        url: request.body.url,
        namespace: request.body.namespace || options.namespace
      });
      const { path, type, language } = pickUploadFolderParams(request, null, defaultFolderType);
      const folder = await attachUploadedRecord({ services, record, path, type, language });
      return folder ? Object.assign({}, record, { folder }) : record;
    }
  );

  fastify.get(
    `${options.prefix}/file-url/:id`,
    {
      onRequest: options.createAuthenticate('file:read'),
      schema: {
        tags: [TAG_FILE],
        summary: '获取文件url',
        description: '获取文件访问地址：本地存储返回 {prefix}/file/{hash}{扩展名}?filename={文件名}（本地文件不存在返回 404），OSS 存储返回 ossAdapter.getFileLink 的结果',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: '文件id（uuid，兼容主键）' }
          }
        },
        response: {
          200: { description: '文件访问地址；本地存储时为 text/plain 字符串' }
        }
      }
    },
    async request => {
      const { id } = request.params;
      return await services.fileRecord.getFileUrl({ id });
    }
  );

  fastify.get(
    `${options.prefix}/file-id/:id`,
    {
      onRequest: options.createAuthenticate('file:read'),
      schema: {
        tags: [TAG_FILE],
        summary: '获取文件信息',
        description: '直接输出文件内容（非 JSON）：OSS 存储下载后按原 MIME 类型返回；本地存储通过静态文件服务返回。attachment 为 true 时以附件形式下载',
        query: {
          type: 'object',
          properties: {
            attachment: { type: 'boolean', description: '是否下载（Content-Disposition: attachment）' },
            filename: { type: 'string', description: '下载文件名，默认原文件名' }
          }
        },
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: '文件id（uuid，兼容主键）' }
          }
        },
        response: {
          200: { description: '文件二进制内容，Content-Type 为文件 MIME 类型' }
        }
      }
    },
    async (request, reply) => {
      const { id } = request.params;
      const { attachment, filename: targetFilename } = request.query;
      const { filePath, targetFile, filename, mimetype, ...props } = await services.fileRecord.getFileInfo({
        id
      });
      if (targetFile) {
        const outputFilename = encodeURIComponent(targetFilename || filename);
        reply.header('Content-Type', mimetype);
        reply.header('Content-Disposition', attachment ? `attachment; filename="${outputFilename}"` : `filename="${outputFilename}"`);
        return reply.send(targetFile);
      }
      return attachment ? reply.download(filePath, targetFilename || filename) : reply.sendFile(filePath);
    }
  );

  fastify.post(
    `${options.prefix}/file-list`,
    {
      onRequest: options.createAuthenticate('file:mange'),
      schema: {
        tags: [TAG_LIBRARY],
        summary: '获取文件列表',
        description: '分页查询文件库，按创建时间倒序',
        body: {
          type: 'object',
          properties: {
            perPage: { type: 'number', description: '每页数量，默认 20' },
            currentPage: { type: 'number', description: '当前页数，默认 1' },
            filter: {
              type: 'object',
              description: '筛选条件',
              properties: {
                id: { description: '按文件 uuid 精确匹配' },
                namespace: { type: 'string', description: '文件分类命名空间，模糊匹配' },
                size: { type: 'array', items: { type: 'number' }, description: '文件大小范围 [最小, 最大]，单位 KB，0 或空表示不限' },
                filename: { type: 'string', description: '文件名，模糊匹配' },
                createdAt: { description: '创建时间范围，形如 { startTime, endTime }，可只传其一' },
                updatedAt: { description: '更新时间范围，形如 { startTime, endTime }，可只传其一' }
              }
            }
          }
        },
        response: success('文件分页列表', {
          type: 'object',
          additionalProperties: true,
          properties: {
            pageData: list('当前页文件列表', fileRecord),
            totalCount: num('符合条件的文件总数')
          }
        })
      }
    },
    async request => {
      const { filter, perPage, currentPage } = Object.assign(
        {},
        {
          perPage: 20,
          currentPage: 1
        },
        request.body
      );
      return await services.fileRecord.getFileList({
        filter,
        perPage,
        currentPage
      });
    }
  );

  // Replace file

  fastify.post(
    `${options.prefix}/replace-file`,
    {
      onRequest: options.createAuthenticate('file:mange'),
      schema: {
        tags: [TAG_LIBRARY],
        summary: '替换文件',
        description: '用上传的新文件（multipart/form-data，字段名 file）覆盖指定文件记录的内容与文件名，文件 id 不变；未传 id 时新建文件记录。不会挂载到文件系统',
        query: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '要替换的文件id（uuid，兼容主键）' }
          }
        },
        response: success('替换后的文件记录', fileRecord)
      }
    },
    async request => {
      const file = await request.file();
      if (!file) {
        throw new Error('不能获取到上传文件');
      }
      return await services.fileRecord.uploadToFileSystem({ id: request.query.id, file });
    }
  );

  fastify.post(
    `${options.prefix}/rename-file`,
    {
      onRequest: options.createAuthenticate('file:mange'),
      schema: {
        tags: [TAG_LIBRARY],
        summary: '重命名文件',
        description: '修改文件记录的文件名；新文件名无扩展名时沿用原扩展名，非法字符替换为下划线',
        body: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '文件id（uuid，兼容主键）' },
            filename: { type: 'string', description: '新文件名' }
          }
        },
        response: empty('重命名成功')
      }
    },
    async request => {
      await services.fileRecord.renameFile(request.body);
      return {};
    }
  );

  fastify.post(
    `${options.prefix}/delete-files`,
    {
      onRequest: options.createAuthenticate('file:mange'),
      schema: {
        tags: [TAG_LIBRARY],
        summary: '删除文件',
        description: '按 uuid 删除文件记录（不删除存储中的文件实体，也不删除文件夹树中引用它的节点）',
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: '文件id（uuid）列表' }
          }
        },
        response: empty('删除成功')
      }
    },
    async request => {
      const { ids } = request.body;
      await services.fileRecord.deleteFiles({ ids });
      return {};
    }
  );

  fastify.post(
    `${options.prefix}/download-files`,
    {
      onRequest: options.createAuthenticate('file:mange'),
      schema: {
        tags: [TAG_LIBRARY],
        summary: '批量下载压缩包',
        description: '将选中文件打包为 zip 并下载；无效文件会被跳过，全部无效时返回错误',
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: '文件id（uuid）列表' },
            filename: { type: 'string', description: '下载压缩包文件名，默认 files.zip' }
          }
        },
        response: {
          200: { description: 'zip 压缩包文件流，Content-Type 为 application/zip，以附件形式下载' }
        }
      }
    },
    async (request, reply) => {
      const { ids, filename } = request.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        throw new Error('请选择要下载的文件');
      }
      const compressStream = await services.fileRecord.getCompressFileStream({ ids, type: 'zip' });
      const outputFilename = encodeURIComponent(filename || 'files.zip');
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${outputFilename}"`);
      return reply.send(compressStream);
    }
  );

  if (options.enableFolder === false || !services.folder) {
    return;
  }

  const getFolderAuthenticate = action => {
    if (typeof options.getAuthenticate === 'function') {
      return options.getAuthenticate(action);
    }
    return [];
  };

  const withDefaultFolderType = source => async request => {
    const current = request[source] || {};
    if (!current.type) {
      request[source] = Object.assign({}, current, { type: defaultFolderType });
    }
  };

  const folderOnRequest = (action, source) => {
    const auth = getFolderAuthenticate(action);
    const hooks = [withDefaultFolderType(source)].concat(Array.isArray(auth) ? auth : [auth].filter(Boolean));
    return hooks;
  };

  fastify.get(
    `${options.prefix}/folder/tree`,
    {
      onRequest: folderOnRequest('read', 'query'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '获取文件夹树',
        description: '获取指定 type 的文件树；kind=folder 时仅返回文件夹节点；未传 type 时使用 defaultFolderType。文件节点会补充文件记录的 size、mimetype、filename 与时间',
        query: {
          type: 'object',
          properties: {
            type: { type: 'string', description: '业务域类型，默认 admin-file-system' },
            language: { type: 'string', description: '语言' },
            kind: { type: 'string', description: '传 folder（或 foldersOnly）时仅返回文件夹树' },
            tenantId: { description: TENANT_ID }
          }
        },
        response: success('根节点列表，子节点在 children 中', { type: 'array', items: folderTreeNode })
      }
    },
    async request => {
      return await services.folder.getTree(request.query);
    }
  );

  fastify.post(
    `${options.prefix}/folder/list`,
    {
      onRequest: folderOnRequest('read', 'body'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '分页获取目录子节点',
        description: '按 parentId 分页列出直接子节点；文件夹优先，再按名称排序；未传 type 时使用 defaultFolderType。perPage 最大 200',
        body: {
          type: 'object',
          properties: {
            type: { type: 'string', description: '业务域类型，默认 admin-file-system' },
            parentId: { type: 'string', description: '父文件夹 id，根目录可不传' },
            currentPage: { type: 'number', description: '当前页数' },
            perPage: { type: 'number', description: '每页数量' },
            keyword: { type: 'string', description: '按名称模糊搜索' },
            language: { type: 'string', description: '语言' }
          }
        },
        response: success('子节点分页列表', {
          type: 'object',
          additionalProperties: true,
          properties: {
            pageData: list('当前页子节点列表', folderNode),
            totalCount: num('直接子节点总数')
          }
        })
      }
    },
    async request => {
      const { type, parentId, currentPage, perPage, keyword, language } = Object.assign(
        {},
        {
          currentPage: 1,
          perPage: 20
        },
        request.body
      );
      return await services.folder.getList({
        type,
        parentId,
        currentPage,
        perPage,
        keyword,
        language
      });
    }
  );

  fastify.post(
    `${options.prefix}/folder/mkdir`,
    {
      onRequest: getFolderAuthenticate('write'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '新建文件夹',
        description: '在指定 type 下创建文件夹节点；同一文件夹下重名返回错误',
        body: {
          type: 'object',
          required: ['type', 'name'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            name: { type: 'string', description: '文件夹名称' },
            parentId: { type: 'string', description: '父文件夹 id，不传为根目录' },
            language: { type: 'string', description: '语言' },
            tenantId: { description: TENANT_ID }
          }
        },
        response: success('创建的文件夹节点', folderNode)
      }
    },
    async request => {
      return await services.folder.mkdir(request.body);
    }
  );

  fastify.post(
    `${options.prefix}/folder/upload`,
    {
      onRequest: getFolderAuthenticate('write'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '上传文件到文件夹',
        description: '上传文件实体（multipart/form-data，字段名 file）并在 group 中创建文件节点。通过 path 定位目标目录（经 ensurePath 解析/创建；空字符串为根目录）；同目录重名时文件名自动追加 [_时间戳]',
        query: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            path: { type: 'string', description: '目标文件夹路径（如 a/b/c）；空字符串或不传表示根目录' },
            namespace: { type: 'string', description: '文件命名空间' },
            language: { type: 'string', description: '语言' }
          }
        },
        response: success('创建的文件节点，file 为上传的文件记录', Object.assign({}, folderNode, { properties: Object.assign({}, folderNode.properties, { file: fileRecord }) }))
      }
    },
    async request => {
      const file = await request.file();
      if (!file) {
        throw new Error('不能获取到上传文件');
      }
      return await services.folder.upload({
        type: request.query.type,
        path: request.query.path,
        namespace: request.query.namespace,
        language: request.query.language,
        file
      });
    }
  );

  fastify.post(
    `${options.prefix}/folder/remove`,
    {
      onRequest: getFolderAuthenticate('delete'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '删除文件夹节点',
        description: '递归删除节点及其子孙；文件节点同步删除 file-record（linked 引用节点只删树节点，不删文件记录）',
        body: {
          type: 'object',
          required: ['type', 'id'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            id: { type: 'string', description: '节点 id' },
            language: { type: 'string', description: '语言' },
            tenantId: { description: TENANT_ID }
          }
        },
        response: empty('删除成功')
      }
    },
    async request => {
      return await services.folder.remove(request.body);
    }
  );

  fastify.post(
    `${options.prefix}/folder/move`,
    {
      onRequest: getFolderAuthenticate('write'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '移动文件夹节点',
        description: '将一个或多个文件/文件夹节点移动到目标文件夹（parentId 为空表示根目录）；目标须为文件夹，目标下重名返回错误',
        body: {
          type: 'object',
          required: ['type', 'ids'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            ids: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description: '要移动的节点 id 列表'
            },
            parentId: { type: ['string', 'null'], description: '目标父文件夹 id，空为根目录' },
            language: { type: 'string', description: '语言' },
            tenantId: { description: TENANT_ID }
          }
        },
        response: success('移动后的节点列表', { type: 'array', items: folderNode })
      }
    },
    async request => {
      return await services.folder.move(request.body);
    }
  );

  fastify.post(
    `${options.prefix}/folder/copy`,
    {
      onRequest: getFolderAuthenticate('write'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '复制文件夹节点',
        description:
          '将一个或多个文件/文件夹节点复制到目标文件夹（parentId 为空表示根目录）；文件以 linked 节点挂载，文件夹递归复制',
        body: {
          type: 'object',
          required: ['type', 'ids'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            ids: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description: '要复制的节点 id 列表'
            },
            parentId: { type: ['string', 'null'], description: '目标父文件夹 id，空为根目录' },
            language: { type: 'string', description: '语言' },
            tenantId: { description: TENANT_ID }
          }
        },
        response: success('复制生成的顶层节点列表（与 ids 一一对应）', { type: 'array', items: folderNode })
      }
    },
    async request => {
      return await services.folder.copy(request.body);
    }
  );

  fastify.post(
    `${options.prefix}/folder/rename`,
    {
      onRequest: getFolderAuthenticate('write'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '重命名文件夹节点',
        description: '重命名文件或文件夹节点；文件节点同步更新 file-record 文件名（linked 引用节点只改树节点名称）；同一文件夹下重名返回错误',
        body: {
          type: 'object',
          required: ['type', 'id', 'name'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            id: { type: 'string', description: '节点 id' },
            name: { type: 'string', description: '新名称' },
            language: { type: 'string', description: '语言' },
            tenantId: { description: TENANT_ID }
          }
        },
        response: success('重命名后的节点', folderNode)
      }
    },
    async request => {
      return await services.folder.rename(request.body);
    }
  );

  fastify.post(
    `${options.prefix}/folder/add-files`,
    {
      onRequest: getFolderAuthenticate('write'),
      preHandler: withDefaultFolderType('body'),
      schema: {
        tags: [TAG_FOLDER],
        summary: '将已有文件挂到文件夹树',
        description:
          '把文件库中已有文件以 linked 节点形式加入指定文件夹（parentId 为空表示根目录）；删除该类节点不会删除文件库实体；未传 type 时使用 defaultFolderType',
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            type: { type: 'string', description: '业务域类型，默认 admin-file-system' },
            ids: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              description: '文件库 file-record id 列表'
            },
            parentId: { type: ['string', 'null'], description: '目标父文件夹 id，空为根目录' },
            language: { type: 'string', description: '语言' },
            tenantId: { description: TENANT_ID }
          }
        },
        response: success('新挂载的文件节点列表；目标目录已挂载的文件会跳过，不出现在结果中', { type: 'array', items: folderNode })
      }
    },
    async request => {
      return await services.folder.addFiles(request.body);
    }
  );
});
