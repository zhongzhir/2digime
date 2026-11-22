/*
 * Validation-only declarations for dependencies listed in package.json but not
 * installed in this checkout. This file is included only by validation-tsconfig.json
 * and is not part of the product build.
 */
declare module 'fast-xml-parser' {
  export interface XmlParserOptions {
    ignoreAttributes?: boolean;
    attributeNamePrefix?: string;
    trimValues?: boolean;
    isArray?: (name: string, jpath?: string, isLeafNode?: boolean, isAttribute?: boolean) => boolean;
    [key: string]: unknown;
  }
  export class XMLParser {
    constructor(options?: XmlParserOptions);
    parse(input: string): any;
  }
}

declare module 'node-html-parser' {
  export function parse(input: string, options?: Record<string, unknown>): any;
}

declare module 'robots-parser' {
  const robotsParser: (url: string, contents: string) => {
    isAllowed(target: string, userAgent?: string): boolean | undefined;
    getSitemaps(): string[];
  };
  export default robotsParser;
}

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfParseResult {
    text: string;
    numpages?: number;
    info?: Record<string, unknown>;
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export = pdfParse;
}
