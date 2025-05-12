const fp = require('fastify-plugin');

module.exports = fp(async (fastify, options) => {
    const {services} = fastify.fileManager;
    fastify.post(`${options.prefix}/upload`, {
        onRequest: options.createAuthenticate('file:write'), schema: {
            summary: '上传文件', description: '上传单个文件到服务器或配置的存储服务', query: {
                type: 'object', properties: {
                    namespace: {type: 'string', description: '文件分类命名空间'}
                }
            }
        }
    }, async request => {
        const file = await request.file();
        if (!file) {
            throw new Error('不能获取到上传文件');
        }
        //1. 保存到服务器目录 2.对接oss
        return await services.fileRecord.uploadToFileSystem({
            file, namespace: request.query.namespace || options.namespace
        });
    });

    fastify.get(`${options.prefix}/file-url/:id`, {
        onRequest: options.createAuthenticate('file:read'), schema: {
            summary: '获取文件url', description: '获取文件url', params: {
                type: 'object', required: ['id'], properties: {
                    id: {type: 'string', description: '文件id'}
                }
            }
        }
    }, async request => {
        const {id} = request.params;
        return await services.fileRecord.getFileUrl({id});
    });

    fastify.get(`${options.prefix}/file-id/:id`, {
        onRequest: options.createAuthenticate('file:read'), schema: {
            summary: '获取文件信息', description: '获取文件信息', query: {
                type: 'object', properties: {
                    attachment: {type: 'boolean', description: '是否下载'},
                    filename: {type: 'string', description: '下载文件名'}
                }
            }, params: {
                type: 'object', required: ['id'], properties: {
                    id: {type: 'string', description: '文件id'}
                }
            }
        }
    }, async (request, reply) => {
        const {id} = request.params;
        const {attachment, filename: targetFilename} = request.query;
        const {filePath, targetFile, filename, mimetype, ...props} = await services.fileRecord.getFileInfo({
            id
        });
        if (targetFile) {
            const outputFilename = encodeURIComponent(targetFilename || filename);
            reply.header('Content-Type', mimetype);
            reply.header('Content-Disposition', attachment ? `attachment; filename="${outputFilename}"` : `filename="${outputFilename}"`);
            return reply.send(targetFile);
        }
        return attachment ? reply.download(filePath, targetFilename || filename) : reply.sendFile(filePath);
    });

    fastify.post(`${options.prefix}/file-list`, {
        onRequest: options.createAuthenticate('file:mange'), schema: {
            summary: '获取文件列表', description: '查询指定命名空间下的文件列表', body: {
                type: 'object', properties: {
                    perPage: {type: 'number', description: '每页数量'},
                    currentPage: {type: 'number', description: '当前页数'},
                    filter: {
                        type: 'object', properties: {
                            namespace: {type: 'string', description: '文件分类命名空间'},
                            size: {type: 'array', items: {type: 'number'}, description: '文件大小'},
                            filename: {type: 'string', description: '文件名'}
                        }
                    }
                }
            }
        }
    }, async request => {
        const {filter, perPage, currentPage} = Object.assign({}, {
            perPage: 20, currentPage: 1
        }, request.body);
        return await services.fileRecord.getFileList({
            filter, perPage, currentPage
        });
    });

    // Replace file

    fastify.post(`${options.prefix}/replace-file`, {
        onRequest: options.createAuthenticate('file:mange'), schema: {
            summary: '替换文件', description: '替换文件', query: {
                type: 'object', properties: {
                    id: {type: 'string', description: '文件id'},
                }
            }
        }
    }, async request => {
        const file = await request.file();
        if (!file) {
            throw new Error('不能获取到上传文件');
        }
        return await services.fileRecord.uploadToFileSystem({id: request.query.id, file});
    });

    fastify.post(`${options.prefix}/rename-file`, {
        onRequest: options.createAuthenticate('file:mange'), schema: {
            summary: '重命名文件', description: '重命名文件', body: {
                type: 'object', properties: {
                    id: {type: 'string', description: '文件id'}, filename: {type: 'string', description: '新文件名'}
                }
            }
        }
    }, async request => {
        await services.fileRecord.renameFile(request.body);
        return {};
    });

    fastify.post(`${options.prefix}/delete-files`, {
        onRequest: options.createAuthenticate('file:mange'), schema: {
            summary: '删除文件', description: '删除文件', body: {
                type: 'object', required: ['ids'], properties: {
                    ids: {type: 'array', items: {type: 'string'}, description: '文件id列表'}
                }
            }
        }
    }, async request => {
        const {ids} = request.body;
        await services.fileRecord.deleteFiles({ids});
        return {};
    });
});
