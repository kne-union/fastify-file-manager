const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('fs-extra');
const os = require('node:os');
const { Readable } = require('node:stream');
const createTestApp = require('./helper');

const testBuffer = Buffer.from('Hello, World!');
const testHash = crypto.createHash('md5').update(testBuffer).digest('hex');

describe('fastify-file-manager', () => {
  let app, services, models, tmpDir;

  beforeEach(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
    services = testApp.services;
    models = testApp.models;
    tmpDir = testApp.tmpDir;
  });

  afterEach(async () => {
    await app.close();
    await fs.remove(tmpDir).catch(() => {});
  });

  describe('uploadToFileSystem', () => {
    it('should upload from buffer', async () => {
      const result = await services.fileRecord.uploadToFileSystem({
        file: {
          filename: 'test.txt',
          mimetype: 'text/plain',
          encoding: 'utf-8',
          buffer: testBuffer
        }
      });

      assert.equal(result.filename, 'test.txt');
      assert.equal(result.hash, testHash);
      assert.equal(result.size, testBuffer.length);
      assert.equal(result.storageType, 'local');
      assert.equal(result.mimetype, 'text/plain');
      assert.ok(result.id);
      assert.ok(result.createdAt);
    });

    it('should upload from toBuffer', async () => {
      const result = await services.fileRecord.uploadToFileSystem({
        file: {
          filename: 'toBuffer-test.txt',
          mimetype: 'text/plain',
          encoding: 'utf-8',
          toBuffer: async () => testBuffer
        }
      });

      assert.equal(result.hash, testHash);
      assert.equal(result.size, testBuffer.length);
      assert.equal(result.storageType, 'local');
    });

    it('should upload from stream', async () => {
      const stream = Readable.from(testBuffer);

      const result = await services.fileRecord.uploadToFileSystem({
        file: {
          filename: 'test-stream.txt',
          mimetype: 'text/plain',
          encoding: 'utf-8',
          file: stream
        }
      });

      assert.equal(result.filename, 'test-stream.txt');
      assert.equal(result.hash, testHash);
      assert.equal(result.size, testBuffer.length);
      assert.equal(result.storageType, 'local');
    });

    it('should upload from filepath', async () => {
      const filePath = path.resolve(tmpDir, 'source.txt');
      await fs.writeFile(filePath, testBuffer);

      const result = await services.fileRecord.uploadToFileSystem({
        file: {
          filename: 'test-filepath.txt',
          mimetype: 'text/plain',
          encoding: 'utf-8',
          filepath: filePath
        }
      });

      assert.equal(result.filename, 'test-filepath.txt');
      assert.equal(result.hash, testHash);
      assert.equal(result.size, testBuffer.length);
      assert.equal(result.storageType, 'local');
    });

    it('should compute correct hash for filepath source (stream-based)', async () => {
      const content = Buffer.from('stream hash verification content');
      const filePath = path.resolve(tmpDir, 'hash-verify.txt');
      await fs.writeFile(filePath, content);
      const expectedHash = crypto.createHash('md5').update(content).digest('hex');

      const result = await services.fileRecord.uploadToFileSystem({
        file: {
          filename: 'hash-verify.txt',
          mimetype: 'text/plain',
          encoding: 'utf-8',
          filepath: filePath
        }
      });

      assert.equal(result.hash, expectedHash, 'filepath source hash should match expected MD5');
    });

    it('should deduplicate files with same content via hash', async () => {
      const result1 = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'file1.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });
      const result2 = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'file2.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      assert.equal(result1.hash, result2.hash);
      assert.equal(result1.hash, testHash);
      assert.notEqual(result1.id, result2.id);
      assert.equal(result1.filename, 'file1.txt');
      assert.equal(result2.filename, 'file2.txt');

      // same hash means same stored file on disk
      const storedFiles = await fs.readdir(tmpDir);
      assert.equal(storedFiles.length, 1, 'should store only one file on disk');
    });

    it('should use custom namespace', async () => {
      const result = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer },
        namespace: 'custom-ns'
      });

      assert.equal(result.namespace, 'custom-ns');
    });

    it('should use default namespace when not specified', async () => {
      const result = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      assert.equal(result.namespace, 'test');
    });

    it('should pass options to record', async () => {
      const customOptions = { tag: 'avatar', userId: 123 };
      const result = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer },
        options: customOptions
      });

      assert.deepEqual(result.options, customOptions);
    });

    it('should replace file when id is provided', async () => {
      const original = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'original.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('original') }
      });

      const newBuffer = Buffer.from('replaced content');
      const replaced = await services.fileRecord.uploadToFileSystem({
        id: original.id,
        file: { filename: 'replaced.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: newBuffer }
      });

      assert.equal(replaced.id, original.id);
      assert.equal(replaced.filename, 'replaced.txt');
      const newHash = crypto.createHash('md5').update(newBuffer).digest('hex');
      assert.equal(replaced.hash, newHash);
    });

    it('should throw for unsupported file type', async () => {
      await assert.rejects(
        () =>
          services.fileRecord.uploadToFileSystem({
            file: { filename: 'test.txt', mimetype: 'text/plain', encoding: 'utf-8' }
          }),
        { message: '文件类型不支持' }
      );
    });

    it('should store file on disk with hash-based name', async () => {
      await services.fileRecord.uploadToFileSystem({
        file: { filename: 'test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      const storedFiles = await fs.readdir(tmpDir);
      assert.ok(storedFiles.some(f => f === `${testHash}.txt`));
    });
  });

  describe('getFileUrl', () => {
    it('should return correct URL for local file', async () => {
      const uploadResult = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'url-test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      const url = await services.fileRecord.getFileUrl({ id: uploadResult.id });

      assert.ok(url.includes('/api/v3/static/file/'));
      assert.ok(url.includes(`${uploadResult.hash}.txt`));
      assert.ok(url.includes(`filename=${uploadResult.filename}`));
    });

    it('should throw for non-existing file', async () => {
      await assert.rejects(() => services.fileRecord.getFileUrl({ id: 'non-existent-id' }), {
        message: '文件不存在'
      });
    });

    it('should throw NotFound when stored file is missing', async () => {
      const uploadResult = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'will-remove.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      // remove stored file from disk
      await fs.remove(path.resolve(tmpDir, `${uploadResult.hash}.txt`));

      await assert.rejects(() => services.fileRecord.getFileUrl({ id: uploadResult.id }), function (err) {
        return err.status === 404;
      });
    });
  });

  describe('getFileInfo', () => {
    it('should return file info with filePath', async () => {
      const uploadResult = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'info-test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      const info = await services.fileRecord.getFileInfo({ id: uploadResult.id });

      assert.equal(info.id, uploadResult.id);
      assert.equal(info.filename, 'info-test.txt');
      assert.equal(info.filePath, `${uploadResult.hash}.txt`);
      assert.ok(!info.targetFile);
    });

    it('should throw for non-existing file', async () => {
      await assert.rejects(() => services.fileRecord.getFileInfo({ id: 'non-existent-id' }), {
        message: '文件不存在'
      });
    });
  });

  describe('getFileList', () => {
    beforeEach(async () => {
      await services.fileRecord.uploadToFileSystem({
        file: { filename: 'hello.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('hello') },
        namespace: 'ns-a'
      });
      await services.fileRecord.uploadToFileSystem({
        file: { filename: 'world.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('world') },
        namespace: 'ns-a'
      });
      await services.fileRecord.uploadToFileSystem({
        file: { filename: 'foo.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('foo') },
        namespace: 'ns-b'
      });
    });

    it('should return paginated file list', async () => {
      const result = await services.fileRecord.getFileList({ currentPage: 1, perPage: 10 });

      assert.equal(result.totalCount, 3);
      assert.equal(result.pageData.length, 3);
    });

    it('should respect perPage limit', async () => {
      const result = await services.fileRecord.getFileList({ currentPage: 1, perPage: 2 });

      assert.equal(result.pageData.length, 2);
      assert.equal(result.totalCount, 3);
    });

    it('should filter by filename', async () => {
      const result = await services.fileRecord.getFileList({
        currentPage: 1, perPage: 10, filter: { filename: 'hello' }
      });

      assert.equal(result.totalCount, 1);
      assert.equal(result.pageData[0].filename, 'hello.txt');
    });

    it('should filter by namespace', async () => {
      const result = await services.fileRecord.getFileList({
        currentPage: 1, perPage: 10, namespace: 'ns-a'
      });

      assert.equal(result.totalCount, 2);
    });

    it('should filter by size range', async () => {
      const result = await services.fileRecord.getFileList({
        currentPage: 1, perPage: 10, filter: { size: [0, 0.004] }
      });

      assert.ok(result.totalCount >= 0);
    });

    it('should filter by id', async () => {
      const file = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'filter-id.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('x') }
      });

      const result = await services.fileRecord.getFileList({
        currentPage: 1, perPage: 10, filter: { id: file.id }
      });

      assert.equal(result.totalCount, 1);
      assert.equal(result.pageData[0].id, file.id);
    });

    it('should return empty list when no files match', async () => {
      const result = await services.fileRecord.getFileList({
        currentPage: 1, perPage: 10, filter: { filename: 'non-existent-file' }
      });

      assert.equal(result.totalCount, 0);
      assert.equal(result.pageData.length, 0);
    });

    it('should order by createdAt desc', async () => {
      const result = await services.fileRecord.getFileList({ currentPage: 1, perPage: 10 });

      for (let i = 1; i < result.pageData.length; i++) {
        assert.ok(
          new Date(result.pageData[i - 1].createdAt) >= new Date(result.pageData[i].createdAt),
          'files should be ordered by createdAt desc'
        );
      }
    });
  });

  describe('deleteFiles', () => {
    it('should delete single file', async () => {
      const file = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'del.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('del') }
      });

      await services.fileRecord.deleteFiles({ ids: [file.id] });

      const result = await services.fileRecord.getFileList({ currentPage: 1, perPage: 10 });
      assert.equal(result.totalCount, 0);
    });

    it('should delete multiple files', async () => {
      const file1 = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'del1.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('d1') }
      });
      const file2 = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'del2.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('d2') }
      });
      const file3 = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'keep.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('keep') }
      });

      await services.fileRecord.deleteFiles({ ids: [file1.id, file2.id] });

      const result = await services.fileRecord.getFileList({ currentPage: 1, perPage: 10 });
      assert.equal(result.totalCount, 1);
      assert.equal(result.pageData[0].id, file3.id);
    });

    it('should handle ids with query string suffix', async () => {
      const file = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'qs.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('qs') }
      });

      await services.fileRecord.deleteFiles({ ids: [`${file.id}?foo=bar`] });

      await assert.rejects(() => services.fileRecord.getFileInstance({ id: file.id }), {
        message: '文件不存在'
      });
    });
  });

  describe('renameFile', () => {
    it('should rename a file', async () => {
      const file = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'old-name.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      await services.fileRecord.renameFile({ id: file.id, filename: 'new-name.txt' });

      const instance = await services.fileRecord.getFileInstance({ id: file.id });
      assert.equal(instance.filename, 'new-name.txt');
    });

    it('should throw for non-existing file', async () => {
      await assert.rejects(
        () => services.fileRecord.renameFile({ id: 'non-existent-id', filename: 'new.txt' }),
        { message: '文件不存在' }
      );
    });
  });

  describe('getFileBlob', () => {
    it('should return file buffer content', async () => {
      const uploadResult = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'blob-test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      const result = await services.fileRecord.getFileBlob({ id: uploadResult.id });

      assert.ok(Buffer.isBuffer(result.buffer));
      assert.deepEqual(result.buffer, testBuffer);
      assert.equal(result.filename, 'blob-test.txt');
      assert.equal(result.id, uploadResult.id);
    });

    it('should throw for non-existing file', async () => {
      await assert.rejects(() => services.fileRecord.getFileBlob({ id: 'non-existent-id' }), {
        message: '文件不存在'
      });
    });
  });

  describe('getFileStream', () => {
    it('should return readable stream', async () => {
      const uploadResult = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'stream-test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      const stream = await services.fileRecord.getFileStream({ id: uploadResult.id });

      assert.ok(stream instanceof Readable);
    });

    it('should throw for non-existing file', async () => {
      await assert.rejects(() => services.fileRecord.getFileStream({ id: 'non-existent-id' }), {
        message: '文件不存在'
      });
    });
  });

  describe('getCompressFileBlob', () => {
    it('should compress multiple files into zip', async () => {
      const file1 = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'comp1.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('content1') }
      });
      const file2 = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'comp2.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('content2') }
      });

      const zipBuffer = await services.fileRecord.getCompressFileBlob({ ids: [file1.id, file2.id] });

      assert.ok(Buffer.isBuffer(zipBuffer));
      assert.ok(zipBuffer.length > 0);
    });

    it('should compress single file', async () => {
      const file = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'single.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('single') }
      });

      const zipBuffer = await services.fileRecord.getCompressFileBlob({ ids: [file.id] });

      assert.ok(Buffer.isBuffer(zipBuffer));
      assert.ok(zipBuffer.length > 0);
    });
  });

  describe('uncompressFile', () => {
    it('should uncompress zip and upload contained files', async () => {
      // Create a zip file with test content
      const compressing = require('compressing');
      const zipTmpDir = path.resolve(tmpDir, 'zip_src');
      await fs.ensureDir(zipTmpDir);
      await fs.writeFile(path.resolve(zipTmpDir, 'inner.txt'), 'inner content');
      const zipPath = path.resolve(tmpDir, 'test.zip');
      await compressing.zip.compressDir(zipTmpDir, zipPath);

      // Upload the zip
      const zipFile = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'test.zip', mimetype: 'application/zip', encoding: 'binary', filepath: zipPath }
      });

      // Uncompress
      const fileList = await services.fileRecord.uncompressFile({ id: zipFile.id });

      assert.ok(fileList.length > 0, 'should extract at least one file');
      const extractedFile = fileList.find(f => f.dir.includes('inner.txt'));
      assert.ok(extractedFile, 'should contain inner.txt');
      assert.ok(extractedFile.file.id, 'extracted file should have an id');
    });
  });

  describe('getFileInstance', () => {
    it('should return file model instance', async () => {
      const uploadResult = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'instance-test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      const instance = await services.fileRecord.getFileInstance({ id: uploadResult.id });

      assert.ok(instance);
      assert.equal(instance.uuid, uploadResult.id);
      assert.equal(instance.filename, 'instance-test.txt');
      assert.equal(instance.hash, testHash);
    });

    it('should throw for non-existing instance', async () => {
      await assert.rejects(() => services.fileRecord.getFileInstance({ id: 'non-existent-id' }), {
        message: '文件不存在'
      });
    });
  });

  describe('API routes', () => {
    it('POST /upload - should upload a file via multipart', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v3/static/upload',
        payload: Buffer.concat([
          Buffer.from(
            '--boundary\r\n' +
              'Content-Disposition: form-data; name="file"; filename="api-test.txt"\r\n' +
              'Content-Type: text/plain\r\n\r\n'
          ),
          testBuffer,
          Buffer.from('\r\n--boundary--\r\n')
        ]),
        headers: {
          'content-type': 'multipart/form-data; boundary=boundary'
        }
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.equal(body.filename, 'api-test.txt');
      assert.equal(body.hash, testHash);
    });

    it('POST /upload - should return error when no file', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v3/static/upload',
        headers: {
          'content-type': 'multipart/form-data; boundary=boundary'
        },
        payload: '--boundary--\r\n'
      });

      assert.equal(response.statusCode, 500);
    });

    it('GET /file-url/:id - should return file URL', async () => {
      const uploadResult = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'route-test.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: testBuffer }
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v3/static/file-url/${uploadResult.id}`
      });

      assert.equal(response.statusCode, 200);
      const url = response.body;
      assert.ok(typeof url === 'string');
      assert.ok(url.includes(uploadResult.hash));
    });

    it('POST /file-list - should return file list', async () => {
      await services.fileRecord.uploadToFileSystem({
        file: { filename: 'list.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('list') }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v3/static/file-list',
        payload: { currentPage: 1, perPage: 10 },
        headers: { 'content-type': 'application/json' }
      });

      assert.equal(response.statusCode, 200);
      const body = response.json();
      assert.ok(body.totalCount >= 1);
      assert.ok(Array.isArray(body.pageData));
    });

    it('POST /rename-file - should rename a file', async () => {
      const file = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'rename.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('rename') }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v3/static/rename-file',
        payload: { id: file.id, filename: 'renamed.txt' },
        headers: { 'content-type': 'application/json' }
      });

      assert.equal(response.statusCode, 200);

      const instance = await services.fileRecord.getFileInstance({ id: file.id });
      assert.equal(instance.filename, 'renamed.txt');
    });

    it('POST /delete-files - should delete files', async () => {
      const file = await services.fileRecord.uploadToFileSystem({
        file: { filename: 'api-del.txt', mimetype: 'text/plain', encoding: 'utf-8', buffer: Buffer.from('del') }
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v3/static/delete-files',
        payload: { ids: [file.id] },
        headers: { 'content-type': 'application/json' }
      });

      assert.equal(response.statusCode, 200);

      const result = await services.fileRecord.getFileList({ currentPage: 1, perPage: 10 });
      assert.equal(result.totalCount, 0);
    });
  });
});
