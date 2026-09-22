import type { ConversionId } from './types';

export type ConversionSpec = {
  id: ConversionId;
  label: string;
  description: string;
  fromExtensions: string[];
  outputExtension: string;
  outputMime: string;
  kind: 'image' | 'office-to-pdf' | 'pdf-to-office' | 'pdf-to-images' | 'spreadsheet' | 'office-to-office';
};

// Kept separate from the execution code because the browser upload UI imports it.
export const CONVERSIONS: readonly ConversionSpec[] = [
  { id: 'pdf-word', label: 'PDF to Word', description: 'Extract PDF text into a DOCX; scanned pages fall back to page images.', fromExtensions: ['.pdf'], outputExtension: '.docx', outputMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'pdf-to-office' },
  { id: 'pdf-excel', label: 'PDF to Excel', description: 'Extract PDF text into an XLSX workbook.', fromExtensions: ['.pdf'], outputExtension: '.xlsx', outputMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'pdf-to-office' },
  { id: 'pdf-powerpoint', label: 'PDF to PowerPoint', description: 'Create a PPTX with one slide per PDF page.', fromExtensions: ['.pdf'], outputExtension: '.pptx', outputMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'pdf-to-office' },
  { id: 'pdf-jpg', label: 'PDF to JPG', description: 'Render PDF pages to JPG. Multi-page PDFs download as a ZIP.', fromExtensions: ['.pdf'], outputExtension: '.zip', outputMime: 'application/zip', kind: 'pdf-to-images' },
  { id: 'pdf-png', label: 'PDF to PNG', description: 'Render PDF pages to PNG. Multi-page PDFs download as a ZIP.', fromExtensions: ['.pdf'], outputExtension: '.zip', outputMime: 'application/zip', kind: 'pdf-to-images' },
  { id: 'word-pdf', label: 'Word to PDF', description: 'Convert DOC/DOCX files to PDF with LibreOffice.', fromExtensions: ['.doc', '.docx'], outputExtension: '.pdf', outputMime: 'application/pdf', kind: 'office-to-pdf' },
  { id: 'excel-pdf', label: 'Excel to PDF', description: 'Convert XLS/XLSX files to PDF with LibreOffice.', fromExtensions: ['.xls', '.xlsx'], outputExtension: '.pdf', outputMime: 'application/pdf', kind: 'office-to-pdf' },
  { id: 'powerpoint-pdf', label: 'PowerPoint to PDF', description: 'Convert PPT/PPTX files to PDF with LibreOffice.', fromExtensions: ['.ppt', '.pptx'], outputExtension: '.pdf', outputMime: 'application/pdf', kind: 'office-to-pdf' },
  { id: 'word-powerpoint', label: 'Word to PowerPoint', description: 'Create a page-based PPTX from a DOC/DOCX file. Layout is preserved as slide images.', fromExtensions: ['.doc', '.docx'], outputExtension: '.pptx', outputMime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', kind: 'office-to-office' },
  { id: 'powerpoint-word', label: 'PowerPoint to Word', description: 'Create an editable DOCX from PPT/PPTX text with page-image fallback for slide fidelity.', fromExtensions: ['.ppt', '.pptx'], outputExtension: '.docx', outputMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'office-to-office' },
  { id: 'jpg-pdf', label: 'JPG to PDF', description: 'Turn a JPG/JPEG image into a PDF.', fromExtensions: ['.jpg', '.jpeg'], outputExtension: '.pdf', outputMime: 'application/pdf', kind: 'image' },
  { id: 'png-pdf', label: 'PNG to PDF', description: 'Turn a PNG image into a PDF.', fromExtensions: ['.png'], outputExtension: '.pdf', outputMime: 'application/pdf', kind: 'image' },
  { id: 'jpg-png', label: 'JPG to PNG', description: 'Convert JPG/JPEG image to PNG.', fromExtensions: ['.jpg', '.jpeg'], outputExtension: '.png', outputMime: 'image/png', kind: 'image' },
  { id: 'jpg-webp', label: 'JPG to WebP', description: 'Convert JPG/JPEG to WebP.', fromExtensions: ['.jpg', '.jpeg'], outputExtension: '.webp', outputMime: 'image/webp', kind: 'image' },
  { id: 'png-jpg', label: 'PNG to JPG', description: 'Convert PNG to JPG with a white background.', fromExtensions: ['.png'], outputExtension: '.jpg', outputMime: 'image/jpeg', kind: 'image' },
  { id: 'png-webp', label: 'PNG to WebP', description: 'Convert PNG to WebP.', fromExtensions: ['.png'], outputExtension: '.webp', outputMime: 'image/webp', kind: 'image' },
  { id: 'webp-jpg', label: 'WebP to JPG', description: 'Convert WebP to JPG with a white background.', fromExtensions: ['.webp'], outputExtension: '.jpg', outputMime: 'image/jpeg', kind: 'image' },
  { id: 'webp-png', label: 'WebP to PNG', description: 'Convert WebP to PNG.', fromExtensions: ['.webp'], outputExtension: '.png', outputMime: 'image/png', kind: 'image' },
  { id: 'heic-jpg', label: 'HEIC / HEIF to JPG', description: 'Convert HEIC/HEIF photos to JPG.', fromExtensions: ['.heic', '.heif'], outputExtension: '.jpg', outputMime: 'image/jpeg', kind: 'image' },
  { id: 'xlsx-csv', label: 'Excel to CSV', description: 'Export an Excel workbook to CSV using LibreOffice.', fromExtensions: ['.xls', '.xlsx'], outputExtension: '.csv', outputMime: 'text/csv', kind: 'spreadsheet' },
  { id: 'csv-xlsx', label: 'CSV to Excel', description: 'Convert a CSV table into XLSX using LibreOffice.', fromExtensions: ['.csv'], outputExtension: '.xlsx', outputMime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'spreadsheet' },
] as const;
