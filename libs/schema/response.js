// 响应 schema 会参与 fast-json-stringify 序列化：对象一律 additionalProperties: true 以免裁掉未声明字段；
// 用 nullable 而非类型数组（类型数组遇到不匹配的值会直接 500），类型不确定的字段（如 id、日期、JSON 列）只写说明不声明类型
const str = description => ({ type: 'string', nullable: true, description });
const num = description => ({ type: 'number', nullable: true, description });
const any = description => ({ description });
const list = (description, items) => ({ type: 'array', nullable: true, description, items });
const obj = (description, properties = {}) => ({ type: 'object', nullable: true, description, additionalProperties: true, properties });

const success = (description, schema) => ({
  200: Object.assign({}, schema || { type: 'object' }, { description })
});

const empty = (description = '操作成功，返回空对象') => success(description);

const fileRecordProperties = {
  id: any('文件 ID（即 uuid），用于 file-url / file-id 等接口'),
  uuid: any('文件 uuid'),
  filename: str('文件名（已替换非法字符）'),
  hash: str('文件内容 md5，存储文件名为 {hash}{扩展名}'),
  namespace: str('文件分类命名空间'),
  size: num('文件大小（字节）'),
  encoding: str('上传编码'),
  mimetype: str('文件 MIME 类型'),
  storageType: str('存储类型：local 本地文件系统，oss 远程 OSS 存储'),
  options: any('扩展字段（JSON）'),
  createdAt: any('创建时间'),
  updatedAt: any('更新时间'),
  deletedAt: any('删除时间，未删除为 null')
};

const fileRecord = obj('文件记录', fileRecordProperties);

const folderNodeProperties = {
  id: any('节点 ID'),
  tenantId: any('租户 ID'),
  type: str('业务域类型'),
  code: str('节点编码'),
  name: str('节点名称（文件节点为显示文件名）'),
  language: str('语言'),
  description: str('描述'),
  index: num('排序'),
  parentId: any('父文件夹节点 ID，根目录为 null'),
  options: any('节点扩展信息（JSON）：kind 节点类型 file/folder；文件节点含 fileId（文件 uuid）、size、mimetype、filename，linked 为 true 表示引用文件库已有文件（删除节点不删文件实体）'),
  createdAt: any('创建时间（文件节点在树/列表中取文件记录的时间）'),
  updatedAt: any('更新时间（文件节点在树/列表中取文件记录的时间）'),
  deletedAt: any('删除时间，未删除为 null')
};

const folderNode = obj('文件夹树节点', folderNodeProperties);

const folderTreeNode = obj('文件夹树节点', Object.assign({}, folderNodeProperties, { children: list('子节点列表，结构同本节点', obj('子节点')) }));

module.exports = { str, num, any, list, obj, success, empty, fileRecordProperties, fileRecord, folderNodeProperties, folderNode, folderTreeNode };
