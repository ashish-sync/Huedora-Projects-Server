import manualPasteConfig from './manualPasteFieldConfig.json' with { type: 'json' };

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

export function getPasteTabularFieldKeys() {
  return getRequestStageFields()
    .filter((field) => !field.contextOnly)
    .map((field) => field.key);
}

export function getFieldLabelsMap() {
  return Object.fromEntries(
    getRequestStageFields().map((field) => [field.key, field.label]),
  );
}
