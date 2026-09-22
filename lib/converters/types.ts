export const MAX_UPLOAD_MB = 500;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
export const MAX_PAGE_COUNT = 2500;

export type CompressionLevel = 'light' | 'balanced' | 'strong' | 'maximum';
export type ConversionId = 'pdf-word' | 'pdf-excel' | 'pdf-powerpoint' | 'pdf-jpg' | 'pdf-png' | 'word-pdf' | 'excel-pdf' | 'powerpoint-pdf' | 'jpg-pdf' | 'png-pdf' | 'jpg-png' | 'jpg-webp' | 'png-jpg' | 'png-webp' | 'webp-jpg' | 'webp-png' | 'heic-jpg' | 'xlsx-csv' | 'csv-xlsx' | 'word-powerpoint' | 'powerpoint-word';
export type CompressionTarget = number | 'best';

export type ConverterResult = {
  outputPath: string;
  inputBytes: number;
  outputBytes: number;
  targetReached?: boolean | null;
  level?: CompressionLevel;
  outputFilename?: string;
  outputMime?: string;
  conversion?: string;
};

export class ConverterError extends Error {
  constructor(message: string, public readonly status = 422) {
    super(message);
  }
}
