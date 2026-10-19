// Map definitions. Coordinates are on a 1000x1000 grid (x right, y down).
// Radar images live in radars/<map>.png. Callout positions are approximate (1000x1000 grid);
// tweak the numbers below if a label sits in the wrong spot.
// active:false = map is out of the competitive rotation: greyed out in the app, saved lineups are kept.
// Flip it back (or use the "Map pool" button in the app) when the map returns. *_lower levels follow their map.
// To add a map: add an entry here with a `shapes` SVG string and a `callouts` list.

const MAPS = {
  dust2: {
    name: "Dust II",
    shapes: `
      <g class="area">
        <rect x="640" y="60" width="300" height="220" rx="18"/>           <!-- A site -->
        <rect x="60" y="60" width="280" height="200" rx="18"/>            <!-- B site -->
        <rect x="400" y="60" width="200" height="120" rx="14"/>           <!-- CT spawn -->
        <rect x="430" y="860" width="200" height="110" rx="14"/>          <!-- T spawn -->
      </g>
      <g class="lane">
        <path d="M530 860 L530 640 L480 520 L440 400 L440 250"/>          <!-- mid -->
        <path d="M600 300 L700 340 L760 420"/>                            <!-- short / catwalk -->
        <path d="M600 860 L790 800 L830 640 L900 500 L800 420 L780 280"/> <!-- long -->
        <path d="M470 860 L280 760 L230 600 L200 480 L200 300"/>          <!-- tunnels -->
        <path d="M200 260 L330 230 L440 250"/>                            <!-- b window / ct -->
        <path d="M440 250 L500 180"/>
      </g>`,
    callouts: [
      ["T Spawn", 390, 930], ["Lower Tunnels", 180, 700], ["Upper Tunnels", 200, 480],
      ["Tunnel Exit", 110, 350], ["B Doors", 150, 270], ["B Site", 205, 125], ["B Plat", 100, 50],
      ["B Window", 262, 150], ["CT Spawn", 600, 215], ["CT Mid", 470, 300], ["Mid", 470, 520],
      ["Mid Doors", 470, 375], ["Xbox", 510, 425], ["Short / Cat", 600, 380], ["A Ramp", 650, 240],
      ["A Site", 815, 165], ["Goose", 700, 115], ["Ninja", 790, 100], ["Long Corner", 800, 300],
      ["A Long", 880, 420], ["Long Car", 945, 275], ["Pit", 885, 640], ["Long Doors", 700, 620],
      ["Outside Long", 720, 735], ["Suicide", 470, 760],
      ["Outside B Tunnels", 215, 610], ["Elevator", 700, 215], ["Scaffolding", 215, 170], ["Bottom Mid", 470, 660]
    ]
  }
  ,
  mirage: { name: "Mirage", callouts: [
    ["T Spawn", 900, 370], ["CT Spawn", 305, 710], ["A Site", 555, 780], ["B Site", 235, 290],
    ["Palace", 760, 780], ["A Ramp", 730, 670], ["Jungle", 490, 650], ["Connector", 420, 560],
    ["Mid", 560, 470], ["Top Mid", 690, 440], ["Underpass", 530, 250], ["Apartments", 230, 435],
    ["Market", 385, 200], ["B Short", 450, 330]
  ]},
  inferno: { name: "Inferno", callouts: [
    ["T Spawn", 100, 700], ["CT Spawn", 915, 360], ["B Site", 500, 225], ["A Site", 830, 700],
    ["Banana", 460, 480], ["Mid", 530, 660], ["Second Mid", 650, 690], ["Long", 690, 660],
    ["Graveyard", 930, 560], ["Library", 800, 860], ["Arch", 840, 500], ["Coffins", 480, 340]
  ]},
  ancient: { name: "Ancient", callouts: [
    ["T Spawn", 495, 880], ["CT Spawn", 515, 150], ["A Site", 765, 420], ["B Site", 310, 265],
    ["Mid", 490, 380], ["Donut", 315, 465], ["A Main", 810, 600], ["B Ramp", 300, 360]
  ]},
  anubis: { name: "Anubis", callouts: [
    ["T Spawn", 500, 930], ["CT Spawn", 430, 230], ["A Site", 760, 270], ["B Site", 335, 500],
    ["Canal", 570, 600], ["Connector", 500, 450]
  ]},
  nuke: { name: "Nuke", callouts: [
    ["T Spawn", 200, 560], ["CT Spawn", 840, 480], ["A Site", 600, 530], ["Lobby", 470, 540],
    ["Silo", 505, 650], ["Yard", 580, 700], ["Heaven", 590, 340], ["Garage", 740, 690], ["Ramp", 450, 500]
  ]},
  nuke_lower: { name: "Nuke (lower)", callouts: [
    ["B Site", 585, 580], ["Decon", 590, 470], ["Ramp room", 570, 400], ["Secret", 690, 660]
  ]},
  overpass: { name: "Overpass", active: false, callouts: [
    ["T Spawn", 660, 940], ["A Site", 725, 330], ["B Site", 490, 210], ["Fountain", 440, 720]
  ]},
  cache: { name: "Cache", callouts: [] },
  vertigo: { name: "Vertigo", active: false, callouts: [
    ["T Spawn", 410, 780], ["CT Spawn", 570, 250], ["A Site", 720, 595], ["B Site", 225, 240]
  ]},
  vertigo_lower: { name: "Vertigo (lower)", callouts: [] },
  train: { name: "Train", active: false, callouts: [] },
  train_lower: { name: "Train (lower)", callouts: [] }
};

const NADE_TYPES = {
  smoke: { label: "Smoke",   color: "#8fb3ff", icon: "S" },
  flash: { label: "Flash",   color: "#ffe14d", icon: "F" },
  molly: { label: "Molly",   color: "#ff7a3d", icon: "M" },
  he:    { label: "HE",      color: "#ff4d5e", icon: "H" },
  decoy: { label: "Decoy",   color: "#b98cff", icon: "D" }
};

const VARIANTS = ["standard", "one-way", "instant", "fake", "pop-flash", "self-flash", "team-flash",
  "support flash", "clear", "denial", "afterplant", "jump-throw", "run-throw", "bounce", "fake execute"];
const PURPOSES = ["execute", "default", "retake", "afterplant", "anti-eco", "lurk", "save", "fake", "cross", "delay"];
const TECHNIQUES = ["left click", "right click", "left+right", "jump-throw", "run-throw", "run+jump-throw", "crouch", "standing"];
