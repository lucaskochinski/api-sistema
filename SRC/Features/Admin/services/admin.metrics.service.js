'use strict';

const db = require('../../../Models');
const Sequelize = require('sequelize');

async function getPlatformOverview() {
  const [
    organizationCount,
    userCount,
    creativeAnalysisCount,
    processedVideos,
    membershipsActive,
    usageTotals,
  ] = await Promise.all([
    db.Organization.count(),
    db.User.count(),
    db.CreativeAnalysis.count(),
    db.MediaAsset.count({
      where: {
        processingStatus: { [db.Sequelize.Op.in]: ['processed', 'queued_video', 'transcribing'] },
      },
    }),
    db.Membership.count({ where: { status: 'active' } }),
    db.sequelize
      .query(
        `SELECT metric_key AS "metricKey", COALESCE(SUM(value), 0)::text AS total
         FROM usage_counters
         GROUP BY metric_key`,
        { type: Sequelize.QueryTypes.SELECT },
      )
      .catch(() => []),
  ]);

  /** Vídeos finalizados só */
  const fullyProcessedVideos = await db.MediaAsset.count({
    where: { processingStatus: 'processed' },
  }).catch(() => 0);

  return {
    organizations: organizationCount,
    users: userCount,
    activeMemberships: membershipsActive,
    creativeAnalysesTotal: creativeAnalysisCount,
    videosInPipelineOrProcessed: processedVideos,
    videosFullyProcessed: fullyProcessedVideos,
    usageCountersByMetric: usageTotals.map((row) => ({
      metricKey: row.metricKey,
      total:
        typeof row.total === 'bigint'
          ? row.total.toString()
          : typeof row.total === 'string'
            ? row.total
            : String(row.total || 0),
    })),
  };
}

async function webhookHealthSnapshot({ limit }) {
  const cap = Math.min(50, Math.max(5, Number(limit) || 10));
  const recentFailures = await db.WebhookEventLog.findAll({
    where: {
      processingStatus: { [db.Sequelize.Op.in]: ['dead_letter', 'queued'] },
    },
    order: [['updatedAt', 'DESC']],
    limit: cap,
    attributes: ['id', 'processingStatus', 'createdAt', 'updatedAt', 'gateway', 'eventType'],
  }).catch(() => []);

  const failureBuckets = await db.sequelize.query(
    `SELECT processing_status AS "processingStatus", COUNT(*)::int AS count FROM webhook_event_logs GROUP BY processing_status`,
    { type: Sequelize.QueryTypes.SELECT },
  );

  return {
    recentProblematicWebhookRows: recentFailures,
    webhookStatusBuckets: failureBuckets || [],
  };
}

module.exports = {
  getPlatformOverview,
  webhookHealthSnapshot,
};
