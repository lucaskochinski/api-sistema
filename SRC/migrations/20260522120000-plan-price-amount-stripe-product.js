'use strict';

/** Valor comercial local + referência ao produto Stripe (preço criado via API). */

/** @param {import('sequelize').QueryInterface} queryInterface */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;

    await queryInterface.addColumn('plans', 'price_amount_cents', {
      type: DataTypes.INTEGER,
      allowNull: true,
    });

    await queryInterface.addColumn('plans', 'price_currency', {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'brl',
    });

    await queryInterface.addColumn('plans', 'stripe_product_id', {
      type: DataTypes.STRING(128),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('plans', 'stripe_product_id');
    await queryInterface.removeColumn('plans', 'price_currency');
    await queryInterface.removeColumn('plans', 'price_amount_cents');
  },
};
