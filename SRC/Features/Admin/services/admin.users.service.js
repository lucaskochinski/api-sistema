'use strict';

const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const db = require('../../../Models');

const BCRYPT_COST = Number(process.env.BCRYPT_SALT_ROUNDS || 12);

const UUID_RE_ADMIN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeManagedEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function listUsers({ limit, offset, search }) {
  const whereUser = {};
  if (search) {
    whereUser.email = { [db.Sequelize.Op.iLike]: `%${search}%` };
  }

  return db.User.findAndCountAll({
    where: whereUser,
    limit,
    offset,
    order: [['createdAt', 'DESC']],
    attributes: ['id', 'email', 'authProviderSubject', 'createdAt'],
    include: [
      {
        model: db.Membership,
        as: 'memberships',
        required: false,
        attributes: ['id', 'organizationId', 'status', 'createdAt'],
        include: [
          {
            model: db.Role,
            as: 'roles',
            through: { attributes: [] },
          },
          {
            model: db.Organization,
            as: 'organization',
            attributes: ['id', 'name', 'slug'],
            required: false,
          },
        ],
      },
    ],
  });
}

async function getUserById(userId) {
  return db.User.scope(null).findByPk(userId, {
    attributes: ['id', 'email', 'authProviderSubject', 'createdAt'],
    include: [
      {
        model: db.Membership,
        as: 'memberships',
        required: false,
        attributes: ['id', 'organizationId', 'status'],
        include: [
          {
            model: db.Role,
            as: 'roles',
            through: { attributes: [] },
          },
          {
            model: db.Organization,
            as: 'organization',
            attributes: ['id', 'name', 'slug'],
            required: false,
          },
        ],
      },
    ],
  });
}

/**
 * Provisiona usuário (novo ou existente pelo e-mail), membership única por org e conjunto atual de papéis.
 * @param {'active'|'invited'|'suspended'} [membershipStatus]
 */
async function createManagedUser({
  email: rawEmail,
  password,
  organizationId,
  roleKeys,
  membershipStatus,
}) {
  const normalizedEmail = normalizeManagedEmail(rawEmail);
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    const err = new Error('invalid_email');
    err.statusCode = 400;
    throw err;
  }

  const orgUuid = organizationId ? String(organizationId).trim() : '';
  if (!orgUuid || !UUID_RE_ADMIN.test(orgUuid)) {
    const err = new Error('invalid_organization');
    err.statusCode = 400;
    throw err;
  }

  /** @type {unknown[]} */
  const incoming = [];
  if (Array.isArray(roleKeys)) {
    incoming.push(...roleKeys);
  } else if (roleKeys != null && `${roleKeys}`.trim()) {
    incoming.push(...String(roleKeys).split(/[\s,]+/).filter(Boolean));
  }

  /** @type {string[]} */
  const uniqRoleKeys = [
    ...new Set(incoming.map((k) => String(k || '').trim()).filter(Boolean)),
  ];
  if (uniqRoleKeys.length === 0) {
    const err = new Error('role_keys_required');
    err.statusCode = 400;
    throw err;
  }

  const status =
    membershipStatus && String(membershipStatus).trim()
      ? String(membershipStatus).trim().toLowerCase()
      : 'active';
  if (!['invited', 'active', 'suspended'].includes(status)) {
    const err = new Error('invalid_membership_status');
    err.statusCode = 400;
    throw err;
  }

  const org = await db.Organization.findByPk(orgUuid, { attributes: ['id'] });
  if (!org) {
    const err = new Error('organization_not_found');
    err.statusCode = 404;
    throw err;
  }

  /** @returns {Promise<string>} UUID do usuário alvo */
  let createdUserId;
  await db.sequelize.transaction(async (transaction) => {
    const rolesFound = await db.Role.findAll({
      where: { key: { [Op.in]: uniqRoleKeys } },
      transaction,
    });
    if (rolesFound.length !== uniqRoleKeys.length) {
      const err = new Error('unknown_or_invalid_role_key');
      err.statusCode = 422;
      throw err;
    }

    let userRow = await db.User.scope(null).findOne({
      where: { email: normalizedEmail },
      transaction,
    });

    if (!userRow) {
      if (!password || String(password).length < 8) {
        const err = new Error('password_min_length_8');
        err.statusCode = 400;
        throw err;
      }
      const passwordHash = await bcrypt.hash(String(password), BCRYPT_COST);
      userRow = await db.User.create(
        {
          email: normalizedEmail,
          passwordHash,
        },
        { transaction },
      );
    } else if (password && String(password).length >= 8) {
      const passwordHash = await bcrypt.hash(String(password), BCRYPT_COST);
      await userRow.update({ passwordHash }, { transaction });
    }

    /** @type {import('sequelize').Model|null} */
    let membershipRow = await db.Membership.findOne({
      where: { organizationId: orgUuid, userId: userRow.id },
      transaction,
    });

    membershipRow ||= await db.Membership.create(
      {
        organizationId: orgUuid,
        userId: userRow.id,
        status,
      },
      { transaction },
    );

    await membershipRow.update({ status }, { transaction });

    await db.MembershipRole.destroy({
      where: { membershipId: membershipRow.id },
      transaction,
    });

    const mrRows =
      rolesFound.map((roleModel) => ({
        membershipId: membershipRow.id,
        roleId: roleModel.id,
      }));

    await db.MembershipRole.bulkCreate(mrRows, { transaction });

    createdUserId = String(userRow.id);
  });

  return getUserById(createdUserId);
}

module.exports = {
  listUsers,
  getUserById,
  createManagedUser,
};
