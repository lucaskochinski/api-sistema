'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const metasyncController = require('./metasync.controller');

const router = Router();

router.use(authMiddleware);

router.get('/account/:metaActId/live-campaigns', metasyncController.listLiveCampaigns);

router.get(
  '/account/:metaActId/campaign/:metaCampaignId/live-ads',
  metasyncController.listLiveAdsByCampaign,
);

router.post(
  '/account/:metaActId/campaign/:metaCampaignId/ad/:metaAdId/import',
  metasyncController.importAd,
);

module.exports = router;
