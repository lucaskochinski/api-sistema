'use strict';

const { Router } = require('express');
const userRoutes = require('../Features/User/user.routes');
const metaRoutes = require('../Features/Meta/meta.routes');
const googleDriveRoutes = require('../Features/GoogleDrive/googledrive.routes');
const mediaRoutes = require('../Features/Media/media.routes');
const authRoutes = require('../Features/Auth/auth.routes');
const adminRoutes = require('../Features/Admin/admin.routes');
const metasyncRoutes = require('../Features/MetaSync/metasync.routes');
const dashboardRoutes = require('../Features/Dashboard/dashboard.routes');
const billingRoutes = require('../Features/Billing/billing.routes');
const plansRoutes = require('../Features/Plans/plans.routes');

/** Agrega rotas versionáveis sob `/api` */
const router = Router();

router.use('/users', userRoutes);
router.use('/meta', metaRoutes);
router.use('/metasync', metasyncRoutes);
router.use('/google-drive', googleDriveRoutes);
router.use('/media', mediaRoutes);
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/plans', plansRoutes);
router.use('/billing', billingRoutes);
router.use('/admin', adminRoutes);

module.exports = router;
