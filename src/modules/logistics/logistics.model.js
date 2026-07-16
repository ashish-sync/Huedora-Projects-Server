import { defineCollection } from '../../store/filedb.js';
import { softDelete } from '../common/counter.model.js';

export const LogisticsWarehouse = defineCollection('logistics_warehouses', {
  ...softDelete,
  code: '',
  name: '',
  city: '',
  state: '',
  address: '',
  isActive: true,
});

export const LogisticsLocation = defineCollection('logistics_locations', {
  ...softDelete,
  warehouseId: null,
  parentId: null,
  level: 'Zone',
  code: '',
  name: '',
  isActive: true,
});

export const LogisticsSupplier = defineCollection('logistics_suppliers', {
  ...softDelete,
  code: '',
  name: '',
  /** Supplier | Vendor */
  partyType: 'Supplier',
  contactId: null,
  contactName: '',
  email: '',
  phone: '',
  city: '',
  state: '',
  isActive: true,
});

export const LogisticsTransporter = defineCollection('logistics_transporters', {
  ...softDelete,
  code: '',
  name: '',
  contactName: '',
  email: '',
  phone: '',
  isActive: true,
});

export const LogisticsCategory = defineCollection('logistics_categories', {
  ...softDelete,
  code: '',
  name: '',
  description: '',
  isActive: true,
});

/** Catalog products for transaction Product Name picker */
export const LogisticsProduct = defineCollection('logistics_products', {
  ...softDelete,
  code: '',
  name: '',
  productType: 'Medical Device',
  programProject: '',
  brand: '',
  model: '',
  sku: '',
  partNumber: '',
  description: '',
  /** Auto flags for Inventory Tracking section */
  expiryApplicable: false,
  trackingKind: 'None', // None | Serial | Batch | Batch + Serial
  defaultPerUnitCost: 0,
  defaultInvoiceAmount: 0,
  isActive: true,
});

export const LogisticsUom = defineCollection('logistics_uoms', {
  ...softDelete,
  code: '',
  name: '',
  isActive: true,
});

export const LogisticsStockStatus = defineCollection('logistics_stock_statuses', {
  ...softDelete,
  code: '',
  name: '',
  isSystem: false,
  isActive: true,
});

export const LogisticsMovementType = defineCollection('logistics_movement_types', {
  ...softDelete,
  code: '',
  name: '',
  direction: 'IN',
  isSystem: false,
  isActive: true,
});

export const LogisticsReasonCode = defineCollection('logistics_reason_codes', {
  ...softDelete,
  code: '',
  name: '',
  isSystem: false,
  isActive: true,
});

export const LogisticsStockItem = defineCollection('logistics_stock_items', {
  ...softDelete,
  sku: '',
  name: '',
  serialNumber: null,
  imei: null,
  batchNumber: null,
  categoryId: null,
  uomId: null,
  warehouseId: null,
  locationId: null,
  productType: '',
  status: 'Available',
  quantity: 1,
  unitValue: 0,
  lowStockThreshold: 0,
  expiryDate: '',
  dhubAssetId: null,
  remarks: '',
  isActive: true,
});

export const LogisticsInventoryBalance = defineCollection('logistics_inventory_balances', {
  ...softDelete,
  warehouseId: null,
  locationId: null,
  categoryId: null,
  productType: '',
  status: 'Available',
  quantity: 0,
  value: 0,
});

export const LogisticsLedgerEntry = defineCollection('logistics_ledger_entries', {
  stockItemId: null,
  movementTypeCode: '',
  direction: 'IN',
  quantityDelta: 0,
  warehouseId: null,
  locationId: null,
  fromWarehouseId: null,
  toWarehouseId: null,
  referenceType: null,
  referenceId: null,
  reasonCode: null,
  remarks: '',
  actorId: null,
  actorEmail: null,
  at: null,
});

/**
 * Dynamic inventory transaction — single engine for all Entry Type × Product Type.
 */
export const LogisticsInOutEntry = defineCollection('logistics_in_out_entries', {
  ...softDelete,
  /** Transaction ID */
  uniqueKey: '',
  entryType: 'Inward',
  productType: 'Medical Device',
  /** Alias kept for older list filters */
  inventoryType: 'Medical Device',
  trackingType: 'Serialized',
  transactionDate: '',
  transactionDateTime: '',
  warehouseId: null,
  fromLocationId: null,
  toLocationId: null,
  empId: '',
  employeeName: '',
  /** Contact Directory link */
  contactId: null,
  number: '',
  state: '',
  city: '',
  recipientName: '',
  /** Legacy spreadsheet name field */
  name: '',
  remark: '',
  status: 'Available',
  createdBy: '',
  createdById: null,

  /** Inventory & Vendor Master links */
  productId: null,
  productName: '',
  programProject: '',
  processId: null,
  processName: '',
  supplierId: null,
  transporterId: null,

  /** Tracking */
  expiryApplicable: false,
  trackingKind: 'None',
  batchOrSerial: '',
  deliveryMode: 'Hand Delivery',

  /** Shared qty / cost */
  qty: 1,
  perUnitCost: 0,
  invoiceAmount: 0,

  /** Medical Device */
  deviceName: '',
  brand: '',
  model: '',
  serialNumber: '',
  assetId: '',
  imei: '',
  condition: '',
  warranty: '',

  /** Consumable / Other */
  itemName: '',
  sku: '',
  batchNumber: '',
  expiryDate: '',
  description: '',

  /** Device Part */
  partName: '',
  partNumber: '',
  compatibleDevice: '',

  /** Accessory */
  accessoryName: '',

  /** Document */
  documentType: '',
  documentNumber: '',
  agreementId: '',
  version: '',
  linkedAssetId: '',

  /** Inward */
  vendor: '',
  purchaseOrder: '',
  grnNumber: '',
  invoiceNumber: '',
  invoiceDate: '',
  awbNumber: '',
  courier: '',
  receivedBy: '',

  /** Outward */
  issuedTo: '',
  department: '',
  city: '',
  expectedReturn: '',
  acknowledgementRequired: false,

  /** Transfer */
  sourceWarehouseId: null,
  destinationWarehouseId: null,
  transferReason: '',
  transferId: '',

  /** Return */
  returnedFrom: '',
  returnReason: '',
  inspectionStatus: '',
  restock: false,

  /** Stock Adjustment */
  adjustmentType: '',
  adjustmentReason: '',
  approvedBy: '',

  /** Legacy spreadsheet fields (optional) */
  number: '',
  process: '',
  mode: '',
  expDate: '',

  /** Inward attachments */
  productPhoto: null,
  invoiceDoc: null,
  attachments: [],

  isActive: true,
});

/** Camp-linked consumption — Screen Count = Used; Wastage feeds dashboard */
export const LogisticsUsageEntry = defineCollection('logistics_usage_entries', {
  ...softDelete,
  hcwId: '',
  hcwName: '',
  clientName: '',
  processName: '',
  inventoryType: '',
  productName: '',
  doctorName: '',
  machineCity: '',
  campDate: '',
  screenCount: 0,
  usedQty: 0,
  wastage: 0,
  perUnitCost: 0,
  campRequestId: null,
  source: 'manual',
  remark: '',
  isActive: true,
});
