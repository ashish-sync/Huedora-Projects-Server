import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler, AppError, parsePagination, paginated } from '../../utils/helpers.js';
import { PERMISSIONS } from '../../config/constants.js';
import { writeAudit } from '../../utils/audit.js';
import { sendExcel } from '../../utils/excelExport.js';
import { cellValue, excelUpload, parseSheetRows } from '../../utils/masterExcel.js';
import { GeoCity, GeoDistrict, GeoPinCode, GeoState } from './geo.model.js';

const router = Router();
router.use(authenticate);

function publicRow(row) {
  if (!row) return null;
  const o = row.toObject ? row.toObject() : { ...row };
  return o;
}

/** GET /geo/meta — counts + source attribution */
router.get(
  '/meta',
  asyncHandler(async (_req, res) => {
    const [states, districts, cities, pinCodes] = await Promise.all([
      GeoState.countDocuments({ isDeleted: false, isActive: true }),
      GeoDistrict.countDocuments({ isDeleted: false, isActive: true }),
      GeoCity.countDocuments({ isDeleted: false, isActive: true }),
      GeoPinCode.countDocuments({ isDeleted: false, isActive: true }),
    ]);
    res.json({
      data: {
        country: 'IN',
        countryName: 'India',
        counts: { states, districts, cities, pinCodes },
        sources: [
          'dr5hn/countries-states-cities-database (states + cities)',
          'sab99r/Indian-States-And-Districts (districts; CSC has no district layer)',
          'PIN codes: local admin master (starts empty)',
        ],
      },
    });
  })
);

/** GET /geo/states */
router.get(
  '/states',
  asyncHandler(async (req, res) => {
    const filter = { isDeleted: false, isActive: true };
    if (req.query.q) filter.name = new RegExp(String(req.query.q), 'i');
    const rows = await GeoState.find(filter).sort('name').limit(100);
    res.json({ data: rows.map(publicRow) });
  })
);

/** GET /geo/districts?stateId= */
router.get(
  '/districts',
  asyncHandler(async (req, res) => {
    const stateId = String(req.query.stateId || '').trim();
    if (!stateId) throw new AppError('stateId is required', 400, 'VALIDATION_ERROR');
    const filter = { isDeleted: false, isActive: true, stateId };
    if (req.query.q) filter.name = new RegExp(String(req.query.q), 'i');
    const rows = await GeoDistrict.find(filter).sort('name').limit(500);
    res.json({ data: rows.map(publicRow) });
  })
);

/**
 * GET /geo/cities?stateId=&districtId=
 * When districtId is set: cities linked to that district, plus unassigned cities in the state
 * (so towns without a district mapping remain selectable).
 */
router.get(
  '/cities',
  asyncHandler(async (req, res) => {
    const stateId = String(req.query.stateId || '').trim();
    if (!stateId) throw new AppError('stateId is required', 400, 'VALIDATION_ERROR');
    const districtId = String(req.query.districtId || '').trim();
    const q = String(req.query.q || '').trim();

    let rows;
    if (districtId) {
      const allInState = await GeoCity.find({ isDeleted: false, isActive: true, stateId })
        .sort('name')
        .limit(5000);
      rows = allInState.filter(
        (c) =>
          String(c.districtId || '') === String(districtId) ||
          c.districtId == null ||
          c.districtId === ''
      );
    } else {
      rows = await GeoCity.find({ isDeleted: false, isActive: true, stateId }).sort('name').limit(5000);
    }

    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      rows = rows.filter((c) => re.test(c.name));
    }

    res.json({ data: rows.map(publicRow) });
  })
);

/** GET /geo/pin-codes?cityId=&stateId=&q=&pinCode= */
router.get(
  '/pin-codes',
  asyncHandler(async (req, res) => {
    const { page, limit, skip, sort } = parsePagination(req.query);
    const filter = { isDeleted: false };
    if (req.query.active !== 'false') filter.isActive = true;
    if (req.query.cityId) filter.cityId = String(req.query.cityId);
    if (req.query.districtId) filter.districtId = String(req.query.districtId);
    if (req.query.stateId) filter.stateId = String(req.query.stateId);
    if (req.query.pinCode) filter.pinCode = String(req.query.pinCode).trim();
    if (req.query.q) {
      const re = new RegExp(String(req.query.q), 'i');
      filter.$or = [{ pinCode: re }, { cityName: re }, { locality: re }, { stateName: re }];
    }
    const [data, total] = await Promise.all([
      GeoPinCode.find(filter)
        .sort(sort || 'pinCode')
        .skip(skip)
        .limit(limit),
      GeoPinCode.countDocuments(filter),
    ]);
    res.json(paginated(data.map(publicRow), total, page, limit));
  })
);

const PIN_HEADERS = ['PIN Code', 'State', 'District', 'City', 'Locality', 'Notes', 'Active'];

router.get(
  '/pin-codes/export',
  asyncHandler(async (_req, res) => {
    const rows = await GeoPinCode.find({ isDeleted: false }).sort('pinCode');
    sendExcel(
      res,
      'Geography_PIN_Codes.xlsx',
      PIN_HEADERS,
      rows.map((r) => [
        r.pinCode,
        r.stateName,
        r.districtName,
        r.cityName,
        r.locality,
        r.notes,
        r.isActive === false ? 'No' : 'Yes',
      ]),
      { sheetName: 'PIN Codes' }
    );
  })
);

router.get(
  '/pin-codes/sample',
  asyncHandler(async (_req, res) => {
    sendExcel(
      res,
      'Geography_PIN_Codes_Sample.xlsx',
      PIN_HEADERS,
      [
        ['400001', 'Maharashtra', 'Mumbai City', 'Mumbai', 'Fort', 'Sample mapping', 'Yes'],
        ['500081', 'Telangana', 'Hyderabad', 'Hyderabad', 'Madhapur', '', 'Yes'],
      ],
      { sheetName: 'PIN Codes' }
    );
  })
);

async function resolveGeoNames({ stateName, districtName, cityName }) {
  const state = await GeoState.findOne({
    isDeleted: false,
    name: new RegExp(`^${String(stateName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  });
  if (!state) throw new AppError(`State not found: ${stateName}`, 400, 'VALIDATION_ERROR');

  let district = null;
  if (districtName) {
    district = await GeoDistrict.findOne({
      isDeleted: false,
      stateId: state._id,
      name: new RegExp(`^${String(districtName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
    });
  }

  const cityFilter = { isDeleted: false, stateId: state._id };
  const city = await GeoCity.findOne({
    ...cityFilter,
    name: new RegExp(`^${String(cityName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
  });
  if (!city) throw new AppError(`City not found: ${cityName}`, 400, 'VALIDATION_ERROR');

  return resolvePinTargets({
    cityId: city._id,
    districtId: district?._id || city.districtId,
    stateId: state._id,
  });
}

router.post(
  '/pin-codes/import',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE, PERMISSIONS.USERS_WRITE, PERMISSIONS.ALL),
  excelUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new AppError('Excel file required', 400, 'VALIDATION_ERROR');
    const rows = parseSheetRows(req.file.buffer);
    const errors = [];
    let created = 0;
    let updated = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;
      try {
        const pinCode = String(cellValue(row, ['PIN Code', 'PIN', 'pinCode'])).replace(/\D+/g, '');
        if (!pinCode) continue;
        if (!/^\d{6}$/.test(pinCode)) {
          throw new AppError('PIN code must be 6 digits', 400, 'VALIDATION_ERROR');
        }
        const stateName = cellValue(row, ['State', 'stateName']);
        const cityName = cellValue(row, ['City', 'cityName']);
        if (!stateName || !cityName) {
          throw new AppError('State and City are required', 400, 'VALIDATION_ERROR');
        }
        const districtName = cellValue(row, ['District', 'districtName']);
        const locality = cellValue(row, ['Locality', 'locality']);
        const notes = cellValue(row, ['Notes', 'notes']);
        const activeRaw = cellValue(row, ['Active', 'isActive']);
        const isActive = !['no', 'false', '0', 'inactive'].includes(activeRaw.toLowerCase());

        const { city, district, state } = await resolveGeoNames({ stateName, districtName, cityName });
        const existing = await GeoPinCode.findOne({
          pinCode,
          cityId: city._id,
          isDeleted: false,
        });
        if (existing) {
          existing.locality = locality || existing.locality;
          existing.notes = notes || existing.notes;
          existing.isActive = isActive;
          existing.updatedBy = req.user._id;
          await existing.save();
          updated += 1;
        } else {
          await GeoPinCode.create({
            pinCode,
            cityId: city._id,
            cityName: city.name,
            districtId: district?._id || city.districtId || null,
            districtName: district?.name || '',
            stateId: state._id,
            stateName: state.name,
            locality,
            notes,
            isActive,
            createdBy: req.user._id,
            updatedBy: req.user._id,
          });
          created += 1;
        }
      } catch (err) {
        errors.push({ row: rowNum, field: 'import', message: err.message });
      }
    }

    res.json({
      data: {
        totalRows: rows.length,
        created,
        updated,
        errorRows: errors.length,
        errors: errors.slice(0, 200),
      },
    });
  })
);

/** GET /geo/pin-codes/lookup/:pin — local only */
router.get(
  '/pin-codes/lookup/:pin',
  asyncHandler(async (req, res) => {
    const pin = String(req.params.pin || '').replace(/\D+/g, '');
    if (pin.length !== 6) throw new AppError('PIN code must be 6 digits', 400, 'VALIDATION_ERROR');
    const rows = await GeoPinCode.find({ pinCode: pin, isDeleted: false, isActive: true }).limit(20);
    res.json({ data: rows.map(publicRow) });
  })
);

async function resolvePinTargets({ cityId, districtId, stateId }) {
  const city = cityId ? await GeoCity.findOne({ _id: cityId, isDeleted: false }) : null;
  if (cityId && !city) throw new AppError('City not found', 404);

  let district = null;
  const dId = districtId || city?.districtId;
  if (dId) {
    district = await GeoDistrict.findOne({ _id: dId, isDeleted: false });
  }

  let state = null;
  const sId = stateId || city?.stateId || district?.stateId;
  if (sId) {
    state = await GeoState.findOne({ _id: sId, isDeleted: false });
  }
  if (!state) throw new AppError('State is required for a PIN mapping', 400, 'VALIDATION_ERROR');
  if (!city) throw new AppError('City is required for a PIN mapping', 400, 'VALIDATION_ERROR');

  return { city, district, state };
}

router.post(
  '/pin-codes',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE, PERMISSIONS.USERS_WRITE, PERMISSIONS.ALL),
  asyncHandler(async (req, res) => {
    const pinCode = String(req.body.pinCode || '').replace(/\D+/g, '');
    if (!/^\d{6}$/.test(pinCode)) {
      throw new AppError('PIN code must be a 6-digit number', 400, 'VALIDATION_ERROR');
    }
    const { city, district, state } = await resolvePinTargets(req.body);

    const dup = await GeoPinCode.findOne({
      pinCode,
      cityId: city._id,
      isDeleted: false,
    });
    if (dup) throw new AppError('This PIN is already mapped to that city', 409, 'DUPLICATE_PIN');

    const row = await GeoPinCode.create({
      pinCode,
      cityId: city._id,
      cityName: city.name,
      districtId: district?._id || city.districtId || null,
      districtName: district?.name || '',
      stateId: state._id,
      stateName: state.name,
      locality: String(req.body.locality || '').trim(),
      notes: String(req.body.notes || '').trim(),
      isActive: req.body.isActive !== false,
      createdBy: req.user._id,
      updatedBy: req.user._id,
    });

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'GEO_PIN.CREATE',
      entityType: 'GeoPinCode',
      entityId: row._id,
      after: publicRow(row),
      requestId: req.requestId,
    });

    res.status(201).json({ data: publicRow(row) });
  })
);

router.patch(
  '/pin-codes/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE, PERMISSIONS.USERS_WRITE, PERMISSIONS.ALL),
  asyncHandler(async (req, res) => {
    const row = await GeoPinCode.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('PIN code mapping not found', 404);

    if (req.body.pinCode !== undefined) {
      const pinCode = String(req.body.pinCode || '').replace(/\D+/g, '');
      if (!/^\d{6}$/.test(pinCode)) {
        throw new AppError('PIN code must be a 6-digit number', 400, 'VALIDATION_ERROR');
      }
      row.pinCode = pinCode;
    }

    if (req.body.cityId || req.body.districtId || req.body.stateId) {
      const { city, district, state } = await resolvePinTargets({
        cityId: req.body.cityId || row.cityId,
        districtId: req.body.districtId || row.districtId,
        stateId: req.body.stateId || row.stateId,
      });
      row.cityId = city._id;
      row.cityName = city.name;
      row.districtId = district?._id || city.districtId || null;
      row.districtName = district?.name || '';
      row.stateId = state._id;
      row.stateName = state.name;
    }

    if (req.body.locality !== undefined) row.locality = String(req.body.locality || '').trim();
    if (req.body.notes !== undefined) row.notes = String(req.body.notes || '').trim();
    if (req.body.isActive !== undefined) row.isActive = Boolean(req.body.isActive);
    row.updatedBy = req.user._id;
    await row.save();

    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'GEO_PIN.UPDATE',
      entityType: 'GeoPinCode',
      entityId: row._id,
      after: publicRow(row),
      requestId: req.requestId,
    });

    res.json({ data: publicRow(row) });
  })
);

router.delete(
  '/pin-codes/:id',
  requirePermission(PERMISSIONS.AGREEMENTS_WRITE, PERMISSIONS.USERS_WRITE, PERMISSIONS.ALL),
  asyncHandler(async (req, res) => {
    const row = await GeoPinCode.findOne({ _id: req.params.id, isDeleted: false });
    if (!row) throw new AppError('PIN code mapping not found', 404);
    row.isDeleted = true;
    row.isActive = false;
    row.updatedBy = req.user._id;
    await row.save();
    await writeAudit({
      actorId: req.user._id,
      actorEmail: req.user.email,
      action: 'GEO_PIN.DELETE',
      entityType: 'GeoPinCode',
      entityId: row._id,
      requestId: req.requestId,
    });
    res.json({ data: { ok: true } });
  })
);

export default router;
