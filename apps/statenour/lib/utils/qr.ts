import QRCode from "qrcode";

export async function generateQRDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { width: 200, margin: 1 });
}

export async function generateQRBuffer(text: string): Promise<Buffer> {
  return QRCode.toBuffer(text, { width: 200, margin: 1 });
}
