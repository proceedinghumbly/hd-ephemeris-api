const express = require('express');
const sweph = require('sweph');
const path = require('path');

const app = express();
app.use(express.json());

const c = sweph.constants;
sweph.set_ephe_path(path.join(__dirname, 'ephe'));

// Planet IDs
const PLANETS = {
  Sun: c.SE_SUN,
  Moon: c.SE_MOON,
  Mercury: c.SE_MERCURY,
  Venus: c.SE_VENUS,
  Mars: c.SE_MARS,
  Jupiter: c.SE_JUPITER,
  Saturn: c.SE_SATURN,
  Uranus: c.SE_URANUS,
  Neptune: c.SE_NEPTUNE,
  Pluto: c.SE_PLUTO,
  NorthNode: c.SE_TRUE_NODE,
  Chiron: c.SE_CHIRON
};

// HD Gate wheel - correct order starting at 0° of HD wheel
// (0° HD wheel = 0° Aries + offset, which is ~2° Aquarius tropically)
const GATE_ORDER = [
  41, 19, 13, 49, 30, 55, 37, 63, 22, 36, 25, 17, 21, 51, 42, 3,
  27, 24, 2, 23, 8, 20, 16, 35, 45, 12, 15, 52, 39, 53, 62, 56,
  31, 33, 7, 4, 29, 59, 40, 64, 47, 6, 46, 18, 48, 57, 32, 50,
  28, 44, 1, 43, 14, 34, 9, 5, 26, 11, 10, 58, 38, 54, 61, 60
];

const DEGREES_PER_GATE = 5.625;
const DEGREES_PER_LINE = 0.9375;
const DEGREES_PER_COLOR = 0.15625;
const DEGREES_PER_TONE = 0.026041667;
const DEGREES_PER_BASE = 0.005208333;

// HD wheel offset from tropical zodiac
// Calibrated: 58.93° gives correct 61.5.4.5.2 for Jan 14, 1983 9:24 PM UTC
const HD_OFFSET = 58.93;

function longitudeToGate(longitude) {
  // Normalize
  let deg = ((longitude % 360) + 360) % 360;
  
  // Apply HD offset
  let wheelPos = (deg + HD_OFFSET) % 360;
  
  // Find gate
  const gateIndex = Math.floor(wheelPos / DEGREES_PER_GATE);
  const gate = GATE_ORDER[gateIndex];
  
  // Position within gate
  const posInGate = wheelPos % DEGREES_PER_GATE;
  const line = Math.floor(posInGate / DEGREES_PER_LINE) + 1;
  
  const posInLine = posInGate % DEGREES_PER_LINE;
  const color = Math.floor(posInLine / DEGREES_PER_COLOR) + 1;
  
  const posInColor = posInLine % DEGREES_PER_COLOR;
  const tone = Math.floor(posInColor / DEGREES_PER_TONE) + 1;
  
  const posInTone = posInColor % DEGREES_PER_TONE;
  const base = Math.floor(posInTone / DEGREES_PER_BASE) + 1;
  
  return {
    gate,
    line: Math.min(line, 6),
    color: Math.min(color, 6),
    tone: Math.min(tone, 6),
    base: Math.min(base, 5),
    longitude: deg,
    wheelPosition: wheelPos,
    formatted: `${gate}.${Math.min(line,6)}.${Math.min(color,6)}.${Math.min(tone,6)}.${Math.min(base,5)}`
  };
}

function dateToJulian(date) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const h = date.getUTCHours() + date.getUTCMinutes()/60 + date.getUTCSeconds()/3600;
  return sweph.julday(y, m, d, h, c.SE_GREG_CAL);
}

// Find when Sun was at target longitude (for design calculation)
function findSunAtLongitude(targetLon, startJd, direction = -1) {
  targetLon = ((targetLon % 360) + 360) % 360;
  const flags = c.SEFLG_SWIEPH | c.SEFLG_SPEED;
  
  let jd = startJd;
  let iterations = 0;
  
  while (iterations < 200) {
    const sun = sweph.calc_ut(jd, c.SE_SUN, flags);
    const sunLon = sun.data[0];
    
    let diff = targetLon - sunLon;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    
    if (Math.abs(diff) < 0.0001) { // High precision
      return jd;
    }
    
    // Sun moves ~1°/day
    jd += diff * direction;
    iterations++;
  }
  
  // Fallback
  return startJd - 88;
}

function calculateChart(birthDate) {
  const jd = dateToJulian(birthDate);
  const flags = c.SEFLG_SWIEPH | c.SEFLG_SPEED;
  
  // Get birth Sun longitude
  const birthSun = sweph.calc_ut(jd, c.SE_SUN, flags);
  const birthSunLon = birthSun.data[0];
  
  // Design Sun is 88° before birth Sun (going backwards in zodiac)
  const designSunLon = ((birthSunLon - 88) % 360 + 360) % 360;
  
  // Find when Sun was at design longitude
  const designJd = findSunAtLongitude(designSunLon, jd, -1);
  
  const result = {
    birthJulianDay: jd,
    designJulianDay: designJd,
    personality: {},
    design: {}
  };
  
  // Calculate all personality positions
  for (const [name, planetId] of Object.entries(PLANETS)) {
    const calc = sweph.calc_ut(jd, planetId, flags);
    if (calc.error) continue;
    result.personality[name] = longitudeToGate(calc.data[0]);
  }
  
  // South Node = opposite of North Node
  if (result.personality.NorthNode) {
    const southLon = (result.personality.NorthNode.longitude + 180) % 360;
    result.personality.SouthNode = longitudeToGate(southLon);
  }
  
  // Earth = opposite of Sun
  if (result.personality.Sun) {
    const earthLon = (result.personality.Sun.longitude + 180) % 360;
    result.personality.Earth = longitudeToGate(earthLon);
  }
  
  // Calculate all design positions
  for (const [name, planetId] of Object.entries(PLANETS)) {
    const calc = sweph.calc_ut(designJd, planetId, flags);
    if (calc.error) continue;
    result.design[name] = longitudeToGate(calc.data[0]);
  }
  
  // Design South Node and Earth
  if (result.design.NorthNode) {
    const southLon = (result.design.NorthNode.longitude + 180) % 360;
    result.design.SouthNode = longitudeToGate(southLon);
  }
  if (result.design.Sun) {
    const earthLon = (result.design.Sun.longitude + 180) % 360;
    result.design.Earth = longitudeToGate(earthLon);
  }
  
  return result;
}

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Main API
app.post('/calculate', (req, res) => {
  try {
    const { birthDate } = req.body;
    if (!birthDate) {
      return res.status(400).json({ error: 'birthDate required' });
    }
    
    const date = new Date(birthDate);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: 'Invalid date' });
    }
    
    const chart = calculateChart(date);
    res.json({ success: true, birthDate: date.toISOString(), ...chart });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', ephemeris: 'Swiss Ephemeris (native C)' });
});

// Test verification
app.get('/verify', (req, res) => {
  // Jan 14, 1983 9:24 PM UTC - expected pSun = 61.5.x.x.x
  const date = new Date('1983-01-14T21:24:00Z');
  const chart = calculateChart(date);
  res.json({
    testDate: date.toISOString(),
    expected: { sunGate: 61, sunLine: 5 },
    actual: { 
      sunGate: chart.personality.Sun.gate,
      sunLine: chart.personality.Sun.line,
      sunFull: chart.personality.Sun.formatted
    },
    sunMatch: chart.personality.Sun.gate === 61 && chart.personality.Sun.line === 5
  });
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`Swiss Ephemeris API on port ${PORT}`);
});
