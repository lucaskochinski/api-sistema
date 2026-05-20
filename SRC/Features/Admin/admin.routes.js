'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const { requireJwtRole } = require('../../Middlewares/role.middleware');

const adminFinanceController = require('./controllers/admin.finance.controller');
const adminSettingsController = require('./controllers/admin.settings.controller');
const adminMetricsController = require('./controllers/admin.metrics.controller');
const adminOrganizationsController = require('./controllers/admin.organizations.controller');
const adminUsersController = require('./controllers/admin.users.controller');

const router = Router();
const PLATFORM_ADMIN_ROLE = process.env.PLATFORM_ADMIN_JWT_ROLE_KEY || 'hooko_platform_admin';

router.use(authMiddleware);
router.use(requireJwtRole(PLATFORM_ADMIN_ROLE));

router.get('/finance/subscriptions', adminFinanceController.listSubscriptions);
router.get('/finance/invoices', adminFinanceController.listInvoices);
router.get('/finance/summary', adminFinanceController.financeSummary);
router.post('/plans', adminFinanceController.createPlan);

router.get('/settings', adminSettingsController.list);
router.put('/settings', adminSettingsController.put);

router.get('/metrics/overview', adminMetricsController.overview);
router.get('/metrics/webhooks', adminMetricsController.webhookHealth);

router.get('/organizations', adminOrganizationsController.list);
router.get('/organizations/:organizationId', adminOrganizationsController.getById);

router.get('/users', adminUsersController.list);
router.post('/users', adminUsersController.create);
router.get('/users/:userId', adminUsersController.getById);

module.exports = router;
