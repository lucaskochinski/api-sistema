'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const billingController = require('./billing.controller');

const router = Router();

router.use(authMiddleware);

router.post('/checkout', billingController.checkout);
router.post('/portal', billingController.portal);

module.exports = router;
