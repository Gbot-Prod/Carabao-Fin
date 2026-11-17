import { ImageResponse } from 'next/og';

// Default link preview image (1200×630, the size Facebook asks for). Farm
// pages with a banner use the banner instead.

export const alt = 'Carabao — fresh produce from Filipino farms';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 96px',
          background: '#173d25',
          color: '#f7fcf8',
        }}
      >
        <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: -2 }}>Carabao</div>
        <div style={{ fontSize: 44, marginTop: 24, color: '#cfe8d8' }}>
          Fresh produce, direct from Filipino farms
        </div>
      </div>
    ),
    size,
  );
}
