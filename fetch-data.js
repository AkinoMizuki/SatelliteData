import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import * as core from '@actions/core';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';

const PAGES_DIRECTORY_PATH = './_site/';

const HORIZONS_LOOKUP_API_URL = 'https://ssd.jpl.nasa.gov/api/horizons_lookup.api';
const HORIZONS_API_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const SPACECRAFT_STOP_OFFSET_DAYS = 8;
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

function normalizeLookupName(value) {
  return String(value ?? '')
    .replace(/\s*\(spacecraft\)\s*$/i, '')
    .trim()
    .toLowerCase();
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
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`${url} の取得中に通信エラーが発生しました: ${error.message}`);
  }

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
    throw new Error(`${url} のAPIエラー: ${parsed.error}`);
  }

  return parsed;
}

function validateSpacecraftRegistration(id, searchName) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error('出力用IDが空です。');
  }

  if (!/^[A-Za-z0-9_\-]+$/.test(id)) {
    throw new Error(`${id} の出力用IDには半角英数字、_、-だけを使用してください。`);
  }

  if (typeof searchName !== 'string' || searchName.trim().length === 0) {
    throw new Error(`${id} のHorizons検索名が空です。`);
  }
}

async function lookupSpacecraft(searchName) {
  const lookupUrl = new URL(HORIZONS_LOOKUP_API_URL);
  lookupUrl.searchParams.set('format', 'json');
  lookupUrl.searchParams.set('group', 'sct');
  lookupUrl.searchParams.set('sstr', searchName);

  const payload = await fetchJsonObject(lookupUrl.toString());
  const results = Array.isArray(payload.result) ? payload.result : [];

  if (results.length === 0) {
    throw new Error(`Horizons Lookupで「${searchName}」に一致する探査機が見つかりませんでした。`);
  }

  let matches = results;

  if (results.length > 1) {
    const normalizedSearchName = normalizeLookupName(searchName);
    const exactMatches = results.filter((item) => {
      if (normalizeLookupName(item?.name) === normalizedSearchName) {
        return true;
      }

      return Array.isArray(item?.alias)
        && item.alias.some((alias) => normalizeLookupName(alias) === normalizedSearchName);
    });

    if (exactMatches.length === 1) {
      matches = exactMatches;
    }
  }

  if (matches.length !== 1) {
    const candidates = results
      .map((item) => `${item?.name ?? '(名称なし)'} [${item?.spkid ?? 'SPK IDなし'}]`)
      .join(', ');
    throw new Error(`Horizons Lookupで「${searchName}」が複数候補になりました: ${candidates}`);
  }

  const match = matches[0];

  if (typeof match.spkid !== 'string' || match.spkid.trim().length === 0) {
    throw new Error(`Horizons Lookupの「${searchName}」にSPK IDがありません。`);
  }

  return {
    name: typeof match.name === 'string' && match.name.trim().length > 0
      ? match.name.replace(/\s*\(spacecraft\)\s*$/i, '')
      : searchName,
    spkId: match.spkid.trim(),
    lookupSource: payload.signature?.source ?? 'NASA/JPL Horizons Lookup API',
    lookupApiVersion: payload.signature?.version ?? '',
  };
}

function buildHorizonsVectorUrl(spkId, now) {
  const startDate = formatUtcDate(now);
  const stopDate = formatUtcDate(addUtcDays(now, SPACECRAFT_STOP_OFFSET_DAYS));
  const requestUrl = new URL(HORIZONS_API_URL);

  requestUrl.searchParams.set('format', 'json');
  requestUrl.searchParams.set('COMMAND', `'${spkId}'`);
  requestUrl.searchParams.set('OBJ_DATA', "'YES'");
  requestUrl.searchParams.set('MAKE_EPHEM', "'YES'");
  requestUrl.searchParams.set('EPHEM_TYPE', "'VECTORS'");
  requestUrl.searchParams.set('CENTER', "'500@10'");
  requestUrl.searchParams.set('START_TIME', `'${startDate}'`);
  requestUrl.searchParams.set('STOP_TIME', `'${stopDate}'`);
  requestUrl.searchParams.set('STEP_SIZE', "'1h'");
  requestUrl.searchParams.set('REF_PLANE', "'ECLIPTIC'");
  requestUrl.searchParams.set('REF_SYSTEM', "'ICRF'");
  requestUrl.searchParams.set('VEC_CORR', "'NONE'");
  requestUrl.searchParams.set('OUT_UNITS', "'AU-D'");
  requestUrl.searchParams.set('VEC_TABLE', "'2'");
  requestUrl.searchParams.set('CSV_FORMAT', "'YES'");

  return { url: requestUrl.toString(), startDate, stopDate };
}

/**
 * spacecraft.yaml に書かれた「出力用ID: Horizons検索名」を読み、
 * Horizons LookupでSPK IDを自動解決して状態ベクトルを取得する。
 *
 * samplesの並び:
 * [Julian Date TDB, X, Y, Z, VX, VY, VZ]
 */
async function buildSpacecraftJson(pagesDirectory) {
  const yamlUrl = new URL('spacecraft.yaml', import.meta.url);
  const registrations = yaml.load(await fs.readFile(yamlUrl, { encoding: 'utf-8' }));

  if (registrations === null || Array.isArray(registrations) || typeof registrations !== 'object') {
    throw new Error('spacecraft.yaml が「出力用ID: Horizons検索名」のYAMLオブジェクトではありません。');
  }

  const now = new Date();
  const objects = [];
  let skippedCount = 0;

  for (const [id, searchName] of Object.entries(registrations)) {
    try {
      validateSpacecraftRegistration(id, searchName);
      core.info(`${id} をHorizons Lookupで検索します: ${searchName}`);

      const lookup = await lookupSpacecraft(searchName.trim());
      const resolved = buildHorizonsVectorUrl(lookup.spkId, now);
      core.info(`${id} (${lookup.spkId}) のHorizonsデータを取得します: ${resolved.url}`);

      const payload = await fetchJsonObject(resolved.url);
      const samples = parseHorizonsVectorSamples(payload.result);
      const requestUrl = new URL(resolved.url);
      const parameters = requestUrl.searchParams;

      objects.push({
        id,
        name: lookup.name,
        searchName: searchName.trim(),
        source: payload.signature?.source ?? 'NASA/JPL Horizons API',
        apiVersion: payload.signature?.version ?? '',
        lookupSource: lookup.lookupSource,
        lookupApiVersion: lookup.lookupApiVersion,
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

      core.info(`${id} の状態ベクトルを${samples.length}件取得しました。`);
    } catch (error) {
      skippedCount++;
      core.error(`${id} の取得に失敗したため、この探査機だけをスキップします: ${error.message}`);
    }
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

  core.info(`spacecraft.json を出力しました。成功: ${objects.length}件、スキップ: ${skippedCount}件`);
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
  let response;

  try {
    response = await fetch(url);
  } catch (error) {
    core.error(`${url} の取得中に通信エラーが発生しました: ${error.message}`);
    return [];
  }

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
