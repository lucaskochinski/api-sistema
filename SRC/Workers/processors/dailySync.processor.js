'use strict';

const db = require('../../Models');
const metasync = require('../../Features/MetaSync/metasync.service');

function utcYesterdayYmd() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Reprocessa apenas o **dia anterior (UTC)** em `ad_performance_daily` usando a Graph —
 * não consome quotas de campanhas do usuário.
 */
module.exports = async function dailySyncProcessor(/* job */) {
  const sinceUntil = utcYesterdayYmd();

  const ads = await db.Ad.findAll({
    attributes: ['id', 'organizationId'],
    include: [
      {
        model: db.AdSet,
        as: 'adSet',
        attributes: [],
        required: true,
        include: [
          {
            model: db.Campaign,
            as: 'campaign',
            attributes: ['id'],
            required: true,
          },
        ],
      },
    ],
  });

  let ok = 0;
  let failures = 0;

  /** Sequencial intencional (rate‑limit Meta) */
  for (const adRow of ads) {
    try {
      await metasync.syncDailyPerformanceInternal(
        String(adRow.organizationId),
        adRow.id,
        sinceUntil,
        sinceUntil,
      );
      ok += 1;
    } catch (e) {
      failures += 1;
      console.warn('[daily_sync] falha insights', {
        adId: adRow.id,
        org: adRow.organizationId,
        message: e?.message || String(e),
      });
    }
  }

  return {
    snapshotDateUtc: sinceUntil,
    adsConsidered: ads.length,
    success: ok,
    failures,
  };
};
