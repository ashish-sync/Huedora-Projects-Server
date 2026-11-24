import { User } from '../users/user.model.js';
import { DeviceMaster } from '../devices/device.model.js';
import { LogisticsProduct } from '../logistics/logistics.model.js';
import { Agreement, AgreementAsset, AgreementActivity } from '../agreements/agreement.model.js';
import { ensureDocumentOneDemo, DOCUMENT_ONE_DEMO } from '../agreements/documentOne.seed.js';
import { captureAgreementAssetSnapshot } from '../agreements/agreementAssetSnapshot.js';
import { createAsset } from './asset.service.js';
import { Asset } from './asset.model.js';
import { AssetEvent } from './assetEvent.model.js';
import { agreementHasStoredDocument } from './assetAgreementDocument.js';

export const ASSET_ONE_DEMO = {
  serialNumber: 'DEMO-DOC1-SN-001',
  name: 'Demo Asset — Document One Lease',
  productCode: 'DEMO-MD-DOC1',
  productName: 'Demo Medical Device (Document One)',
  marker: 'asset-one-document-demo-v1',
};

async function resolveDemoActor() {
  return (
    (await User.findOne({ email: 'admin@tylo.local', isDeleted: false })) ||
    (await User.findOne({ systemRole: 'Super Admin', isDeleted: false, isActive: true })) ||
    (await User.findOne({ isDeleted: false, isActive: true }))
  );
}

async function resolveOrCreateDemoProduct() {
  const existing =
    (await LogisticsProduct.findOne({
      code: ASSET_ONE_DEMO.productCode,
      isDeleted: false,
    })) ||
    (await LogisticsProduct.findOne({
      productType: 'Medical Device',
      isDeleted: false,
      isActive: { $ne: false },
    }));
  if (existing) return existing;

  return LogisticsProduct.create({
    code: ASSET_ONE_DEMO.productCode,
    name: ASSET_ONE_DEMO.productName,
    sku: ASSET_ONE_DEMO.productCode,
    productType: 'Medical Device',
    productClassification: 'Medical',
    inventoryType: 'Asset',
    trackingKind: 'Serial',
    isActive: true,
    description: 'Seed product for Asset One ↔ Document One demo lease.',
    internalRemarks: ASSET_ONE_DEMO.marker,
  });
}

/**
 * Idempotent demo: one Asset One device linked to the Document One demo agreement.
 * Prefer calling after logistics seed so a Medical Device product exists.
 */
export async function ensureAssetOneAgreementDemo() {
  const { agreementId, contactId } = await ensureDocumentOneDemo();
  const agreement = await Agreement.findOne({ _id: agreementId, isDeleted: false });
  if (!agreement) {
    return { created: false, linked: false, reason: 'document_one_agreement_missing' };
  }

  let asset = await Asset.findOne({
    serialNumber: ASSET_ONE_DEMO.serialNumber,
    isDeleted: false,
  });

  const actor = await resolveDemoActor();
  let created = false;

  if (!asset) {
    const product = await resolveOrCreateDemoProduct();
    const purchaseMonth = (() => {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${mm}/${d.getFullYear()}`;
    })();

    const device = await DeviceMaster.create({
      name: ASSET_ONE_DEMO.name,
      assetType: 'Tylo Owned',
      serialNumber: ASSET_ONE_DEMO.serialNumber,
      cost: 1,
      purchaseMonth,
      agreementStatus: 'Not Initiated',
      custody: 'Tylo Office',
      custodianName: DOCUMENT_ONE_DEMO.partyName,
      custodianContact: DOCUMENT_ONE_DEMO.partyMobile,
      custodianCity: 'Pune',
      custodianState: 'Maharashtra',
      description: `Demo asset linked to Document One agreement "${DOCUMENT_ONE_DEMO.title}".`,
      productId: product._id,
      quantity: 1,
      isActive: true,
    });

    asset = await createAsset(
      {
        deviceMasterId: device._id,
        deviceNameSnapshot: ASSET_ONE_DEMO.name,
        serialNumber: ASSET_ONE_DEMO.serialNumber,
        quantity: 1,
        status: 'Available',
        deviceValue: 1,
        purchaseDate: new Date().toISOString().slice(0, 10),
        addedMonth: purchaseMonth,
        remarks: ASSET_ONE_DEMO.marker,
        agreementStatus: 'Not Initiated',
        custody: 'Tylo Office',
        assetType: 'Tylo Owned',
        productType: 'Medical Device',
        contactId: contactId || null,
        custodianName: DOCUMENT_ONE_DEMO.partyName,
        custodianContact: DOCUMENT_ONE_DEMO.partyMobile,
        location: { city: 'Pune', state: 'Maharashtra' },
      },
      actor || { fullName: 'System Seed', email: 'system@seed' },
    );
    created = true;
  }

  let link = await AgreementAsset.findOne({
    agreementId: agreement._id,
    assetId: asset._id,
    isActive: true,
  });

  let linked = Boolean(link);
  if (!link) {
    const otherActive = await AgreementAsset.findOne({
      assetId: asset._id,
      isActive: true,
    });
    if (otherActive && String(otherActive.agreementId) !== String(agreement._id)) {
      return {
        created,
        linked: false,
        reason: 'asset_linked_elsewhere',
        assetId: asset._id,
        agreementId: agreement._id,
      };
    }

    link = await AgreementAsset.create({
      agreementId: agreement._id,
      assetId: asset._id,
      isActive: true,
      linkedAt: new Date().toISOString(),
    });
    await captureAgreementAssetSnapshot(link, asset, { source: 'link' });

    await AssetEvent.create({
      assetId: asset._id,
      at: new Date().toISOString(),
      eventType: 'AGREEMENT_LINK',
      relatedEntityType: 'Agreement',
      relatedEntityId: agreement._id,
      actorId: actor?._id || null,
      reason: 'Linked to Document One demo agreement',
    });

    await AgreementActivity.create({
      agreementId: agreement._id,
      at: new Date().toISOString(),
      actorId: actor?._id || null,
      actorName: actor?.fullName || actor?.email || 'System Seed',
      actorEmail: actor?.email || '',
      action: 'ASSET_LINKED',
      message: `Linked demo asset ${ASSET_ONE_DEMO.serialNumber}`,
      meta: { demoSeed: ASSET_ONE_DEMO.marker, assetId: String(asset._id) },
    });

    linked = true;
  }

  // Agreement Signed only when Actions has a document (file or text body).
  if (await agreementHasStoredDocument(agreement._id)) {
    if (asset.agreementStatus !== 'Agreement Signed' || !asset.activeAgreementId) {
      asset.activeAgreementId = agreement._id;
      asset.agreementStatus = 'Agreement Signed';
      await asset.save();
    }
    await DeviceMaster.updateOne(
      { _id: asset.deviceMasterId, isDeleted: false },
      { $set: { agreementStatus: 'Agreement Signed' } }
    );
  }

  return {
    created,
    linked,
    assetId: asset._id,
    agreementId: agreement._id,
    serialNumber: ASSET_ONE_DEMO.serialNumber,
    agreementTitle: DOCUMENT_ONE_DEMO.title,
  };
}
