'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const googledriveController = require('./googledrive.controller');

const router = Router();

router.get('/oauth/authorize-url', authMiddleware, googledriveController.oauthAuthorizeUrl);
router.get('/oauth/callback', googledriveController.oauthCallback);
router.post('/oauth/callback', googledriveController.oauthCallback);

module.exports = router;
