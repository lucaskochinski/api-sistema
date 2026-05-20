'use strict';

const { Model } = require('sequelize');

/**
 * Log imutável (append-mostly) de webhooks Stripe/outros gateways para idempotência, replay forense
 * e reprocessamentos controlados quando jobs falharem.
 */
module.exports = (sequelize, DataTypes) => {
  class WebhookEventLog extends Model {
    static associate(models) {
      WebhookEventLog.belongsTo(models.Organization, {
        foreignKey: 'organizationId',
        as: 'organization',
      });
      WebhookEventLog.hasMany(models.PaymentTransaction, {
        foreignKey: 'webhookEventLogId',
        as: 'paymentTransactions',
      });
      WebhookEventLog.belongsTo(models.WebhookEventLog, {
        foreignKey: 'replayOfEventId',
        as: 'replayParent',
      });
      WebhookEventLog.hasMany(models.WebhookEventLog, {
        foreignKey: 'replayOfEventId',
        as: 'replayChildren',
      });
    }
  }

  WebhookEventLog.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      gateway: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'stripe',
      },
      gatewayEventId: {
        type: DataTypes.STRING(128),
        allowNull: false,
      },
      eventType: {
        type: DataTypes.STRING(160),
        allowNull: false,
      },
      gatewayApiVersion: {
        type: DataTypes.STRING(32),
        allowNull: true,
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: true,
      },
      stripeSignatureReceived: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      headersSnapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      payloadJson: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        field: 'payload_jsonb',
      },
      /** received | queued | processed | skipped | dead_letter | replayed */
      processingStatus: {
        type: DataTypes.STRING(32),
        allowNull: false,
        defaultValue: 'received',
        field: 'processing_status',
      },
      processingAttemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        field: 'processing_attempt_count',
      },
      lastErrorDetail: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      processedAt: { type: DataTypes.DATE, allowNull: true },
      nextRetryAfter: { type: DataTypes.DATE, allowNull: true },
      replayOfEventId: { type: DataTypes.UUID, allowNull: true },
      replayNote: { type: DataTypes.TEXT, allowNull: true },
    },
    {
      sequelize,
      modelName: 'WebhookEventLog',
      tableName: 'webhook_event_logs',
      underscored: true,
      indexes: [
        {
          unique: true,
          fields: ['gateway', 'gatewayEventId'],
          name: 'webhook_event_logs_gateway_event_uidx',
        },
        {
          fields: ['gateway', 'eventType'],
          name: 'webhook_event_logs_gateway_event_type_idx',
        },
        { fields: ['processingStatus'], name: 'webhook_event_logs_processing_status_idx' },
        { fields: ['processedAt'], name: 'webhook_event_logs_processed_at_idx' },
        { fields: ['organizationId'], name: 'webhook_event_logs_organization_id_idx' },
      ],
    },
  );

  return WebhookEventLog;
};
