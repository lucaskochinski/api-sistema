'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      'integrations_google_drive',
      'access_token_cipher',
      Sequelize.TEXT,
    );
    await queryInterface.addColumn(
      'integrations_google_drive',
      'token_expires_at',
      Sequelize.DATE,
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('integrations_google_drive', 'access_token_cipher');
    await queryInterface.removeColumn('integrations_google_drive', 'token_expires_at');
  },
};
