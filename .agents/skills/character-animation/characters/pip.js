// Pip: an original layered 2D host character for rig-frame.js (MIT, part of
// this repo). 400 x 640 canvas, feet on y = 630. Every part is drawn in place
// in the shared canvas; the pivot is its joint. Restyle with pip({ colors }).

const O = "#23212e"; // outline
const SW = 5;

export function pip({ colors = {} } = {}) {
  const c = {
    skin: "#f2c39d",
    skinShade: "#e0a57f",
    hair: "#3b2a22",
    top: "#e8743b",
    topShade: "#c95d29",
    pants: "#2f4b7c",
    shoe: "#1f1d29",
    mouth: "#7a2e2e",
    tongue: "#d9646a",
    ...colors,
  };
  const st = `stroke="${O}" stroke-width="${SW}" stroke-linejoin="round" stroke-linecap="round"`;
  const leg = (x) =>
    `<rect x="${x - 23}" y="385" width="46" height="128" rx="22" fill="${c.pants}" ${st}/>`;
  const shin = (x) =>
    `<rect x="${x - 21}" y="492" width="42" height="116" rx="20" fill="${c.pants}" ${st}/>`;
  const shoe = (x) =>
    `<path d="M${x - 26},598 h34 q40,0 46,24 q2,9 -8,9 h-74 q-8,0 -7,-9 z" fill="${c.shoe}" ${st}/>`;
  const upper = (x) =>
    `<rect x="${x - 21}" y="238" width="42" height="104" rx="21" fill="${c.top}" ${st}/>`;
  const fore = (x) =>
    `<rect x="${x - 19}" y="322" width="38" height="86" rx="19" fill="${c.top}" ${st}/><rect x="${x - 19}" y="388" width="38" height="14" rx="6" fill="${c.topShade}" ${st}/>`;
  const hand = (x, s) =>
    `<circle cx="${x}" cy="418" r="19" fill="${c.skin}" ${st}/><ellipse cx="${x + s * 15}" cy="408" rx="8" ry="11" fill="${c.skin}" ${st}/>`;
  const eye = (x) => `<ellipse cx="${x}" cy="150" rx="21" ry="25" fill="#fff" ${st}/>`;
  const pupil = (x) =>
    `<circle cx="${x + 2}" cy="153" r="10" fill="${O}"/><circle cx="${x + 6}" cy="148" r="3.2" fill="#fff"/>`;
  const lid = (x) =>
    `<ellipse cx="${x}" cy="150" rx="25" ry="29" fill="${c.skin}"/><path d="M${x - 22},166 Q${x},180 ${x + 22},166" fill="none" stroke="${O}" stroke-width="${SW}" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
  const brow = (x) =>
    `<rect x="${x - 20}" y="106" width="40" height="10" rx="5" fill="${c.hair}"/>`;
  const mouth = {
    rest: `<path d="M182,206 Q200,214 218,206" fill="none" ${st}/>`,
    smile: `<path d="M174,198 Q200,230 226,198 Q200,210 174,198 z" fill="${c.mouth}" ${st}/>`,
    open: `<ellipse cx="200" cy="210" rx="16" ry="15" fill="${c.mouth}" ${st}/><ellipse cx="200" cy="218" rx="9" ry="5" fill="${c.tongue}"/>`,
    wide: `<ellipse cx="200" cy="208" rx="21" ry="9" fill="${c.mouth}" ${st}/>`,
    round: `<ellipse cx="200" cy="210" rx="10" ry="13" fill="${c.mouth}" ${st}/>`,
    mbp: `<path d="M183,208 L217,208" fill="none" ${st}/>`,
    fv: `<path d="M182,205 Q200,214 218,205 z" fill="${c.mouth}" ${st}/><rect x="190" y="202" width="20" height="6" rx="2" fill="#fff"/>`,
    teeth: `<rect x="181" y="199" width="38" height="17" rx="6" fill="#fff" ${st}/><path d="M181,207 H219" ${st}/>`,
    frown: `<path d="M182,214 Q200,200 218,214" fill="none" ${st}/>`,
    smirk: `<path d="M184,210 Q206,214 221,198" fill="none" ${st}/>`,
  };
  return {
    name: "pip",
    size: [400, 640],
    ground: [200, 630],
    ranges: { pupil: 8 },
    parts: [
      { id: "root", parent: null, pivot: [200, 630] },
      {
        id: "shadow",
        parent: "root",
        pivot: [200, 630],
        z: 0,
        art: `<ellipse cx="200" cy="630" rx="92" ry="12" fill="#000" opacity="0.22"/>`,
      },
      { id: "body", parent: "root", pivot: [200, 630] },
      {
        id: "hips",
        parent: "body",
        pivot: [200, 392],
        z: 2,
        art: `<path d="M120,380 H280 L284,420 Q200,436 116,420 z" fill="${c.pants}" ${st}/>`,
      },
      { id: "thighL", parent: "hips", pivot: [170, 398], z: 1, art: leg(170) },
      { id: "shinL", parent: "thighL", pivot: [170, 505], z: 1, art: shin(170) },
      { id: "footL", parent: "shinL", pivot: [170, 600], z: 1.1, art: shoe(170) },
      { id: "thighR", parent: "hips", pivot: [230, 398], z: 1, art: leg(230) },
      { id: "shinR", parent: "thighR", pivot: [230, 505], z: 1, art: shin(230) },
      { id: "footR", parent: "shinR", pivot: [230, 600], z: 1.1, art: shoe(230) },
      {
        id: "torso",
        parent: "hips",
        pivot: [200, 392],
        z: 3,
        art: `<path d="M116,268 Q118,238 152,234 L248,234 Q282,238 284,268 L294,402 Q200,422 106,402 z" fill="${c.top}" ${st}/><path d="M168,236 Q200,262 232,236" fill="none" ${st}/><path d="M150,330 Q200,342 250,330" fill="none" stroke="${c.topShade}" stroke-width="5" stroke-linecap="round"/>`,
      },
      {
        id: "head",
        parent: "torso",
        pivot: [200, 240],
        z: 6,
        art: `<rect x="183" y="214" width="34" height="32" rx="8" fill="${c.skinShade}" ${st}/><circle cx="113" cy="164" r="17" fill="${c.skin}" ${st}/><circle cx="287" cy="164" r="17" fill="${c.skin}" ${st}/><circle cx="200" cy="160" r="88" fill="${c.skin}" ${st}/><path d="M114,140 Q112,70 200,68 Q290,70 286,140 Q262,104 200,100 Q138,104 114,140 z" fill="${c.hair}" ${st}/><ellipse cx="200" cy="180" rx="11" ry="8" fill="${c.skinShade}"/><ellipse cx="150" cy="188" rx="14" ry="8" fill="#f09a8a" opacity="0.5"/><ellipse cx="250" cy="188" rx="14" ry="8" fill="#f09a8a" opacity="0.5"/>`,
      },
      {
        id: "tuft",
        parent: "head",
        pivot: [206, 76],
        z: 6.5,
        art: `<path d="M200,82 C186,40 228,22 246,44 C226,40 214,52 218,80 z" fill="${c.hair}" ${st}/>`,
      },
      { id: "eyeL", parent: "head", pivot: [166, 150], z: 7, art: eye(166) },
      { id: "pupilL", parent: "eyeL", pivot: [168, 153], z: 7.1, art: pupil(166) },
      {
        id: "lidL",
        parent: "eyeL",
        pivot: [166, 123],
        z: 7.2,
        art: lid(166),
        rest: { sy: 0.02 },
        limits: { sy: [0.02, 1.08] },
      },
      { id: "eyeR", parent: "head", pivot: [234, 150], z: 7, art: eye(234) },
      { id: "pupilR", parent: "eyeR", pivot: [236, 153], z: 7.1, art: pupil(234) },
      {
        id: "lidR",
        parent: "eyeR",
        pivot: [234, 123],
        z: 7.2,
        art: lid(234),
        rest: { sy: 0.02 },
        limits: { sy: [0.02, 1.08] },
      },
      { id: "browL", parent: "head", pivot: [166, 111], z: 7.5, art: brow(166) },
      { id: "browR", parent: "head", pivot: [234, 111], z: 7.5, art: brow(234) },
      {
        id: "mouth",
        parent: "head",
        pivot: [200, 207],
        z: 7.5,
        variants: mouth,
        defaultVariant: "rest",
      },
      { id: "upperArmL", parent: "torso", pivot: [126, 256], z: 4, art: upper(126) },
      { id: "foreArmL", parent: "upperArmL", pivot: [126, 330], z: 4.1, art: fore(126) },
      { id: "handL", parent: "foreArmL", pivot: [126, 404], z: 4.2, art: hand(126, 1) },
      { id: "upperArmR", parent: "torso", pivot: [274, 256], z: 4, art: upper(274) },
      { id: "foreArmR", parent: "upperArmR", pivot: [274, 330], z: 4.1, art: fore(274) },
      { id: "handR", parent: "foreArmR", pivot: [274, 404], z: 4.2, art: hand(274, -1) },
    ],
  };
}

/** Canvas point of the palm of each hand (prop anchor). */
export const PIP_PALM = { handL: [126, 420], handR: [274, 420] };
