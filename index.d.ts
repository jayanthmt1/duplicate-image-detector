/// <reference types="node" />

export type Bytes = Buffer | Uint8Array | ArrayBuffer;

/** 8 bits per sample, row-major, channels interleaved. 1 = gray, 2 = gray+alpha, 3 = RGB, 4 = RGBA. */
export interface RawImage {
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
  data: Uint8Array | Uint8ClampedArray;
}

export interface DecodeOptions {
  /**
   * Refuse images with more pixels than this. Default 100,000,000 (about 400 MB decoded).
   * For untrusted uploads on a server, pass 20,000,000 or lower.
   */
  maxPixels?: number;
  /** PNG: verify chunk CRCs. Default false. */
  checkCrc?: boolean;
  /** JPEG: rotate/flip according to the EXIF orientation tag. Default true. */
  autoOrient?: boolean;
}

export type Method =
  | 'fileSha' | 'pixelSha'
  | 'ahash64' | 'dhash64' | 'dhash256' | 'phash64'
  | 'goldberg' | 'ink16' | 'inkmap32' | 'chamfer64' | 'edgehist';
export type Preset = 'none' | 'photo' | 'lineart' | 'scan';

/** Per-option overrides of a preset. */
export interface NormalizeOptions {
  /** Shrink so the long side is at most this many pixels. */
  maxSide?: number;
  /** photo: trim borders within this gray distance of the corner colour. */
  trimBorder?: number | false;
  /** Divide out uneven paper shading. */
  background?: boolean;
  /** 3x3 median before thresholding (erases one-pixel lines). */
  denoise?: boolean;
  binarize?: 'otsu' | 'sauvola';
  /** Level text lines within +/- 5 degrees. */
  deskew?: boolean;
  /** Drop ink blobs smaller than this many pixels ('auto' scales with size). */
  speckle?: number | 'auto';
  /** Pad the trimmed ink to a square (true) or stretch it to the square grid (false). */
  square?: boolean;
  /** Output side in pixels. */
  size?: number;
  /** 'normalize' thins strokes to a skeleton and redraws them strokeWidth wide. */
  stroke?: 'keep' | 'normalize';
  strokeWidth?: number;
}

export interface FingerprintOptions extends DecodeOptions {
  /** Default ['fileSha', 'pixelSha', 'dhash64']. */
  methods?: Method[];
  /** Normalisation preset for the perceptual methods. Default 'none'. */
  preset?: Preset;
  /** Preset overrides; recorded in fp.preset, e.g. "lineart(size=128)". */
  normalize?: NormalizeOptions;
}

export interface Fingerprint {
  /** Fingerprint format version; only compare fingerprints with the same version. */
  v: number;
  /** Preset id, including any overrides. */
  preset: string;
  /** Size of the upright decoded image. */
  w: number;
  h: number;
  /** SHA-256 of the file bytes (absent for raw pixel input). */
  fileSha?: string;
  /** SHA-256 of canonical RGB pixels: the safe exact match across file formats. */
  pixelSha?: string;
  ahash64?: string;
  dhash64?: string;
  dhash256?: string;
  phash64?: string;
  /** Goldberg image signature, 648 values in base 5 (432 hex digits). */
  goldberg?: string;
  /** 16x16 ink density grid (512 hex digits). */
  ink16?: string;
  /** 32x32 ink bit map (256 hex digits), compared by overlap with tolerance. */
  inkmap32?: string;
  /** 64x64 ink bit map (1024 hex digits), compared by symmetric truncated chamfer distance. */
  chamfer64?: string;
  /** 4x4 grid of 8-bin edge-orientation histograms (256 hex digits), normalised L2. */
  edgehist?: string;
}

/** true/false for exact methods; similarity 0..1 (1 = identical) for the rest, null across presets. */
export type Comparison = { fileSha?: boolean; pixelSha?: boolean } & {
  [M in Exclude<Method, 'fileSha' | 'pixelSha'>]?: number | null;
};

export interface BandKeyOptions {
  /** Number of bands (default 4). Two hashes within bands-1 bits share at least one key. */
  bands?: number;
  /** Alternative to bands: bits per band. */
  bitsPerBand?: number;
  /** Prepended to every key, e.g. "d64:". */
  prefix?: string;
}

export interface CommonBand {
  key: string;
  count: number;
  share: number;
}

export type VariantKind =
  | 'resize-down' | 'resize-up' | 'margin' | 'crop' | 'noise' | 'grey-background'
  | 'blur' | 'rotate' | 'thicker' | 'thinner' | 'scan-like';

export type EvalItem = Bytes | RawImage | Fingerprint;
export type Pair = [EvalItem, EvalItem] | { a: EvalItem; b: EvalItem; kind?: string };

export interface EvaluateOptions {
  /** Default: every method except fileSha. */
  methods?: Method[];
  /** Default ['none']. Ignored for items that are already fingerprints. */
  presets?: Preset[];
  /** Default 0.01. */
  targetFalseRate?: number;
  /** Which pairs set the threshold. Default 'random' (or 'different' when there are no random pairs). */
  calibrateOn?: 'random' | 'different' | 'both';
  /** ['ssim'] also scores SSIM on the normalised images. */
  imageMethods?: 'ssim'[];
  normalize?: NormalizeOptions;
  maxPixels?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface FalseMatches { count: number; total: number; rate: number | null }

export interface MethodResult {
  method: string;
  preset: string;
  /** Share of "same" pairs matched at the chosen threshold. */
  recall: number;
  matched: number;
  total: number;
  /** A pair matches when its score is >= threshold; null if nothing can match. */
  threshold: number | null;
  falseMatches: { random: FalseMatches; different: FalseMatches };
  /** Recall per variant kind, when pairs carry a kind. */
  byKind?: Record<string, { matched: number; total: number }>;
  table: { targetRate: number; threshold: number | null; recall: number | null; randomRate: number | null; differentRate: number | null }[];
}

export interface EvaluateResult {
  targetFalseRate: number;
  calibrateOn: string;
  counts: { same: number; different: number; random: number };
  /** Best recall first. */
  results: MethodResult[];
}

// decoding
export function decode(input: Bytes | RawImage, opts?: DecodeOptions): RawImage;
export function decodePng(buf: Buffer, opts?: DecodeOptions): RawImage;
export function decodeJpeg(buf: Buffer, opts?: DecodeOptions): RawImage & { orientation: number };
/** First frame on the logical screen; RGBA when anything is transparent. */
export function decodeGif(buf: Buffer, opts?: DecodeOptions): RawImage;
export function decodeBmp(buf: Buffer, opts?: DecodeOptions): RawImage;
export function sniffFormat(input: Bytes): 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | null;
/** Minimal 8-bit PNG writer, for debugging. */
export function encodePng(img: RawImage): Buffer;

// image operations
export function flatten(img: RawImage): RawImage;
export function toGray(img: RawImage): RawImage;
export function resize(img: RawImage, width: number, height: number): RawImage;
export function limitSize(img: RawImage, maxSide: number): RawImage;
export function applyOrientation(img: RawImage, orientation: number): RawImage;
export function crop(img: RawImage, x: number, y: number, width: number, height: number): RawImage;
export function pad(
  img: RawImage,
  opts?: { top?: number; right?: number; bottom?: number; left?: number; background?: number | number[] },
): RawImage;
export function padToSquare(img: RawImage, background?: number | number[]): RawImage;
/** Clockwise, bilinear; the canvas grows to fit. */
export function rotate(img: RawImage, degrees: number, opts?: { background?: number | number[] }): RawImage;
export function trimBorder(img: RawImage, tolerance?: number): RawImage;
export function gaussianBlur(img: RawImage, sigma?: number): RawImage;
export function medianFilter(img: RawImage, radius?: number): RawImage;
export function minFilter(img: RawImage, radius?: number): RawImage;
export function maxFilter(img: RawImage, radius?: number): RawImage;

// normalisation
export function normalize(img: RawImage, preset?: Preset, overrides?: NormalizeOptions): RawImage;
export function normalize(
  img: RawImage,
  preset: Preset,
  overrides: NormalizeOptions | undefined,
  opts: { details: true },
): { image: RawImage; details: Record<string, unknown> };
/** Pixels <= the threshold are ink; -1 for a flat image. */
export function otsuThreshold(img: RawImage, minContrast?: number): number;
/** Clockwise skew in degrees of an ink mask { width, height, data (1 = ink) }. */
export function estimateSkew(
  mask: { width: number; height: number; data: Uint8Array },
  opts?: { maxAngle?: number; step?: number; fine?: number },
): number;

// hashes and signatures
export function fileSha(buf: Bytes): string;
export function pixelSha(img: RawImage): string;
export function dhash(img: RawImage, cols?: number, rows?: number): string;
export function dhash64(img: RawImage): string;
export function ahash64(img: RawImage): string;
export function phash64(img: RawImage): string;
export function goldberg(img: RawImage): string;
export function goldbergSimilarity(a: string, b: string): number;
export function inkGrid(img: RawImage, size?: number): string;
export function inkGridSimilarity(a: string, b: string): number;
export function inkMap(img: RawImage, size?: number, threshold?: number): string;
export function inkOverlap(a: string, b: string, tolerance?: number): number;
/** Mean SSIM after resizing both to size x size; for verification only. */
export function ssim(a: RawImage, b: RawImage, opts?: { size?: number; window?: number; stride?: number }): number;
/** Squared Euclidean distance to the nearest ink pixel (1 = ink); 1e20 where there is no ink. */
export function distanceTransform(mask: { width: number; height: number; data: Uint8Array }): Float64Array;
/** Chamfer similarity 1 / (1 + d) of two images via 64x64 ink maps. */
export function chamfer(a: RawImage, b: RawImage): number;
export function chamferSimilarity(a: string, b: string, cap?: number): number;
export function edgeHistogram(img: RawImage): string;
export function edgeSimilarity(a: string, b: string): number;
export function hamming(a: string, b: string): number;
export function hammingSimilarity(a: string, b: string): number;

// fingerprints
export function fingerprint(input: Bytes | RawImage, opts?: FingerprintOptions): Fingerprint;
export function compare(a: Fingerprint, b: Fingerprint): Comparison;
export const FINGERPRINT_VERSION: number;
export const METHODS: Method[];
export const DEFAULT_METHODS: Method[];
export const PRESETS: Preset[];

// batches (worker threads)
export interface Pool {
  /** Number of worker threads (0 = runs on the calling thread). */
  size: number;
  /** A string input is a file path, read inside the worker. */
  fingerprint(input: string | Bytes | RawImage, opts?: FingerprintOptions): Promise<Fingerprint>;
  close(): Promise<void>;
}
/** workers: default 2, capped at the number of CPUs. */
export function createPool(opts?: { workers?: number }): Pool;
export type BatchResult = { fp: Fingerprint; error?: undefined } | { error: string; fp?: undefined };
export function fingerprintMany(
  items: Iterable<string | Bytes | RawImage>,
  opts?: FingerprintOptions,
  batch?: { workers?: number; onResult?: (index: number, result: BatchResult) => void; onProgress?: (done: number, total: number) => void },
): Promise<BatchResult[]>;
/**
 * Exact groups by pixelSha, then near candidates by bit-hash similarity (default dhash64 >= 0.78).
 * search 'auto' compares every pair up to maxAllPairs (20,000) images, otherwise uses band keys.
 */
export function findDuplicates<Id = string>(
  items: { id: Id; fp: Fingerprint }[],
  opts?: {
    method?: 'ahash64' | 'dhash64' | 'dhash256' | 'phash64'; threshold?: number;
    search?: 'auto' | 'all' | 'bands'; maxAllPairs?: number;
    bands?: number; skipCommon?: boolean; maxShare?: number;
  },
): {
  exact: Id[][];
  near: { a: Id; b: Id; similarity: number }[];
  /** Exact groups and near pairs joined transitively, largest first. */
  clusters: Id[][];
  search: 'all' | 'bands';
  skippedKeys: CommonBand[];
};

// decisions: tiers, a growable match index, clusters
export type Tier = 'exact' | 'likely' | 'possible' | 'none';
export interface Thresholds {
  likely: { dhash64?: number; ahash64?: number };
  possible: { dhash64?: number; ahash64?: number };
}
export interface MatchDecision {
  /** exact = identical pixels (safe to automate); likely/possible = for review only. */
  tier: Tier;
  scores: { dhash64: number | null; ahash64: number | null };
  /** null when the two fingerprints used different presets. */
  preset: string | null;
  /** Why this tier, e.g. "dhash64 0.891 (57/64 bits agree) >= likely 0.8". */
  reasons: string[];
  thresholds: Thresholds;
}
/** Defaults measured on real exam-question pairs with the scan preset. */
export const DEFAULT_THRESHOLDS: Readonly<Thresholds>;
export const TIERS: Tier[];
export function classifyMatch(a: Fingerprint, b: Fingerprint, opts?: { thresholds?: Partial<Thresholds> }): MatchDecision;

export interface Match<Id = string> {
  id: Id;
  tier: Exclude<Tier, 'none'>;
  scores: { dhash64: number | null; ahash64: number | null };
  reasons: string[];
}
export interface MatchIndex<Id = string> {
  readonly size: number;
  /** Taken from the first fingerprint added (or opts.preset); every fingerprint must match it. */
  readonly preset: string | null;
  readonly thresholds: Thresholds;
  add(id: Id, fp: Fingerprint): MatchIndex<Id>;
  addMany(items: Iterable<{ id: Id; fp: Fingerprint } | [Id, Fingerprint]>): MatchIndex<Id>;
  remove(id: Id): boolean;
  has(id: Id): boolean;
  /** Best first: exact, then likely, then possible (each by highest score). */
  query(fp: Fingerprint, opts?: { k?: number; minTier?: 'exact' | 'likely' | 'possible'; excludeId?: Id }): Match<Id>[];
}
export function createMatchIndex<Id = string>(opts?: { thresholds?: Partial<Thresholds>; preset?: Preset }): MatchIndex<Id>;
/** Union-find over pairs (and known groups): connected ids, largest group first, singletons left out. */
export function groupDuplicates<Id = string>(pairs?: ({ a: Id; b: Id } | [Id, Id])[], groups?: Id[][]): Id[][];

// brute-force nearest-match search over bit hashes
export interface NearestMatch<Id = string | number> { index: number; id: Id; distance: number; similarity: number }
export interface HammingIndex<Id = string | number> {
  readonly size: number;
  readonly bits: number;
  /** Memory used by the packed hashes (8 bytes per 64-bit hash, plus spare room after add()). */
  readonly bytes: number;
  /** Add a hash; returns its position. The index grows without rebuilding. */
  add(hash: string | { id?: Id; hash: string }): number;
  /** Remove every entry with this id; returns how many were removed. */
  remove(id: Id): number;
  /** Every hash with similarity >= minSimilarity, best first. */
  within(query: string, minSimilarity: number): NearestMatch<Id>[];
  /** The k most similar hashes (default 10) with similarity >= minSimilarity, best first. */
  nearest(query: string, opts?: { k?: number; minSimilarity?: number }): NearestMatch<Id>[];
  /** Every pair with similarity >= minSimilarity (default 0.8). */
  pairs(opts?: { minSimilarity?: number }): { a: Id; b: Id; distance: number; similarity: number }[];
}
/** Pack hashes (hex strings or { id, hash }) once for repeated searches. */
export function createHammingIndex<Id = string | number>(
  hashes?: Iterable<string | { id?: Id; hash: string }>,
  opts?: { bits?: number },
): HammingIndex<Id>;
/** One-off brute-force search: about 1 ms per query over 180k 64-bit hashes. */
export function nearestByHamming<Id = string | number>(
  query: string,
  hashes: Iterable<string | { id?: Id; hash: string }>,
  opts?: { k?: number; minSimilarity?: number },
): NearestMatch<Id>[];

// search keys
export function bandKeys(hash: string, opts?: BandKeyOptions): string[];
export function findCommonBands(
  items: Iterable<string[]>,
  opts?: { maxShare?: number; minCount?: number },
): CommonBand[];

// evaluation
export function evaluate(
  sets: { same: Pair[]; different?: Pair[]; random?: Pair[] },
  opts?: EvaluateOptions,
): EvaluateResult;
export function formatReport(result: EvaluateResult, opts?: { kinds?: boolean }): string;
export function evaluateFolder(
  paths: string | string[],
  opts?: {
    limit?: number; randomPairs?: number; seed?: number; minSide?: number; presets?: Preset[]; methods?: Method[];
    kinds?: VariantKind[]; normalize?: NormalizeOptions; targetFalseRate?: number; onProgress?: (done: number, limit: number) => void;
  },
): EvaluateResult & { images: number };
/** Image files (png, jpg, jpeg, gif, bmp) under the given files and folders, sorted. */
export function listImages(paths: string | string[]): string[];
export function variants(img: RawImage, opts?: { kinds?: VariantKind[]; seed?: number }): { kind: VariantKind; image: RawImage }[];
export function makeVariant(img: RawImage, kind: VariantKind, rnd?: () => number): RawImage;
export function makeEvalSet(
  images: (RawImage | Bytes)[],
  opts?: { kinds?: VariantKind[]; seed?: number; randomPairs?: number; decode?: (x: RawImage | Bytes) => RawImage },
): { same: { a: RawImage; b: RawImage; kind: VariantKind }[]; random: { a: RawImage; b: RawImage; kind: VariantKind }[] };
export const VARIANT_KINDS: VariantKind[];

declare const ic: {
  decode: typeof decode; decodePng: typeof decodePng; decodeJpeg: typeof decodeJpeg;
  decodeGif: typeof decodeGif; decodeBmp: typeof decodeBmp;
  distanceTransform: typeof distanceTransform; chamfer: typeof chamfer; chamferSimilarity: typeof chamferSimilarity;
  edgeHistogram: typeof edgeHistogram; edgeSimilarity: typeof edgeSimilarity;
  createPool: typeof createPool; fingerprintMany: typeof fingerprintMany; findDuplicates: typeof findDuplicates;
  createHammingIndex: typeof createHammingIndex; nearestByHamming: typeof nearestByHamming;
  classifyMatch: typeof classifyMatch; createMatchIndex: typeof createMatchIndex; groupDuplicates: typeof groupDuplicates;
  DEFAULT_THRESHOLDS: typeof DEFAULT_THRESHOLDS; TIERS: typeof TIERS;
  evaluateFolder: typeof evaluateFolder; listImages: typeof listImages;
  sniffFormat: typeof sniffFormat; encodePng: typeof encodePng;
  flatten: typeof flatten; toGray: typeof toGray; resize: typeof resize; limitSize: typeof limitSize;
  applyOrientation: typeof applyOrientation; crop: typeof crop; pad: typeof pad; padToSquare: typeof padToSquare;
  rotate: typeof rotate; trimBorder: typeof trimBorder; gaussianBlur: typeof gaussianBlur;
  medianFilter: typeof medianFilter; minFilter: typeof minFilter; maxFilter: typeof maxFilter;
  normalize: typeof normalize; otsuThreshold: typeof otsuThreshold; estimateSkew: typeof estimateSkew;
  fileSha: typeof fileSha; pixelSha: typeof pixelSha; dhash: typeof dhash; dhash64: typeof dhash64;
  ahash64: typeof ahash64; phash64: typeof phash64; goldberg: typeof goldberg;
  goldbergSimilarity: typeof goldbergSimilarity; inkGrid: typeof inkGrid; inkGridSimilarity: typeof inkGridSimilarity;
  inkMap: typeof inkMap; inkOverlap: typeof inkOverlap; ssim: typeof ssim;
  hamming: typeof hamming; hammingSimilarity: typeof hammingSimilarity;
  fingerprint: typeof fingerprint; compare: typeof compare; FINGERPRINT_VERSION: typeof FINGERPRINT_VERSION;
  METHODS: typeof METHODS; DEFAULT_METHODS: typeof DEFAULT_METHODS; PRESETS: typeof PRESETS;
  bandKeys: typeof bandKeys; findCommonBands: typeof findCommonBands;
  evaluate: typeof evaluate; formatReport: typeof formatReport; variants: typeof variants;
  makeVariant: typeof makeVariant; makeEvalSet: typeof makeEvalSet; VARIANT_KINDS: typeof VARIANT_KINDS;
};
export default ic;
