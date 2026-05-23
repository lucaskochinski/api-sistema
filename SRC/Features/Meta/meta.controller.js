'use strict';

const oauthState = require('../../Utils/oauth_state');
const { ensureActiveJwtMembership } = require('../../Utils/ensure_organization_membership.util');
const metaService = require('./meta.service');

const UUID_V4ISH =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertOrganizationUuid(organizationId) {
  if (!organizationId || !UUID_V4ISH.test(String(organizationId))) {
    const err = new Error('invalid_organization_id');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * POST / GET — corpo opcional permite testes sem navegador; produção usará redirect GET provider.
 */

async function oauthAuthorizeUrl(req, res, next) {
  try {
    assertOrganizationUuid(req.query.organizationId);
    ensureActiveJwtMembership(req, req.query.organizationId);
    const state = oauthState.encodeOrganizationState(req.query.organizationId);
    const authorizeUrl = metaService.buildAuthorizeUrl(state);
    /** Nunca retornamos tokens nem state em separado redundante */

    res.json({ authorizeUrl });
  } catch (error) {
    next(error);
  }
}

async function oauthCallback(req, res, next) {
  try {
    if (req.query.error || req.body?.error) {
      const err = new Error('meta_oauth_provider_error');
      err.statusCode = 400;
      throw err;
    }
    const code = req.query.code ?? req.body?.code;
    if (!code) {
      const err = new Error('missing_authorization_code');
      err.statusCode = 400;
      throw err;
    }
    let organizationId;
    if (req.query.state) {
      organizationId = oauthState.decodeOrganizationState(req.query.state).organizationId;
    } else if (req.body?.organizationId) {
      organizationId = req.body.organizationId;
    } else {
      const err = new Error('missing_oauth_state_or_organization');
      err.statusCode = 400;
      throw err;
    }
    assertOrganizationUuid(organizationId);
    await metaService.exchangeCodeAndPersistTokens(organizationId, String(code));

    /** Resposta mínima (sem dados sensíveis) */

    res.json({ status: 'connected', integration: 'meta_ads', organizationId });
  } catch (error) {
    next(error);
  }
}

async function getStatus(req, res, next) {
  try {
    assertOrganizationUuid(req.query.organizationId);
    ensureActiveJwtMembership(req, req.query.organizationId);

    const integrationConfig = require('../../Services/integration_config.service');
    const systemToken =
      integrationConfig.get('meta_system_access_token') || process.env.META_SYSTEM_ACCESS_TOKEN || '';
    if (systemToken) {
      return res.json({ connected: true, isSystemToken: true });
    }

    const { IntegrationsMeta } = require('../../Models');
    const integration = await IntegrationsMeta.findOne({
      where: { organizationId: req.query.organizationId, status: 'active' },
    });

    res.json({ connected: !!integration });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  oauthAuthorizeUrl,
  oauthCallback,
  getStatus,
};

