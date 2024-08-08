module.exports = ({ DataTypes }) => {
  return {
    model: {
      uuid: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4
      },
      filename: {
        type: DataTypes.STRING,
        allowNull: false
      },
      hash: {
        type: DataTypes.STRING,
        allowNull: false
      },
      namespace: {
        type: DataTypes.STRING,
        defaultValue: 'default'
      },
      size: {
        type: DataTypes.INTEGER,
        allowNull: false
      },
      encoding: DataTypes.STRING,
      mimetype: DataTypes.STRING,
      storageType: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: '存储类型:local本地文件系统,oss远程oss存储'
      }
    },
    options: {
      indexes: [
        {
          unique: true,
          fields: ['uuid', 'deleted_at']
        },
        {
          fields: ['namespace']
        },
        {
          fields: ['filename']
        },
        {
          fields: ['hash']
        }
      ]
    }
  };
};
