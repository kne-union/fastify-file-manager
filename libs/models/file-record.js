module.exports = (sequelize, DataTypes) => {
  return sequelize.define(
    'fileRecord',
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
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
      mimetype: DataTypes.STRING
    },
    {
      indexes: [
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
  );
};
