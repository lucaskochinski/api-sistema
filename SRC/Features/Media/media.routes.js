'use strict';

const { Router } = require('express');
const authMiddleware = require('../../Middlewares/auth.middleware');
const mediaController = require('./media.controller');

const router = Router();

router.use(authMiddleware);

router.post('/:mediaId/analyze', mediaController.analyzeMediaAsync);

module.exports = router;
