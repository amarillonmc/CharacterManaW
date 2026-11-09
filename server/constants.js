export const APP_NAME = 'キャラクターなんとか機 Web';
export const APP_VERSION = '0.1.0';

export const DATA_DIR = 'data';
export const DEFAULT_TEMPLATE_ID = 'default';

// The original render order.  Optional duplicate face/eye layers are inserted
// around the hair according to the eye_layer / face_layer settings.
export const BASE_LAYER_ORDER = [
  'accessory_back',
  'hair_back',
  'hair_back_accessory',
  'body_back',
  'accessory_underwear',
  'body_front',
  'body_front_color',
  'body_front_accessory',
  'accessory_middle_back',
  'head',
  'accessory_middle_front',
  'face_back',
  'hair_front',
  'hair_front_accessory',
  'accessory_front',
];

export const ACCESSORY_LAYERS = [
  'accessory_back',
  'accessory_underwear',
  'accessory_middle_back',
  'accessory_middle_front',
  'accessory_front',
];

export const CATEGORIES = [
  {
    id: 'hair_front',
    listLayer: 'hair_front',
    layers: ['hair_front', 'hair_front_accessory'],
    label: { ja: '髪型 - 手前', zh: '发型 - 前发', en: 'Hair - Front' },
  },
  {
    id: 'hair_back',
    listLayer: 'hair_back',
    layers: ['hair_back', 'hair_back_accessory'],
    label: { ja: '髪型 - 後ろ', zh: '发型 - 后发', en: 'Hair - Back' },
  },
  {
    id: 'head',
    listLayer: 'head',
    layers: ['head'],
    label: { ja: '頭', zh: '头部', en: 'Head' },
  },
  {
    id: 'face',
    listLayer: 'face_front',
    layers: ['face_front', 'face_back', 'face_haircolor'],
    label: { ja: '表情', zh: '表情', en: 'Expression' },
  },
  {
    id: 'eye',
    listLayer: 'eye',
    layers: ['eye', 'eye_color'],
    label: { ja: '目', zh: '眼睛', en: 'Eyes' },
  },
  {
    id: 'body',
    listLayer: 'body_back',
    layers: ['body_back', 'body_front', 'body_front_color', 'body_front_accessory'],
    label: { ja: '身体', zh: '身体 / 服装', en: 'Body / Outfit' },
  },
  {
    id: 'accessory',
    listLayer: 'accessory_back',
    layers: ACCESSORY_LAYERS,
    multiple: true,
    label: { ja: 'アクセサリー', zh: '饰品', en: 'Accessories' },
  },
];

// The 0..7 palette in the original.  The values are not ordinary RGB colours:
// imgctl's ReplaceDIB treats each argument modulo 3 as a source channel index.
export const STANDARD_PALETTE = [
  { key: 'blue', args: [255, 255, 128], channels: [0, 0, 2] },
  { key: 'violet', args: [128, 255, 128], channels: [2, 0, 2] },
  { key: 'red', args: [128, 255, 255], channels: [2, 0, 0] },
  { key: 'yellow', args: [128, 128, 255], channels: [2, 2, 0] },
  { key: 'green', args: [255, 128, 255], channels: [0, 2, 0] },
  { key: 'cyan', args: [255, 128, 128], channels: [0, 2, 2] },
  { key: 'black', args: [0, 0, 0], channels: [0, 0, 0] },
  { key: 'white', args: [128, 128, 128], channels: [2, 2, 2] },
];

// Original gray presets: +3/+2/+1/standard/-1/-2/-3.
export const GRAY_CONTRAST = [0, 32, 64, 128, 192, 224, 255];
export const MONO_GAMMA_OVERRIDE = [1750, 1500, 1250, 1000, 850, 700, 550];

// Skin presets.  "skin_gray" is a gamma value in the original implementation.
export const SKIN_SHADE = [
  [1000, 1000, 1000],
  [900, 700, 700],
  [1050, 1050, 1000],
  [1200, 950, 950],
  [1200, 1050, 1200],
  [750, 750, 1500],
];
export const SKIN_GAMMA = [1600, 1400, 1200, 1000, 900, 800, 700];

export const DEFAULT_CONFIG = {
  character: 'default',
  profile_save: 1,
  jpeg_quality: 80,
  no_antialiasing: 2,
  window_resize: 1,
  parts_list: 0,
  random_option: [1, 0, 1, 1, 1, 0, 1, 0],
  eye_layer: 0,
  face_layer: 0,
  preview_wait: 10,
  accessory_max: 6,
};

export const ANTIALIASING_THRESHOLD = [5, 55, 105, 156, 201, 252];

export const MARKERS = [
  { key: 'hair', re: /[（(]髪[）)]/ },
  { key: 'eye', re: /[（(]瞳[）)]/ },
  { key: 'skin', re: /[（(]肌[）)]/ },
  { key: 'body', re: /[（(]服[）)]/ },
];

export const LOCALES = ['ja', 'zh', 'en'];
