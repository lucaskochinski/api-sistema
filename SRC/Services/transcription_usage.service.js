'use strict';

const db = require('../Models');
const planLimits = require('./plan_limits.service');

function transcriptionMinutesMetricKey() {
  return (
    process.env.USAGE_TRANSCRIPTION_MINUTES_MONTH_KEY ||
    'transcription_minutes_month'
  ).trim();
}

function monthlyPeriodLabelUtc(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

/**
 * Debita minutos transcritos contra `usage_counters`. Usa transactional lock por org+mês+métrica.
 * @param {string} organizationId
 * @param {number} minutesDelta — tipicamente `Math.max(1, Math.ceil(seconds/60))`
 * @param {{ email?: string, roles?: string[] } | null} [actingUser] —
 *   Bypass Super Admin (limites ∞) apenas quando o caller passar o JWT; workers usam `null`.
 */
async function consumeTranscriptionMinutes(
  organizationId,
  minutesDelta,
  actingUser = null,
) {
  const raw = Number(minutesDelta);
  const minutes = Math.max(0, Math.ceil(raw));
  if (minutes <= 0) return { charged: 0, usedAfter: null, limit: null };

  const { limits } = await planLimits.getResolvedLimitsForOrganization(
    organizationId,
    actingUser,
  );
  const limit = planLimits.transcriptionMinutesLimitFromResolved(limits);
  const metricKey = transcriptionMinutesMetricKey();
  const periodLabel = monthlyPeriodLabelUtc();

  if (limit === Number.POSITIVE_INFINITY) {
    return {
      charged: 0,
      usedAfter: null,
      limit,
      limitless: true,
    };
  }

  await db.sequelize.transaction(async (t) => {
    let row = await db.UsageCounter.findOne({
      transaction: t,
      lock: t.UPDATE,
      where: { organizationId, metricKey, periodLabel },
    });

    const usedBefore = row ? Number(row.value || 0) : 0;
    if (usedBefore + minutes > limit) {
      const err = new Error('transcription_minutes_quota_exceeded');
      err.statusCode = 429;
      err.quotaHint = {
        metricKey,
        periodLabel,
        used: usedBefore,
        limit,
        requestedMinutes: minutes,
      };
      throw err;
    }

    if (!row) {
      await db.UsageCounter.create(
        {
          organizationId,
          metricKey,
          periodLabel,
          value: minutes,
        },
        { transaction: t },
      );
    } else {
      await row.increment('value', { by: minutes, transaction: t });
    }
  });

  const after = await db.UsageCounter.findOne({
    where: { organizationId, metricKey, periodLabel },
  });
  return {
    charged: minutes,
    usedAfter: after ? Number(after.value) : minutes,
    limit,
  };
}

module.exports = {
  transcriptionMinutesMetricKey,
  monthlyPeriodLabelUtc,
  consumeTranscriptionMinutes,
};
