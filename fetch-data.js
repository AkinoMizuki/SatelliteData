import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import * as core from '@actions/core';
import { PNG } from 'pngjs';
import { Buffer } from 'node:buffer';

const PAGES_DIRECTORY_PATH = './_site/';

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
