// SMART logo mark — geometry lifted verbatim from the SMART Health IT design
// bundle's SmartLockup.jsx (chevron polygons from the official logo.svg).

function BlueChev() {
  return (
    <polygon
      fill="#64aed0"
      points="125.46 117.01 115.89 117.01 104.68 98.42 93.14 117.01 83.82 117.01 104.66 82.83"
    />
  );
}

function Asterisk5() {
  return (
    <g>
      <polygon fill="#722772" points="83.91 0 93.42 0 104.56 18.47 116.03 0 125.28 0 104.58 33.96" />
      <polygon fill="#e24a31" points="60.61 35.72 65.37 28.16 87.76 28.16 76.67 9.49 81.3 1.87 101.89 35.72" />
      <polygon fill="#e77d26" points="128 1.73 132.76 9.55 121.5 28.16 144.06 28.16 148.69 35.72 107.4 35.72" />
      <polygon fill="#89bf44" points="148.72 38.78 143.97 46.33 121.57 46.33 132.66 65.16 128.03 72.78 107.44 38.78" />
      <polygon fill="#f1b42a" points="81.28 72.77 76.53 64.94 87.78 46.33 65.23 46.33 60.6 38.78 101.89 38.78" />
    </g>
  );
}

/** The 6-petal SMART asterisk mark (favicon/app-chrome scale). */
export function SmartMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="59 -1 91 75" width={size} height={size} aria-hidden="true">
      <Asterisk5 />
      <g transform="translate(0,-43.79)">
        <BlueChev />
      </g>
    </svg>
  );
}
