'use strict';

const { Router } = require('express');
const authController = require('./auth.controller');
const authMiddleware = require('../../Middlewares/auth.middleware');

const router = Router();

router.post('/login', authController.login);
router.post('/register', authController.register);
router.get('/me', authMiddleware, authController.me);

module.exports = router;
