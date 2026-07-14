import { Contact } from '../contacts/contact.model.js';
import { Asset } from './asset.model.js';
import { AgreementAsset } from '../agreements/agreement.model.js';

/** Link asset inventory custodian to the agreement's Contact Directory entry. */
export async function syncAssetContactFromAgreement(asset, agreement) {
  if (!agreement?.contactId || !asset) return asset;
  const contact = await Contact.findOne({ _id: agreement.contactId, isDeleted: false });
  if (!contact) return asset;
  asset.contactId = contact._id;
  if (contact.city) {
    asset.location = { ...(asset.location || {}), city: contact.city };
  }
  return asset;
}

/** Apply agreement contact to all linked inventory assets. */
export async function syncLinkedAssetsFromAgreement(agreement) {
  if (!agreement?.contactId) return;
  const links = await AgreementAsset.find({ agreementId: agreement._id, isActive: true });
  for (const link of links) {
    const asset = await Asset.findOne({ _id: link.assetId, isDeleted: false });
    if (!asset) continue;
    await syncAssetContactFromAgreement(asset, agreement);
    await asset.save();
  }
}
