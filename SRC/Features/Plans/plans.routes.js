'use strict';

const { Router } = require('express');
const plansController = require('./plans.controller');

const router = Router();

router.get('/public', plansController.listPublic);

module.exports = router;
