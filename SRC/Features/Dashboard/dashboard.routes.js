'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const dashboardController = require('./dashboard.controller');

const router = Router();

router.use(authMiddleware);

router.get('/overview', dashboardController.overview);
router.get('/insights', dashboardController.insights);
router.get('/insights/:adId', dashboardController.insightDetails);
router.get('/insights/:adId/media-playback', dashboardController.adMediaPlayback);
router.get('/insights/:adId/meta-breakdowns', dashboardController.adMetaBreakdowns);
router.get('/imported-campaigns', dashboardController.importedCampaigns);
router.get('/creative-formats', dashboardController.creativeFormats);
router.get('/external-sales/:platform', dashboardController.getExternalSalesStats);
router.get('/media-refresh/:mediaId', dashboardController.refreshMedia);

module.exports = router;
