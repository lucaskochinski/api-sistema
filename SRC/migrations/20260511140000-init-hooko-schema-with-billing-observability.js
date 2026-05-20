'use strict';

const { DataTypes } = require('sequelize');

/** Postgres JSONB singleton default helper */
function jsonEmpty() {
  return DataTypes.literal(`'{}'::jsonb`);
}

/** @param {import('sequelize').QueryInterface} queryInterface */
/** @param {typeof import('sequelize')} Sequelize */
module.exports = {
  async up(queryInterface, Sequelize) {
    const q = Sequelize;

    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    await queryInterface.createTable('organizations', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      name: { type: DataTypes.STRING(255), allowNull: false },
      slug: { type: DataTypes.STRING(120), allowNull: false },
      stripe_customer_id: { type: DataTypes.STRING(128), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex('organizations', ['slug'], {
      unique: true,
      name: 'organizations_slug_uidx',
    });
    await queryInterface.addIndex('organizations', ['stripe_customer_id'], {
      name: 'organizations_stripe_customer_id_idx',
    });

    await queryInterface.createTable('users', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      email: { type: DataTypes.STRING(320), allowNull: false },
      password_hash: { type: DataTypes.STRING(255), allowNull: true },
      auth_provider_subject: { type: DataTypes.STRING(255), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('users', ['email'], { unique: true, name: 'users_email_uidx' });

    await queryInterface.createTable('roles', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      key: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(128), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('roles', ['key'], { unique: true, name: 'roles_key_uidx' });

    await queryInterface.createTable('permissions', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      key: { type: DataTypes.STRING(128), allowNull: false },
      resource: { type: DataTypes.STRING(64), allowNull: false },
      action: { type: DataTypes.STRING(64), allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('permissions', ['key'], { unique: true, name: 'permissions_key_uidx' });
    await queryInterface.addIndex('permissions', ['resource', 'action'], {
      name: 'permissions_resource_action_idx',
    });

    await queryInterface.createTable('plans', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      tier_key: { type: DataTypes.STRING(64), allowNull: false },
      display_name: { type: DataTypes.STRING(128), allowNull: false },
      stripe_price_id: { type: DataTypes.STRING(128), allowNull: true },
      limits: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('plans', ['tier_key'], { unique: true, name: 'plans_tier_key_uidx' });
    await queryInterface.addIndex('plans', ['is_active'], { name: 'plans_is_active_idx' });

    await queryInterface.createTable('memberships', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('memberships', ['organization_id', 'user_id'], {
      unique: true,
      name: 'memberships_organization_user_uidx',
    });
    await queryInterface.addIndex('memberships', ['user_id'], {
      name: 'memberships_user_id_idx',
    });

    await queryInterface.createTable('role_permissions', {
      role_id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'roles', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      permission_id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'permissions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    });
    await queryInterface.addIndex('role_permissions', ['role_id'], {
      name: 'role_permissions_role_id_idx',
    });
    await queryInterface.addIndex('role_permissions', ['permission_id'], {
      name: 'role_permissions_permission_id_idx',
    });

    await queryInterface.createTable('membership_roles', {
      membership_id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'memberships', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      role_id: {
        type: DataTypes.UUID,
        allowNull: false,
        primaryKey: true,
        references: { model: 'roles', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
    });
    await queryInterface.addIndex('membership_roles', ['membership_id'], {
      name: 'membership_roles_membership_id_idx',
    });
    await queryInterface.addIndex('membership_roles', ['role_id'], {
      name: 'membership_roles_role_id_idx',
    });

    await queryInterface.createTable('integrations_meta', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      access_token_cipher: DataTypes.TEXT,
      refresh_token_cipher: DataTypes.TEXT,
      token_expires_at: DataTypes.DATE,
      oauth_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('integrations_meta', ['organization_id'], {
      unique: true,
      name: 'integrations_meta_organization_uidx',
    });
    await queryInterface.addIndex('integrations_meta', ['status'], {
      name: 'integrations_meta_status_idx',
    });

    await queryInterface.createTable('integrations_google_drive', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      refresh_token_cipher: DataTypes.TEXT,
      oauth_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'active' },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('integrations_google_drive', ['organization_id'], {
      unique: true,
      name: 'integrations_google_drive_organization_uidx',
    });

    await queryInterface.createTable('meta_ad_accounts', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      meta_act_id: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(255), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('meta_ad_accounts', ['organization_id', 'meta_act_id'], {
      unique: true,
      name: 'meta_ad_accounts_organization_act_uidx',
    });

    await queryInterface.createTable('campaigns', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      meta_ad_account_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'meta_ad_accounts', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      meta_campaign_id: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(512), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('campaigns', ['meta_ad_account_id', 'meta_campaign_id'], {
      unique: true,
      name: 'campaigns_account_campaign_uidx',
    });
    await queryInterface.addIndex('campaigns', ['organization_id'], {
      name: 'campaigns_organization_id_idx',
    });

    await queryInterface.createTable('ad_sets', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      campaign_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'campaigns', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      meta_adset_id: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(512), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ad_sets', ['organization_id', 'meta_adset_id'], {
      unique: true,
      name: 'ad_sets_organization_adset_uidx',
    });
    await queryInterface.addIndex('ad_sets', ['campaign_id'], { name: 'ad_sets_campaign_id_idx' });

    await queryInterface.createTable('ads', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      ad_set_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'ad_sets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      meta_ad_id: { type: DataTypes.STRING(64), allowNull: false },
      name: { type: DataTypes.STRING(512), allowNull: true },
      last_synced_at: DataTypes.DATE,
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('ads', ['organization_id', 'meta_ad_id'], {
      unique: true,
      name: 'ads_organization_meta_ad_uidx',
    });
    await queryInterface.addIndex('ads', ['ad_set_id'], { name: 'ads_ad_set_id_idx' });

    await queryInterface.createTable('media_assets', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      meta_video_id: { type: DataTypes.STRING(64), unique: true, allowNull: true },
      google_drive_file_id: { type: DataTypes.STRING(128), unique: true, allowNull: true },
      processing_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'ingest' },
      checksum: { type: DataTypes.STRING(128), allowNull: true },
      ingest_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('media_assets', ['processing_status'], {
      name: 'media_assets_processing_status_idx',
    });

    await queryInterface.createTable('organization_media_claims', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      media_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'media_assets', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      source: { type: DataTypes.STRING(64), allowNull: false, defaultValue: 'meta_sync' },
      claim_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('organization_media_claims', ['organization_id', 'media_id'], {
      unique: true,
      name: 'organization_media_claims_org_media_uidx',
    });
    await queryInterface.addIndex('organization_media_claims', ['media_id'], {
      name: 'organization_media_claims_media_id_idx',
    });

    await queryInterface.createTable('subscriptions', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      plan_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'plans', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      stripe_subscription_id: { type: DataTypes.STRING(128), allowNull: true },
      stripe_price_id_snapshot: { type: DataTypes.STRING(128), allowNull: true },
      stripe_latest_invoice_id: { type: DataTypes.STRING(128), allowNull: true },
      status: { type: DataTypes.STRING(48), allowNull: false, defaultValue: 'incomplete' },
      cancel_at_period_end: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
      current_period_start: DataTypes.DATE,
      current_period_end: DataTypes.DATE,
      trial_ends_at: DataTypes.DATE,
      cancel_at: DataTypes.DATE,
      canceled_at: DataTypes.DATE,
      paused_at: DataTypes.DATE,
      collection_paused_reason: DataTypes.TEXT,
      billing_metadata: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      raw_stripe_snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('subscriptions', ['stripe_subscription_id'], {
      unique: true,
      name: 'subscriptions_stripe_sub_uidx',
    });
    await queryInterface.addIndex('subscriptions', ['organization_id'], {
      name: 'subscriptions_organization_id_idx',
    });
    await queryInterface.addIndex('subscriptions', ['organization_id', 'status'], {
      name: 'subscriptions_organization_status_idx',
    });

    await queryInterface.createTable('invoices', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      subscription_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'subscriptions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      stripe_invoice_id: { type: DataTypes.STRING(128), allowNull: false },
      stripe_subscription_id_legacy: { type: DataTypes.STRING(128), allowNull: true },
      stripe_customer_id_legacy: { type: DataTypes.STRING(128), allowNull: true },
      invoice_number: { type: DataTypes.STRING(128), allowNull: true },
      status: { type: DataTypes.STRING(48), allowNull: false },
      billing_reason: { type: DataTypes.STRING(48), allowNull: true },
      collection_method: { type: DataTypes.STRING(32), allowNull: true },
      currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'usd' },
      amount_due_cents: { type: DataTypes.BIGINT, allowNull: false },
      amount_paid_cents: { type: DataTypes.BIGINT, allowNull: false, defaultValue: 0 },
      subtotal_cents: { type: DataTypes.BIGINT, allowNull: true },
      tax_cents: { type: DataTypes.BIGINT, allowNull: true },
      total_cents: { type: DataTypes.BIGINT, allowNull: true },
      stripe_attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      next_payment_attempt_at: DataTypes.DATE,
      period_start: DataTypes.DATE,
      period_end: DataTypes.DATE,
      due_date: DataTypes.DATEONLY,
      finalized_at: DataTypes.DATE,
      paid_at: DataTypes.DATE,
      voided_at: DataTypes.DATE,
      marked_uncollectible_at: DataTypes.DATE,
      hosted_invoice_url: DataTypes.TEXT,
      invoice_pdf: DataTypes.TEXT,
      last_charge_failure_code: { type: DataTypes.STRING(128), allowNull: true },
      last_charge_failure_message: DataTypes.TEXT,
      raw_stripe_snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('invoices', ['stripe_invoice_id'], {
      unique: true,
      name: 'invoices_stripe_invoice_id_uidx',
    });
    await queryInterface.addIndex('invoices', ['organization_id'], {
      name: 'invoices_organization_id_idx',
    });
    await queryInterface.addIndex('invoices', ['organization_id', 'status'], {
      name: 'invoices_organization_status_idx',
    });
    await queryInterface.addIndex('invoices', ['subscription_id'], {
      name: 'invoices_subscription_id_idx',
    });

    await queryInterface.createTable('webhook_event_logs', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      gateway: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'stripe' },
      gateway_event_id: { type: DataTypes.STRING(128), allowNull: false },
      event_type: { type: DataTypes.STRING(160), allowNull: false },
      gateway_api_version: { type: DataTypes.STRING(32), allowNull: true },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      stripe_signature_received: DataTypes.TEXT,
      headers_snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      payload_jsonb: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      processing_status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'received' },
      processing_attempt_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      last_error_detail: DataTypes.TEXT,
      processed_at: DataTypes.DATE,
      next_retry_after: DataTypes.DATE,
      replay_of_event_id: { type: DataTypes.UUID, allowNull: true },
      replay_note: DataTypes.TEXT,
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addConstraint('webhook_event_logs', {
      fields: ['gateway', 'gateway_event_id'],
      type: 'unique',
      name: 'webhook_event_logs_gateway_event_uidx',
    });


    await queryInterface.addIndex('webhook_event_logs', ['gateway', 'event_type'], {
      name: 'webhook_event_logs_gateway_event_type_idx',
    });
    await queryInterface.addIndex('webhook_event_logs', ['processing_status'], {
      name: 'webhook_event_logs_processing_status_idx',
    });
    await queryInterface.addIndex('webhook_event_logs', ['processed_at'], {
      name: 'webhook_event_logs_processed_at_idx',
    });
    await queryInterface.addIndex('webhook_event_logs', ['organization_id'], {
      name: 'webhook_event_logs_organization_id_idx',
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE webhook_event_logs
      ADD CONSTRAINT webhook_event_logs_replay_parent_fkey
      FOREIGN KEY (replay_of_event_id) REFERENCES webhook_event_logs(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
    `);

    await queryInterface.createTable('payment_transactions', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      subscription_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'subscriptions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      invoice_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'invoices', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      webhook_event_log_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: { model: 'webhook_event_logs', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      gateway: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'stripe' },
      gateway_object_id: { type: DataTypes.STRING(128), allowNull: false },
      object_type: { type: DataTypes.STRING(48), allowNull: false },
      status: { type: DataTypes.STRING(48), allowNull: false },
      amount_cents: { type: DataTypes.BIGINT, allowNull: true },
      currency: { type: DataTypes.STRING(3), allowNull: true },
      failure_code: { type: DataTypes.STRING(128), allowNull: true },
      failure_message: DataTypes.TEXT,
      gateway_balance_transaction_id: { type: DataTypes.STRING(128), allowNull: true },
      occurred_at: DataTypes.DATE,
      raw_summary: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addConstraint('payment_transactions', {
      fields: ['gateway', 'gateway_object_id'],
      type: 'unique',
      name: 'payment_transactions_gateway_object_uidx',
    });
    await queryInterface.addIndex('payment_transactions', ['organization_id'], {
      name: 'payment_transactions_organization_id_idx',
    });
    await queryInterface.addIndex('payment_transactions', ['invoice_id'], {
      name: 'payment_transactions_invoice_id_idx',
    });
    await queryInterface.addIndex('payment_transactions', ['subscription_id'], {
      name: 'payment_transactions_subscription_id_idx',
    });
    await queryInterface.addIndex('payment_transactions', ['occurred_at'], {
      name: 'payment_transactions_occurred_at_idx',
    });

    await queryInterface.createTable('creative_analyses', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      ad_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'ads', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      media_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'media_assets', key: 'id' },
        onDelete: 'RESTRICT',
        onUpdate: 'CASCADE',
      },
      ctr: { type: DataTypes.DECIMAL(24, 12), allowNull: true },
      roas: { type: DataTypes.DECIMAL(24, 8), allowNull: true },
      spend: { type: DataTypes.DECIMAL(24, 6), allowNull: true },
      performance_snapshot: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      ai_analysis: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      analyzed_at: { type: DataTypes.DATE, allowNull: false },
      period_key: { type: DataTypes.STRING(32), allowNull: true },
      analysis_version: { type: DataTypes.STRING(32), allowNull: true },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addIndex('creative_analyses', ['organization_id'], {
      name: 'creative_analyses_organization_id_idx',
    });
    await queryInterface.addIndex('creative_analyses', ['ad_id'], {
      name: 'creative_analyses_ad_id_idx',
    });
    await queryInterface.addIndex('creative_analyses', ['media_id'], {
      name: 'creative_analyses_media_id_idx',
    });
    await queryInterface.addIndex('creative_analyses', ['organization_id', 'analyzed_at'], {
      name: 'creative_analyses_org_analyzed_at_idx',
    });
    await queryInterface.addIndex('creative_analyses', ['organization_id', 'ad_id', 'analyzed_at'], {
      name: 'creative_analyses_org_ad_ts_idx',
    });

    await queryInterface.createTable('ad_performance_daily', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      ad_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'ads', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      snapshot_date: { type: DataTypes.DATEONLY, allowNull: false },
      metrics_jsonb: { type: DataTypes.JSONB, allowNull: false, defaultValue: jsonEmpty() },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });

    await queryInterface.addConstraint('ad_performance_daily', {
      fields: ['organization_id', 'ad_id', 'snapshot_date'],
      type: 'unique',
      name: 'ad_performance_daily_org_ad_day_uidx',
    });
    await queryInterface.addIndex('ad_performance_daily', ['organization_id'], {
      name: 'ad_performance_daily_organization_idx',
    });
    await queryInterface.addIndex('ad_performance_daily', ['snapshot_date'], {
      name: 'ad_performance_daily_snapshot_date_idx',
    });

    await queryInterface.createTable('usage_counters', {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        defaultValue: q.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      metric_key: { type: DataTypes.STRING(64), allowNull: false },
      period_label: { type: DataTypes.STRING(32), allowNull: false },
      value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_at: { type: DataTypes.DATE, allowNull: false },
      updated_at: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addConstraint('usage_counters', {
      fields: ['organization_id', 'metric_key', 'period_label'],
      type: 'unique',
      name: 'usage_counters_org_metric_period_uidx',
    });
  },

  async down(queryInterface) {
    const { sequelize } = queryInterface;
    await sequelize.query(`
DROP TABLE IF EXISTS payment_transactions CASCADE;
DROP TABLE IF EXISTS creative_analyses CASCADE;
DROP TABLE IF EXISTS ad_performance_daily CASCADE;
DROP TABLE IF EXISTS usage_counters CASCADE;
DROP TABLE IF EXISTS webhook_event_logs CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS organization_media_claims CASCADE;
DROP TABLE IF EXISTS media_assets CASCADE;
DROP TABLE IF EXISTS ads CASCADE;
DROP TABLE IF EXISTS ad_sets CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS meta_ad_accounts CASCADE;
DROP TABLE IF EXISTS integrations_google_drive CASCADE;
DROP TABLE IF EXISTS integrations_meta CASCADE;
DROP TABLE IF EXISTS membership_roles CASCADE;
DROP TABLE IF EXISTS role_permissions CASCADE;
DROP TABLE IF EXISTS memberships CASCADE;
DROP TABLE IF EXISTS permissions CASCADE;
DROP TABLE IF EXISTS roles CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS organizations CASCADE;
`);
  },
};
