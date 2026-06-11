// QR rendering wrapper. The QR encodes the bare shlink URI (decision 11: no viewer
// prefix in phase 1), regenerated from current state on every render.

import QRCode from 'qrcode';

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 6,
    color: { dark: '#1a1a1a', light: '#ffffff' },
  });
}
