import manualPasteConfig from './manualPasteFieldConfig.json' with { type: 'json' };

/**
 * Single source of truth for Camp One request-stage field keys, labels, order,
 * and import/paste column definitions.
 */
export function getRequestStageFields() {
  return manualPasteConfig.requestStageFields || [];
}

export function getCampImportFields() {
  return getRequestStageFields().map((field) => ({
    key: field.key,
    label: field.label,
    required: Boolean(field.required),
    contextOnly: Boolean(field.contextOnly),
  }));
}

export function getCampFieldLabel(key) {
  const field = getRequestStageFields().find((item) => item.key === key);
  return field?.label || key;
}

export function getPasteTabularFieldKeys() {
  return getRequestStageFields()
    .filter((field) => !field.contextOnly)
    .map((field) => field.key);
}

export function getPasteContextFieldKeys() {
  return getRequestStageFields()
    .filter((field) => field.contextOnly)
    .map((field) => field.key);
}

export function getPasteOutputFieldKeys() {
  return getPasteTabularFieldKeys();
}

export function getFieldLabelsMap() {
  return Object.fromEntries(
    getRequestStageFields().map((field) => [field.key, field.label]),
  );
}

export function getManualPasteConfig() {
  return manualPasteConfig;
}
