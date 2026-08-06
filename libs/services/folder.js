const fp = require('fastify-plugin');

module.exports = fp(async (fastify, fastifyOptions) => {
  if (fastifyOptions.enableFolder === false) {
    return;
  }

  const groupName = fastifyOptions.groupName || 'group';
  const group = fastify[groupName];
  if (!group?.services) {
    throw new Error(`文件夹功能需要先注册 @kne/fastify-group（fastify.${groupName}）`);
  }

  const { services } = fastify.fileManager;
  const groupServices = group.services;

  const getNodeKind = node => {
    const kind = node?.options?.kind;
    if (kind === 'file' || kind === 'folder') {
      return kind;
    }
    return node?.options?.fileId ? 'file' : 'folder';
  };

  const isUuidLike = value =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

  const resolveRecordFileId = record => {
    if (!record) {
      return '';
    }
    const uuid = typeof record.getDataValue === 'function' ? record.getDataValue('uuid') : record.uuid;
    if (uuid) {
      return String(uuid);
    }
    const id = typeof record.getDataValue === 'function' ? record.getDataValue('id') : record.id;
    return String(id || '');
  };

  const findChildByName = async ({ type, parentId, name, language, tenantId }) => {
    const where = Object.assign(
      { type, parentId: parentId || null, name },
      language ? { language } : {},
      tenantId != null ? { tenantId } : {}
    );
    const node = await group.models.tag.findOne({ where });
    return node ? (typeof node.get === 'function' ? node.get({ plain: true }) : node) : null;
  };

  const assertUniqueSiblingName = async ({ type, parentId, name, language, tenantId, excludeId }) => {
    const existing = await findChildByName({ type, parentId: parentId || null, name, language, tenantId });
    if (existing && String(existing.id) !== String(excludeId || '')) {
      throw new Error(`同一文件夹下已存在同名文件或文件夹：${name}`);
    }
  };

  const collectFileIds = nodes => {
    const ids = [];
    const walk = list => {
      (list || []).forEach(node => {
        const plain = typeof node.get === 'function' ? node.get({ plain: true }) : node;
        if (getNodeKind(plain) === 'file' && plain.options?.fileId) {
          ids.push(plain.options.fileId);
        }
        if (plain.children?.length) {
          walk(plain.children);
        }
      });
    };
    walk(nodes);
    return ids;
  };

  const enrichTree = async tree => {
    const fileIds = collectFileIds(tree);
    if (fileIds.length === 0) {
      return tree;
    }

    const uniqueIds = [...new Set(fileIds.map(String))];
    const fileMap = new Map();
    await Promise.all(
      uniqueIds.map(async id => {
        try {
          const file = await services.fileRecord.getFileInstance({ id });
          fileMap.set(String(id), file);
        } catch (e) {
          // 文件记录缺失时仍返回树节点
        }
      })
    );

    const mapNode = node => {
      const plain = { ...node };
      const kind = getNodeKind(plain);
      plain.options = Object.assign({}, plain.options, { kind });
      if (kind === 'file' && plain.options.fileId) {
        const file = fileMap.get(String(plain.options.fileId));
        if (file) {
          plain.options = Object.assign({}, plain.options, {
            size: file.size,
            mimetype: file.mimetype,
            filename: file.filename
          });
          if (file.createdAt) {
            plain.createdAt = file.createdAt;
          }
          if (file.updatedAt) {
            plain.updatedAt = file.updatedAt;
          }
        }
      }
      if (plain.children?.length) {
        plain.children = plain.children.map(mapNode);
      }
      return plain;
    };

    return (tree || []).map(mapNode);
  };

  const getTree = async ({ type, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    const tree = await groupServices.groupList({ type, language, output: 'tree', tenantId });
    return enrichTree(tree);
  };

  const mkdir = async ({ type, name, parentId, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    if (!name) {
      throw new Error('必须传入文件夹名称');
    }
    await assertUniqueSiblingName({ type, parentId: parentId || null, name, language, tenantId });
    const tag = await groupServices.save({
      type,
      name,
      parentId: parentId || null,
      language,
      tenantId,
      options: { kind: 'folder' }
    });
    return typeof tag.get === 'function' ? tag.get({ plain: true }) : tag;
  };

  const upload = async ({ type, parentId, file, namespace, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    if (!file) {
      throw new Error('不能获取到上传文件');
    }

    const targetParentId = parentId || null;
    await assertUniqueSiblingName({
      type,
      parentId: targetParentId,
      name: file.filename,
      language,
      tenantId
    });

    const record = await services.fileRecord.uploadToFileSystem({
      file,
      namespace: namespace || fastifyOptions.namespace
    });

    const tag = await groupServices.save({
      type,
      name: record.filename,
      parentId: targetParentId,
      language,
      tenantId,
      options: {
        kind: 'file',
        fileId: resolveRecordFileId(record),
        size: record.size,
        mimetype: record.mimetype
      }
    });

    const plain = typeof tag.get === 'function' ? tag.get({ plain: true }) : tag;
    return Object.assign({}, plain, { file: record });
  };

  const remove = async ({ type, id, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    if (!id) {
      throw new Error('必须传入节点 id');
    }

    const root = await groupServices.detail({ id, type, language, tenantId });
    if (!root) {
      throw new Error('节点不存在');
    }

    const descendantIds = await groupServices.getDescendantIds({ id, type, language, tenantId });
    const fileIds = [];

    for (const nodeId of descendantIds) {
      const node = await groupServices.detail({ id: nodeId, type, language, tenantId });
      if (!node) {
        continue;
      }
      const plain = typeof node.get === 'function' ? node.get({ plain: true }) : node;
      // linked 节点只删树，不删文件库实体
      if (getNodeKind(plain) === 'file' && plain.options?.fileId && plain.options?.linked !== true) {
        fileIds.push(plain.options.fileId);
      }
    }

    if (fileIds.length > 0) {
      await services.fileRecord.deleteFiles({ ids: [...new Set(fileIds)] });
    }

    // 先删子孙再删根，避免残留
    const orderedIds = descendantIds.slice().reverse();
    for (const nodeId of orderedIds) {
      await groupServices.remove({ id: nodeId, type, language, tenantId });
    }

    return {};
  };

  const move = async ({ type, ids, parentId, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    const idList = Array.isArray(ids) ? ids.filter(Boolean) : ids ? [ids] : [];
    if (idList.length === 0) {
      throw new Error('必须传入节点 id');
    }

    const targetParentId = parentId || null;
    if (targetParentId) {
      const parent = await groupServices.detail({ id: targetParentId, type, language, tenantId });
      if (!parent) {
        throw new Error('目标文件夹不存在');
      }
      const parentPlain = typeof parent.get === 'function' ? parent.get({ plain: true }) : parent;
      if (getNodeKind(parentPlain) !== 'folder') {
        throw new Error('只能移动到文件夹');
      }
    }

    const results = [];
    for (const id of idList) {
      const node = await groupServices.detail({ id, type, language, tenantId });
      if (!node) {
        throw new Error(`节点不存在: ${id}`);
      }
      const plain = typeof node.get === 'function' ? node.get({ plain: true }) : node;
      await assertUniqueSiblingName({
        type,
        parentId: targetParentId,
        name: plain.name,
        language,
        tenantId,
        excludeId: plain.id
      });
      const tag = await groupServices.save({
        id,
        type,
        parentId: targetParentId,
        language,
        tenantId
      });
      results.push(typeof tag.get === 'function' ? tag.get({ plain: true }) : tag);
    }
    return results;
  };

  const listDirectChildren = async ({ type, parentId, language, tenantId }) => {
    const where = Object.assign(
      { type, parentId: parentId || null },
      language ? { language } : {},
      tenantId != null ? { tenantId } : {}
    );
    const rows = await group.models.tag.findAll({ where });
    return rows.map(item => (typeof item.get === 'function' ? item.get({ plain: true }) : item));
  };

  const copyNodeRecursive = async ({ type, sourceId, parentId, language, tenantId }) => {
    const node = await groupServices.detail({ id: String(sourceId), type, language, tenantId });
    if (!node) {
      throw new Error(`节点不存在: ${sourceId}`);
    }
    const plain = typeof node.get === 'function' ? node.get({ plain: true }) : node;
    await assertUniqueSiblingName({
      type,
      parentId: parentId || null,
      name: plain.name,
      language,
      tenantId
    });

    if (getNodeKind(plain) === 'folder') {
      const created = await mkdir({
        type,
        name: plain.name,
        parentId: parentId || null,
        language,
        tenantId
      });
      const children = await listDirectChildren({ type, parentId: plain.id, language, tenantId });
      for (const child of children) {
        await copyNodeRecursive({
          type,
          sourceId: child.id,
          parentId: created.id,
          language,
          tenantId
        });
      }
      return created;
    }

    const fileId = plain.options?.fileId;
    if (!fileId) {
      throw new Error(`文件节点缺少 fileId: ${plain.name}`);
    }
    const tag = await groupServices.save({
      type,
      name: plain.name,
      parentId: parentId || null,
      language,
      tenantId,
      options: {
        kind: 'file',
        fileId,
        size: plain.options?.size,
        mimetype: plain.options?.mimetype,
        linked: true
      }
    });
    return typeof tag.get === 'function' ? tag.get({ plain: true }) : tag;
  };

  const copy = async ({ type, ids, parentId, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    const idList = Array.isArray(ids) ? ids.filter(Boolean) : ids ? [ids] : [];
    if (idList.length === 0) {
      throw new Error('必须传入节点 id');
    }

    const targetParentId = parentId || null;
    if (targetParentId) {
      const parent = await groupServices.detail({ id: targetParentId, type, language, tenantId });
      if (!parent) {
        throw new Error('目标文件夹不存在');
      }
      const parentPlain = typeof parent.get === 'function' ? parent.get({ plain: true }) : parent;
      if (getNodeKind(parentPlain) !== 'folder') {
        throw new Error('只能复制到文件夹');
      }
    }

    const results = [];
    for (const id of idList) {
      if (targetParentId) {
        const descendantIds = await groupServices.getDescendantIds({
          id: String(id),
          type,
          language,
          tenantId
        });
        if (descendantIds.map(String).includes(String(targetParentId))) {
          throw new Error('不能复制到自身或其子文件夹');
        }
      }
      results.push(
        await copyNodeRecursive({
          type,
          sourceId: id,
          parentId: targetParentId,
          language,
          tenantId
        })
      );
    }
    return results;
  };

  const rename = async ({ type, id, name, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    if (!id) {
      throw new Error('必须传入节点 id');
    }
    if (!name) {
      throw new Error('必须传入名称');
    }

    const node = await groupServices.detail({ id: String(id), type, language, tenantId });
    if (!node) {
      throw new Error('节点不存在');
    }
    const plain = typeof node.get === 'function' ? node.get({ plain: true }) : node;
    await assertUniqueSiblingName({
      type,
      parentId: plain.parentId || null,
      name,
      language,
      tenantId,
      excludeId: plain.id
    });
    // 直接 update，避免 group.save 在查不到 id 时误走创建
    await node.update({ name });
    const tag = await groupServices.detail({ id: String(id), type, language, tenantId });

    // linked 节点只改树显示名，不改文件库实体
    if (getNodeKind(plain) === 'file' && plain.options?.fileId && plain.options?.linked !== true) {
      try {
        await services.fileRecord.renameFile({ id: plain.options.fileId, filename: name });
      } catch (e) {
        // 树节点已改名；文件记录缺失时不阻断
      }
    }

    return typeof tag.get === 'function' ? tag.get({ plain: true }) : tag || Object.assign({}, plain, { name });
  };

  const normalizePathSegments = folderPath =>
    String(folderPath || '')
      .replace(/\\/g, '/')
      .split('/')
      .map(segment => segment.trim())
      .filter(segment => segment && segment !== '.' && segment !== '..');

  /**
   * 按路径逐级确保文件夹存在（不存在则创建），返回叶子文件夹 id；空路径返回 null（根目录）
   */
  const ensurePath = async ({ type, path: folderPath, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    const segments = normalizePathSegments(folderPath);
    let parentId = null;
    for (const name of segments) {
      const existing = await findChildByName({ type, parentId, name, language, tenantId });
      if (existing) {
        if (getNodeKind(existing) !== 'folder') {
          throw new Error(`路径冲突：${name} 不是文件夹`);
        }
        parentId = existing.id;
        continue;
      }
      const created = await mkdir({ type, name, parentId, language, tenantId });
      parentId = created.id;
    }
    return parentId;
  };

  /**
   * 将已上传的文件记录挂到文件夹树（默认 linked，删除树节点不删文件实体）
   */
  const attachRecord = async ({ type, parentId, record, language, tenantId, linked = true }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    if (!record) {
      throw new Error('必须传入文件记录');
    }
    const targetParentId = parentId || null;
    if (targetParentId) {
      const parent = await groupServices.detail({ id: targetParentId, type, language, tenantId });
      if (!parent) {
        throw new Error('目标文件夹不存在');
      }
      const parentPlain = typeof parent.get === 'function' ? parent.get({ plain: true }) : parent;
      if (getNodeKind(parentPlain) !== 'folder') {
        throw new Error('只能加入到文件夹');
      }
    }

    const linkedFileId = resolveRecordFileId(record);
    const siblingWhere = Object.assign(
      { type, parentId: targetParentId },
      language ? { language } : {},
      tenantId != null ? { tenantId } : {}
    );
    const siblings = await group.models.tag.findAll({ where: siblingWhere });
    const alreadyMounted = siblings.some(item => {
      const plain = typeof item.get === 'function' ? item.get({ plain: true }) : item;
      return getNodeKind(plain) === 'file' && String(plain.options?.fileId) === linkedFileId;
    });
    if (alreadyMounted) {
      return null;
    }

    await assertUniqueSiblingName({
      type,
      parentId: targetParentId,
      name: record.filename,
      language,
      tenantId
    });

    const tag = await groupServices.save({
      type,
      name: record.filename,
      parentId: targetParentId,
      language,
      tenantId,
      options: {
        kind: 'file',
        fileId: linkedFileId,
        size: record.size,
        mimetype: record.mimetype,
        ...(linked ? { linked: true } : {})
      }
    });
    return typeof tag.get === 'function' ? tag.get({ plain: true }) : tag;
  };

  const addFiles = async ({ type, parentId, ids, language, tenantId }) => {
    if (!type) {
      throw new Error('必须传入类型');
    }
    const idList = [...new Set((Array.isArray(ids) ? ids : ids ? [ids] : []).filter(Boolean).map(String))];
    if (idList.length === 0) {
      throw new Error('必须传入文件 id');
    }

    const targetParentId = parentId || null;
    if (targetParentId) {
      const parent = await groupServices.detail({ id: targetParentId, type, language, tenantId });
      if (!parent) {
        throw new Error('目标文件夹不存在');
      }
      const parentPlain = typeof parent.get === 'function' ? parent.get({ plain: true }) : parent;
      if (getNodeKind(parentPlain) !== 'folder') {
        throw new Error('只能加入到文件夹');
      }
    }

    // 同目录下已挂载的 fileId（兼容历史存主键的数据）
    const siblingWhere = Object.assign(
      { type, parentId: targetParentId },
      language ? { language } : {},
      tenantId != null ? { tenantId } : {}
    );
    const siblings = await group.models.tag.findAll({ where: siblingWhere });
    const existingFileIds = new Set();
    const existingNames = new Set();
    siblings.forEach(item => {
      const plain = typeof item.get === 'function' ? item.get({ plain: true }) : item;
      if (plain.name) {
        existingNames.add(String(plain.name));
      }
      if (getNodeKind(plain) === 'file' && plain.options?.fileId != null) {
        existingFileIds.add(String(plain.options.fileId));
      }
    });

    const results = [];
    for (const fileId of idList) {
      const record = await services.fileRecord.getFileInstance({ id: fileId });
      // 列表入参多为 uuid；若是历史主键则从记录上取 uuid，禁止把雪花主键写入 options.fileId
      const linkedFileId = isUuidLike(fileId) ? String(fileId) : resolveRecordFileId(record);
      // 已在目标目录则跳过，避免重复挂载
      if (existingFileIds.has(linkedFileId) || existingFileIds.has(String(record.id)) || existingFileIds.has(String(fileId))) {
        continue;
      }
      if (existingNames.has(String(record.filename))) {
        throw new Error(`同一文件夹下已存在同名文件或文件夹：${record.filename}`);
      }
      const tag = await groupServices.save({
        type,
        name: record.filename,
        parentId: targetParentId,
        language,
        tenantId,
        options: {
          kind: 'file',
          fileId: linkedFileId,
          size: record.size,
          mimetype: record.mimetype,
          linked: true
        }
      });
      existingFileIds.add(linkedFileId);
      existingNames.add(String(record.filename));
      results.push(typeof tag.get === 'function' ? tag.get({ plain: true }) : tag);
    }
    return results;
  };

  Object.assign(services, {
    folder: {
      getTree,
      mkdir,
      upload,
      remove,
      move,
      copy,
      rename,
      addFiles,
      ensurePath,
      attachRecord
    }
  });
});
