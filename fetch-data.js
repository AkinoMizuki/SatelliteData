import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import * as core from '@actions/core';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';

const PAGES_DIRECTORY_PATH = './_site/';

const SPACECRAFT_DEFAULT_START_OFFSET_DAYS = 0;
const SPACECRAFT_DEFAULT_STOP_OFFSET_DAYS = 8;
const MILLISECONDS_PER_DAY = 86400000;

function formatUtcDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * MILLISECONDS_PER_DAY);
}

function normalizeQuotedParameter(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.replace(/^'+|'+$/g, '');
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }

  values.push(value.trim());
  return values;
}

function parseHorizonsVectorSamples(resultText) {
  if (typeof resultText !== 'string') {
    throw new Error('Horizons APIのresultが文字列ではありません。');
  }

  const startMarker = '$$SOE';
  const endMarker = '$$EOE';
  const startIndex = resultText.indexOf(startMarker);
  const endIndex = resultText.indexOf(endMarker, startIndex + startMarker.length);

  if (startIndex < 0 || endIndex < 0) {
    throw new Error('Horizons APIのresultに$$SOE/$$EOEがありません。');
  }

  const dataText = resultText.slice(startIndex + startMarker.length, endIndex);
  const samples = [];

  for (const line of dataText.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const columns = parseCsvLine(line);
    if (columns.length < 8) {
      continue;
    }

    const jd = Number(columns[0]);
    const x = Number(columns[2]);
    const y = Number(columns[3]);
    const z = Number(columns[4]);
    const vx = Number(columns[5]);
    const vy = Number(columns[6]);
    const vz = Number(columns[7]);

    if (![jd, x, y, z, vx, vy, vz].every(Number.isFinite)) {
      continue;
    }

    samples.push([jd, x, y, z, vx, vy, vz]);
  }

  if (samples.length === 0) {
    throw new Error('Horizons APIのresultから状態ベクトルを取得できませんでした。');
  }

  return samples;
}

async function fetchJsonObject(url) {
  const response = await fetch(url);
  const responseText = await response.text();

  if (!response.ok) {
    throw new Error(`${url} の取得に失敗しました。HTTP ${response.status}: ${responseText.slice(0, 500)}`);
  }

  let parsed;

  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`${url} からJSONではないデータが返りました: ${responseText.slice(0, 500)}`);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${url} からJSONオブジェクトではないデータが返りました。`);
  }

  if (typeof parsed.error === 'string' && parsed.error.length > 0) {
    throw new Error(`${url} のHorizons APIエラー: ${parsed.error}`);
  }

  return parsed;
}

function resolveSpacecraftUrl(entry, now) {
  const startOffsetDays = Number.isFinite(entry.startOffsetDays)
    ? entry.startOffsetDays
    : SPACECRAFT_DEFAULT_START_OFFSET_DAYS;
  const stopOffsetDays = Number.isFinite(entry.stopOffsetDays)
    ? entry.stopOffsetDays
    : SPACECRAFT_DEFAULT_STOP_OFFSET_DAYS;

  if (stopOffsetDays <= startOffsetDays) {
    throw new Error(`${entry.id} のstopOffsetDaysはstartOffsetDaysより大きくしてください。`);
  }

  const startDate = formatUtcDate(addUtcDays(now, startOffsetDays));
  const stopDate = formatUtcDate(addUtcDays(now, stopOffsetDays));
  const requestUrl = new URL(entry.url);

  requestUrl.searchParams.set('START_TIME', `'${startDate}'`);
  requestUrl.searchParams.set('STOP_TIME', `'${stopDate}'`);

  return { url: requestUrl.toString(), startDate, stopDate };
}

function validateSpacecraftEntry(entry, index) {
  if (entry === null || Array.isArray(entry) || typeof entry !== 'object') {
    throw new Error(`spacecraft.yamlの${index + 1}件目がオブジェクトではありません。`);
  }

  for (const property of ['id', 'name', 'url']) {
    if (typeof entry[property] !== 'string' || entry[property].trim().length === 0) {
      throw new Error(`spacecraft.yamlの${index + 1}件目に有効な${property}がありません。`);
    }
  }

  const requestUrl = new URL(entry.url);
  if (requestUrl.searchParams.has('START_TIME') || requestUrl.searchParams.has('STOP_TIME')) {
    throw new Error(`${entry.id} のURLにはSTART_TIMEとSTOP_TIMEを登録しないでください。取得時に自動設定されます。`);
  }
}

/**
 * spacecraft.yaml に書かれたJPL Horizons APIを取得し、
 * UdonSharpで読み取りやすい状態ベクトル配列へ変換する。
 *
 * samplesの並び:
 * [Julian Date TDB, X, Y, Z, VX, VY, VZ]
 */
async function buildSpacecraftJson(pagesDirectory) {
  const yamlUrl = new URL('spacecraft.yaml', import.meta.url);
  const entries = yaml.load(await fs.readFile(yamlUrl, { encoding: 'utf-8' }));

  if (!Array.isArray(entries)) {
    throw new Error('spacecraft.yaml が探査機設定の配列ではありません。');
  }

  const now = new Date();
  const objects = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    validateSpacecraftEntry(entry, i);

    const resolved = resolveSpacecraftUrl(entry, now);
    core.info(`${entry.id} のHorizonsデータを取得します: ${resolved.url}`);

    const payload = await fetchJsonObject(resolved.url);
    const samples = parseHorizonsVectorSamples(payload.result);
    const requestUrl = new URL(resolved.url);
    const parameters = requestUrl.searchParams;

    objects.push({
      id: entry.id,
      name: entry.name,
      source: payload.signature?.source ?? 'NASA/JPL Horizons API',
      apiVersion: payload.signature?.version ?? '',
      command: normalizeQuotedParameter(parameters.get('COMMAND')),
      center: normalizeQuotedParameter(parameters.get('CENTER')),
      referencePlane: normalizeQuotedParameter(parameters.get('REF_PLANE')),
      referenceSystem: normalizeQuotedParameter(parameters.get('REF_SYSTEM')),
      vectorCorrection: normalizeQuotedParameter(parameters.get('VEC_CORR')),
      units: normalizeQuotedParameter(parameters.get('OUT_UNITS')),
      timeType: normalizeQuotedParameter(parameters.get('TIME_TYPE')) || 'TDB',
      startDate: resolved.startDate,
      stopDate: resolved.stopDate,
      stepSize: normalizeQuotedParameter(parameters.get('STEP_SIZE')),
      samples,
    });

    core.info(`${entry.id} の状態ベクトルを${samples.length}件取得しました。`);
  }

  const output = {
    version: 1,
    generatedUtc: now.toISOString(),
    sampleFields: ['jdTdb', 'x', 'y', 'z', 'vx', 'vy', 'vz'],
    objects,
  };

  await fs.writeFile(
    new URL('spacecraft.json', pagesDirectory),
    JSON.stringify(output)
  );

  core.info(`spacecraft.json を出力しました。探査機数: ${objects.length}`);
}


/**
 * CelesTrakのJSONレスポンスを取得して配列として返す
 * 期待形式:
 * [
 *   {
 *     "OBJECT_NAME": "...",
 *     "OBJECT_ID": "...",
 *     "EPOCH": "...",
 *     ...
 *   }
 * ]
 */
async function fetchJsonArray(url) {
  const response = await fetch(url);
  const responseText = await response.text();

  if (!response.ok) {
    core.error(`${url} の取得に失敗しました。HTTP ${response.status}: ${responseText}`);
    return [];
  }

  let parsed;

  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    core.error(`${url} からJSONではないデータが返りました: ${responseText}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    core.error(`${url} から配列JSONではないデータが返りました: ${responseText}`);
    return [];
  }

  return parsed;
}

/**
 * satellites.yaml に書かれた各URLを取得して、
 * 1つのJSON配列にまとめる。
 */
async function buildSatellitesText(pagesDirectory) {
  const yamlUrl = new URL('satellites.yaml', import.meta.url);
  const urls = yaml.load(await fs.readFile(yamlUrl, { encoding: 'utf-8' }));

  if (!Array.isArray(urls)) {
    throw new Error('satellites.yaml がURL配列ではありません。');
  }

  const data = [];

  for (const url of urls) {
    const items = await fetchJsonArray(url);
    data.push(...items);
  }

  // satellites.txt を正しい JSON 配列として出力
  await fs.writeFile(
    new URL('satellites.txt', pagesDirectory),
    JSON.stringify(data)
  );

  core.info(`satellites.txt を出力しました。衛星数: ${data.length}`);

  return data;
}

/**
 * active 全件から satellites.png を生成する。
 * 既存処理を維持。
 */
async function buildSatellitesPng(pagesDirectory) {
  const blockSize = 4;
  const targetSize = 128;

  const obj = await fetchJsonArray('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json');

  const buff = Buffer.alloc(targetSize * blockSize * targetSize * blockSize * 4);
  const currentTime = Date.now();
  const currentTimeIncsThick = BigInt(Date.now()) * 10000n + 621355968000000000n;

  const buff2 = Buffer.alloc(8);
  buff2.writeBigInt64BE(currentTimeIncsThick);

  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 4; j++) {
      buff[(i * blockSize + 3 + (targetSize - 1) * targetSize * blockSize * blockSize) * 4 + j] = buff2[i * 4 + j];
    }
  }

  let idx = 0;

  const writeFloat = (buf, val, idx, x, y) => {
    const ix = idx % targetSize;
    const iy = targetSize - Math.floor(idx / targetSize) - 1;
    const pos = ix * blockSize * 4 + iy * targetSize * blockSize * blockSize * 4;
    const offset = x * 4 + (blockSize - y - 1) * targetSize * blockSize * 4;
    buf.writeFloatBE(Number(val), pos + offset);
  };

  const writeByte = (buf, val, idx, x, y) => {
    const ix = idx % targetSize;
    const iy = targetSize - Math.floor(idx / targetSize) - 1;
    const pos = ix * blockSize * 4 + iy * targetSize * blockSize * blockSize * 4;
    const offset = x * 4 + (blockSize - y - 1) * targetSize * blockSize * 4;
    buf[pos + offset] = val;
  };

  for (const sat of obj) {
    if (idx >= targetSize * targetSize) {
      core.warning(`satellites.png の格納上限 ${targetSize * targetSize} 件を超えたため、残りをスキップします。`);
      break;
    }

    const ep = (currentTime - Date.parse(`${sat.EPOCH}Z`)) / 1000;
    const isStarlink = sat.OBJECT_NAME.indexOf('STARLINK') !== -1;

    writeFloat(buff, ep, idx, 0, 0);
    writeFloat(buff, sat.INCLINATION, idx, 0, 1);
    writeFloat(buff, sat.RA_OF_ASC_NODE, idx, 0, 2);
    writeFloat(buff, sat.ECCENTRICITY, idx, 0, 3);

    writeFloat(buff, sat.ARG_OF_PERICENTER, idx, 1, 0);
    writeFloat(buff, sat.MEAN_ANOMALY, idx, 1, 1);
    writeFloat(buff, sat.MEAN_MOTION, idx, 1, 2);
    writeFloat(buff, sat.BSTAR, idx, 1, 3);

    writeByte(buff, isStarlink ? 2 : 1, idx, 2, 0);

    idx++;
  }

  const png = new PNG({
    colorType: 6,
    bitDepth: 8,
    width: targetSize * blockSize,
    height: targetSize * blockSize,
  });

  png.data = buff;

  await fs.writeFile(new URL('satellites.png', pagesDirectory), PNG.sync.write(png));

  core.info(`satellites.png を出力しました。格納衛星数: ${idx}`);
}

/**
 * Main
 */
const pagesDirectory = new URL(PAGES_DIRECTORY_PATH, import.meta.url);
await fs.mkdir(pagesDirectory, { recursive: true });

await buildSatellitesText(pagesDirectory);
await buildSatellitesPng(pagesDirectory);
await buildSpacecraftJson(pagesDirectory);
