'use strict';

/** Valor comercial local + referência ao produto Stripe (preço criado via API). */

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const plansInfo = await queryInterface.describeTable('plans').catch(() => ({}));

    if (!plansInfo.price_amount_cents) {
      await queryInterface.addColumn('plans', 'price_amount_cents', {
        type: DataTypes.INTEGER,
        allowNull: true,
      });
    }

    if (!plansInfo.price_currency) {
      await queryInterface.addColumn('plans', 'price_currency', {
        type: DataTypes.STRING(3),
        allowNull: false,
        defaultValue: 'brl',
      });
    }

    if (!plansInfo.stripe_product_id) {
      await queryInterface.addColumn('plans', 'stripe_product_id', {
        type: DataTypes.STRING(128),
        allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('plans', 'stripe_product_id').catch(() => {});
    await queryInterface.removeColumn('plans', 'price_currency').catch(() => {});
    await queryInterface.removeColumn('plans', 'price_amount_cents').catch(() => {});
  },
};
