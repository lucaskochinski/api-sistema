'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const metaController = require('./meta.controller');

const router = Router();

router.get('/oauth/authorize-url', authMiddleware, metaController.oauthAuthorizeUrl);
router.get('/oauth/callback', metaController.oauthCallback);
router.post('/oauth/callback', metaController.oauthCallback);

module.exports = router;
