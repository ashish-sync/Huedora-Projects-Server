export class PdfEngineUnavailableError extends Error {
  constructor(message = 'Word-faithful PDF needs Microsoft Word or LibreOffice on this server.') {
    super(message);
    this.name = 'PdfEngineUnavailableError';
    this.code = 'PDF_ENGINE_UNAVAILABLE';
    this.status = 503;
  }
}
