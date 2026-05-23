'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ads = await queryInterface.describeTable('ads');
    if (!ads.vturb_video_id) {
      await queryInterface.addColumn('ads', 'vturb_video_id', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }

    const analyses = await queryInterface.describeTable('creative_analyses');
    if (!analyses.vturb_video_id) {
      await queryInterface.addColumn('creative_analyses', 'vturb_video_id', {
        type: Sequelize.STRING(255),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('creative_analyses', 'vturb_video_id');
    await queryInterface.removeColumn('ads', 'vturb_video_id');
  },
};
