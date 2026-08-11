const fp = require('fastify-plugin');

const DEFAULT_FOLDER_TYPE = 'admin-file-system';

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
        summary: '上传文件',
        description:
          '上传单个文件到服务器或配置的存储服务。保存成功后自动挂到文件系统（默认 type=admin-file-system，未传 path 时挂到根目录；传 path 则按路径创建并挂载）',
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
        }
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
        summary: '上传URL文件',
        description:
          '上传单个文件到服务器或配置的存储服务。保存成功后自动挂到文件系统（默认 type=admin-file-system，未传 path 时挂到根目录；传 path 则按路径创建并挂载）',
        body: {
          type: 'object',
          properties: {
            url: { type: 'string', description: '文件url' },
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
        }
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
        summary: '获取文件url',
        description: '获取文件url',
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: '文件id' }
          }
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
        summary: '获取文件信息',
        description: '获取文件信息',
        query: {
          type: 'object',
          properties: {
            attachment: { type: 'boolean', description: '是否下载' },
            filename: { type: 'string', description: '下载文件名' }
          }
        },
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: '文件id' }
          }
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
        summary: '获取文件列表',
        description: '查询指定命名空间下的文件列表',
        body: {
          type: 'object',
          properties: {
            perPage: { type: 'number', description: '每页数量' },
            currentPage: { type: 'number', description: '当前页数' },
            filter: {
              type: 'object',
              properties: {
                namespace: { type: 'string', description: '文件分类命名空间' },
                size: { type: 'array', items: { type: 'number' }, description: '文件大小' },
                filename: { type: 'string', description: '文件名' }
              }
            }
          }
        }
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
        summary: '替换文件',
        description: '替换文件',
        query: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '文件id' }
          }
        }
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
        summary: '重命名文件',
        description: '重命名文件',
        body: {
          type: 'object',
          properties: {
            id: { type: 'string', description: '文件id' },
            filename: { type: 'string', description: '新文件名' }
          }
        }
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
        summary: '删除文件',
        description: '删除文件',
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: '文件id列表' }
          }
        }
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
        summary: '批量下载压缩包',
        description: '将选中文件打包为 zip 并下载',
        body: {
          type: 'object',
          required: ['ids'],
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: '文件id列表' },
            filename: { type: 'string', description: '下载压缩包文件名，默认 files.zip' }
          }
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
        summary: '获取文件夹树',
        description: '获取指定 type 的文件树；kind=folder 时仅返回文件夹节点；未传 type 时使用 defaultFolderType',
        query: {
          type: 'object',
          properties: {
            type: { type: 'string', description: '业务域类型，默认 admin-file-system' },
            language: { type: 'string', description: '语言' },
            kind: { type: 'string', description: '传 folder 时仅返回文件夹树' }
          }
        }
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
        summary: '分页获取目录子节点',
        description: '按 parentId 分页列出直接子节点；文件夹优先，再按名称排序；未传 type 时使用 defaultFolderType',
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
        }
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
        summary: '新建文件夹',
        description: '在指定 type 下创建文件夹节点',
        body: {
          type: 'object',
          required: ['type', 'name'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            name: { type: 'string', description: '文件夹名称' },
            parentId: { type: 'string', description: '父文件夹 id' },
            language: { type: 'string', description: '语言' }
          }
        }
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
        summary: '上传文件到文件夹',
        description: '上传文件实体并在 group 中创建文件节点。通过 path 定位目标目录（经 ensurePath 解析/创建；空字符串为根目录）',
        query: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            path: { type: 'string', description: '目标文件夹路径（如 a/b/c）；空字符串或不传表示根目录' },
            namespace: { type: 'string', description: '文件命名空间' },
            language: { type: 'string', description: '语言' }
          }
        }
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
        summary: '删除文件夹节点',
        description: '递归删除节点及其子孙；文件节点同步删除 file-record',
        body: {
          type: 'object',
          required: ['type', 'id'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            id: { type: 'string', description: '节点 id' },
            language: { type: 'string', description: '语言' }
          }
        }
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
        summary: '移动文件夹节点',
        description: '将一个或多个文件/文件夹节点移动到目标文件夹（parentId 为空表示根目录）',
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
            language: { type: 'string', description: '语言' }
          }
        }
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
            language: { type: 'string', description: '语言' }
          }
        }
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
        summary: '重命名文件夹节点',
        description: '重命名文件或文件夹节点；文件节点同步更新 file-record 文件名',
        body: {
          type: 'object',
          required: ['type', 'id', 'name'],
          properties: {
            type: { type: 'string', description: '业务域类型' },
            id: { type: 'string', description: '节点 id' },
            name: { type: 'string', description: '新名称' },
            language: { type: 'string', description: '语言' }
          }
        }
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
            language: { type: 'string', description: '语言' }
          }
        }
      }
    },
    async request => {
      return await services.folder.addFiles(request.body);
    }
  );
});
