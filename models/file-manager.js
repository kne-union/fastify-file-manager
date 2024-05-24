module.exports = (sequelize, DataTypes) => {
  return sequelize.define('fileManager', {
    id: {
      type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true
    }, filename: {
      type: DataTypes.STRING, allowNull: false
    }, hash: {
      type: DataTypes.STRING, allowNull: false
    }, tag: {
      type: DataTypes.STRING, defaultValue: 'default'
    }, size: {
      type: DataTypes.INTEGER, allowNull: false
    }, encoding: DataTypes.STRING, mimetype: DataTypes.STRING
  });
};
