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
      mimetype: DataTypes.STRING
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
