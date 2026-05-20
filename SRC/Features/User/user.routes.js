'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const userController = require('./user.controller');

const router = Router();

router.use(authMiddleware);

router.get('/', userController.listUsers);
router.get('/_meta/stats', userController.healthSanity);

module.exports = router;
