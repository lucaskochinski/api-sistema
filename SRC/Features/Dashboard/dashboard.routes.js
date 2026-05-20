'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const dashboardController = require('./dashboard.controller');

const router = Router();

router.use(authMiddleware);

router.get('/overview', dashboardController.overview);
router.get('/insights', dashboardController.insights);
router.get('/imported-campaigns', dashboardController.importedCampaigns);
router.get('/external-sales/:platform', dashboardController.getExternalSalesStats);
router.get('/media-refresh/:mediaId', dashboardController.refreshMedia);

module.exports = router;
