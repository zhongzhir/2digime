declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages: number;
  }
  function pdfParse(data: Uint8Array): Promise<PdfParseResult>;
  export = pdfParse;
}
