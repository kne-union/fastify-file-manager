const assert = require('node:assert/strict');
const createTestApp = require('./helper');

const testBuffer = Buffer.from('folder-upload-content');

describe('folder services', () => {
  let app, services, tmpDir, close;

  beforeEach(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    services = testApp.services;
    tmpDir = testApp.tmpDir;
    close = testApp.close;
  });

  afterEach(async () => {
    await close();
  });

  it('should mkdir, upload, tree and remove', async () => {
    const type = 'fs-demo';

    const folder = await services.folder.mkdir({
      type,
      name: 'Docs'
    });
    assert.equal(folder.name, 'Docs');
    assert.equal(folder.options.kind, 'folder');

    const uploaded = await services.folder.upload({
      type,
      parentId: folder.id,
      file: {
        filename: 'hello.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: testBuffer
      }
    });

    assert.equal(uploaded.name, 'hello.txt');
    assert.equal(uploaded.options.kind, 'file');
    assert.ok(uploaded.options.fileId);
    assert.ok(uploaded.file?.id);

    const tree = await services.folder.getTree({ type });
    assert.equal(tree.length, 1);
    assert.equal(tree[0].name, 'Docs');
    assert.equal(tree[0].children.length, 1);
    assert.equal(tree[0].children[0].options.fileId, uploaded.options.fileId);
    assert.equal(tree[0].children[0].options.size, testBuffer.length);

    await services.folder.remove({ type, id: folder.id });

    const emptyTree = await services.folder.getTree({ type });
    assert.equal(emptyTree.length, 0);

    await assert.rejects(() => services.fileRecord.getFileInstance({ id: uploaded.options.fileId }), /文件不存在/);
  });

  it('folder http routes should work with type', async () => {
    const type = 'fs-http';

    const mkdirRes = await app.inject({
      method: 'POST',
      url: '/api/v3/static/folder/mkdir',
      payload: { type, name: 'Root' }
    });
    assert.equal(mkdirRes.statusCode, 200);
    const folder = mkdirRes.json();
    assert.equal(folder.name, 'Root');

    const treeRes = await app.inject({
      method: 'GET',
      url: `/api/v3/static/folder/tree?type=${type}`
    });
    assert.equal(treeRes.statusCode, 200);
    assert.equal(treeRes.json().length, 1);

    const removeRes = await app.inject({
      method: 'POST',
      url: '/api/v3/static/folder/remove',
      payload: { type, id: folder.id }
    });
    assert.equal(removeRes.statusCode, 200);
  });

  it('should move nodes to another folder', async () => {
    const type = 'fs-move';
    const folderA = await services.folder.mkdir({ type, name: 'A' });
    const folderB = await services.folder.mkdir({ type, name: 'B' });
    const uploaded = await services.folder.upload({
      type,
      parentId: folderA.id,
      file: {
        filename: 'move-me.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: testBuffer
      }
    });

    await services.folder.move({
      type,
      ids: [uploaded.id],
      parentId: folderB.id
    });

    const tree = await services.folder.getTree({ type });
    const b = tree.find(item => item.id === folderB.id);
    assert.ok(b);
    assert.equal(b.children.length, 1);
    assert.equal(b.children[0].id, uploaded.id);

    const moveRes = await app.inject({
      method: 'POST',
      url: '/api/v3/static/folder/move',
      payload: { type, ids: [folderA.id], parentId: folderB.id }
    });
    assert.equal(moveRes.statusCode, 200);
  });

  it('should copy file and folder into another folder', async () => {
    const type = 'fs-copy';
    const folderA = await services.folder.mkdir({ type, name: 'A' });
    const folderB = await services.folder.mkdir({ type, name: 'B' });
    const uploaded = await services.folder.upload({
      type,
      parentId: folderA.id,
      file: {
        filename: 'copy-me.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: Buffer.from('copy-content')
      }
    });

    const copied = await services.folder.copy({
      type,
      ids: [uploaded.id],
      parentId: folderB.id
    });
    assert.equal(copied.length, 1);
    assert.equal(copied[0].name, 'copy-me.txt');
    assert.equal(copied[0].parentId, folderB.id);
    assert.equal(copied[0].options.fileId, uploaded.options.fileId);
    assert.equal(copied[0].options.linked, true);

    const folderCopy = await services.folder.copy({
      type,
      ids: [folderA.id],
      parentId: folderB.id
    });
    assert.equal(folderCopy.length, 1);
    assert.equal(folderCopy[0].name, 'A');
    assert.equal(folderCopy[0].parentId, folderB.id);

    const tree = await services.folder.getTree({ type });
    const b = tree.find(item => item.id === folderB.id);
    assert.ok(b.children.some(item => item.id === copied[0].id));
    assert.ok(b.children.some(item => item.id === folderCopy[0].id));
    const nested = b.children.find(item => item.id === folderCopy[0].id);
    assert.ok(nested.children.some(item => item.name === 'copy-me.txt'));

    await assert.rejects(
      () =>
        services.folder.copy({
          type,
          ids: [folderA.id],
          parentId: folderA.id
        }),
      /不能复制到自身/
    );
  });

  it('should add existing files as linked nodes and reject same name in folder', async () => {
    const type = 'fs-add-files';
    const folder = await services.folder.mkdir({ type, name: 'Inbox' });
    const fileA = await services.fileRecord.uploadToFileSystem({
      file: {
        filename: 'same-name.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: Buffer.from('a')
      }
    });
    const fileB = await services.fileRecord.uploadToFileSystem({
      file: {
        filename: 'same-name.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: Buffer.from('b')
      }
    });
    const fileC = await services.fileRecord.uploadToFileSystem({
      file: {
        filename: 'other.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: Buffer.from('c')
      }
    });

    const first = await services.folder.addFiles({
      type,
      parentId: folder.id,
      ids: [fileA.id, fileC.id]
    });
    assert.equal(first.length, 2);
    assert.equal(first[0].options.fileId, fileA.id);
    assert.equal(first[0].options.linked, true);

    const renamed = await services.folder.addFiles({
      type,
      parentId: folder.id,
      ids: [fileB.id]
    });
    assert.equal(renamed.length, 1);
    assert.match(renamed[0].name, /^same-name\[\_\d+\]\.txt$/);
    assert.equal(renamed[0].options.fileId, fileB.id);

    const second = await services.folder.addFiles({
      type,
      parentId: folder.id,
      ids: [fileA.id, fileC.id]
    });
    assert.equal(second.length, 0);

    const tree = await services.folder.getTree({ type });
    assert.equal(tree[0].children.length, 3);
  });

  it('should auto rename duplicate upload name and still reject rename conflict', async () => {
    const type = 'fs-unique-name';
    const folder = await services.folder.mkdir({ type, name: 'Docs' });
    await services.folder.upload({
      type,
      parentId: folder.id,
      file: {
        filename: 'readme.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: Buffer.from('one')
      }
    });
    const duplicated = await services.folder.upload({
      type,
      parentId: folder.id,
      file: {
        filename: 'readme.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: Buffer.from('two')
      }
    });
    assert.match(duplicated.name, /^readme\[\_\d+\]\.txt$/);

    const other = await services.folder.upload({
      type,
      parentId: folder.id,
      file: {
        filename: 'notes.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: Buffer.from('notes')
      }
    });
    await assert.rejects(
      () =>
        services.folder.rename({
          type,
          id: other.id,
          name: 'readme.txt'
        }),
      /同一文件夹下已存在同名/
    );
  });

  it('should ensurePath create nested folders and attachRecord mount file', async () => {
    const type = 'fs-ensure-path';
    const leafId = await services.folder.ensurePath({ type, path: 'a/b/c' });
    assert.ok(leafId);

    const again = await services.folder.ensurePath({ type, path: 'a/b/c' });
    assert.equal(String(again), String(leafId));

    const tree = await services.folder.getTree({ type });
    assert.equal(tree.length, 1);
    assert.equal(tree[0].name, 'a');
    assert.equal(tree[0].children[0].name, 'b');
    assert.equal(tree[0].children[0].children[0].name, 'c');
    assert.equal(tree[0].children[0].children[0].id, leafId);

    const file = await services.fileRecord.uploadToFileSystem({
      file: {
        filename: 'nested.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: Buffer.from('nested')
      }
    });
    const node = await services.folder.attachRecord({
      type,
      parentId: leafId,
      record: file,
      linked: true
    });
    assert.equal(node.options.fileId, file.id);
    assert.equal(node.options.linked, true);
    assert.equal(node.parentId, leafId);
  });

  it('POST /upload without path should attach to admin-file-system root', async () => {
    const boundary = '----UploadRootBoundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="root.txt"',
      'Content-Type: text/plain',
      '',
      'hello-root',
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: '/api/v3/static/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.id);
    assert.ok(body.folder);
    assert.equal(body.folder.options.fileId, body.id);
    assert.equal(body.folder.options.linked, true);
    assert.equal(body.folder.parentId, null);

    const tree = await services.folder.getTree({ type: 'admin-file-system' });
    assert.ok(tree.some(item => item.options?.fileId === body.id));
  });

  it('POST /upload with path should auto mkdir and attach to folder tree', async () => {
    const type = 'fs-upload-path';
    const boundary = '----UploadPathBoundary';
    const payload = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="auto.txt"',
      'Content-Type: text/plain',
      '',
      'hello-path',
      `--${boundary}--`,
      ''
    ].join('\r\n');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v3/static/upload?path=${encodeURIComponent('docs/inbox')}&type=${type}`,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.id);
    assert.ok(body.folder);
    assert.equal(body.folder.options.fileId, body.id);
    assert.equal(body.folder.options.linked, true);

    const tree = await services.folder.getTree({ type });
    assert.equal(tree[0].name, 'docs');
    assert.equal(tree[0].children[0].name, 'inbox');
    assert.equal(tree[0].children[0].children[0].options.fileId, body.id);
  });

  it('should list folder children with pagination and folder-first order', async () => {
    const type = 'fs-list';
    const folder = await services.folder.mkdir({ type, name: 'Docs' });
    await services.folder.mkdir({ type, name: 'Alpha', parentId: folder.id });
    await services.folder.upload({
      type,
      parentId: folder.id,
      file: {
        filename: 'z-file.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: testBuffer
      }
    });
    await services.folder.upload({
      type,
      parentId: folder.id,
      file: {
        filename: 'a-file.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: testBuffer
      }
    });
    await services.folder.mkdir({ type, name: 'Beta', parentId: folder.id });

    const page1 = await services.folder.getList({
      type,
      parentId: folder.id,
      currentPage: 1,
      perPage: 2
    });
    assert.equal(page1.totalCount, 4);
    assert.equal(page1.pageData.length, 2);
    assert.equal(page1.pageData[0].options.kind, 'folder');
    assert.equal(page1.pageData[1].options.kind, 'folder');
    assert.equal(page1.pageData[0].name, 'Alpha');
    assert.equal(page1.pageData[1].name, 'Beta');

    const page2 = await services.folder.getList({
      type,
      parentId: folder.id,
      currentPage: 2,
      perPage: 2
    });
    assert.equal(page2.pageData.length, 2);
    assert.equal(page2.pageData[0].options.kind, 'file');
    assert.equal(page2.pageData[1].options.kind, 'file');
    assert.equal(page2.pageData[0].name, 'a-file.txt');
    assert.equal(page2.pageData[1].name, 'z-file.txt');

    const filtered = await services.folder.getList({
      type,
      parentId: folder.id,
      currentPage: 1,
      perPage: 10,
      keyword: 'Alpha'
    });
    assert.equal(filtered.totalCount, 1);
    assert.equal(filtered.pageData[0].name, 'Alpha');

    const httpRes = await app.inject({
      method: 'POST',
      url: '/api/v3/static/folder/list',
      payload: { type, parentId: folder.id, currentPage: 1, perPage: 10 }
    });
    assert.equal(httpRes.statusCode, 200);
    const body = httpRes.json();
    assert.equal(body.totalCount, 4);
    assert.equal(body.pageData.length, 4);
  });

  it('should return folders-only tree when kind=folder', async () => {
    const type = 'fs-tree-folder-only';
    const folder = await services.folder.mkdir({ type, name: 'Root' });
    await services.folder.upload({
      type,
      parentId: folder.id,
      file: {
        filename: 'secret.txt',
        mimetype: 'text/plain',
        encoding: 'utf-8',
        buffer: testBuffer
      }
    });
    await services.folder.mkdir({ type, name: 'Child', parentId: folder.id });

    const fullTree = await services.folder.getTree({ type });
    assert.equal(fullTree[0].children.length, 2);

    const folderTree = await services.folder.getTree({ type, kind: 'folder' });
    assert.equal(folderTree.length, 1);
    assert.equal(folderTree[0].name, 'Root');
    assert.equal(folderTree[0].children.length, 1);
    assert.equal(folderTree[0].children[0].name, 'Child');
    assert.equal(folderTree[0].children[0].options.kind, 'folder');

    const httpRes = await app.inject({
      method: 'GET',
      url: `/api/v3/static/folder/tree?type=${type}&kind=folder`
    });
    assert.equal(httpRes.statusCode, 200);
    assert.equal(httpRes.json()[0].children.length, 1);
  });
});
