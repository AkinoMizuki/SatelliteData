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
  const blockSizeX = 4;
  const blockSizeY = 2;
  const limit = 2048 * 2048 / (blockSizeX * blockSizeY) - 1;

  let obj = await fetchJsonArray('https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=json');

  if (obj.length > limit) {
    obj = obj.slice(0, limit);
    core.warning(`satellites.png の格納上限 ${limit} 件を超えたため、残りをスキップします。`);
  }
  // 衛星をstarlinkとそれ以外に分けて、starlinkを前に持ってくる
  obj.sort((a, b) => {
    const aIsStarlink = (a.OBJECT_NAME.indexOf('STARLINK') !== -1);
    const bIsStarlink = (b.OBJECT_NAME.indexOf('STARLINK') !== -1);
    if (aIsStarlink && !bIsStarlink) {
      return -1;
    } else if (!aIsStarlink && bIsStarlink) {
      return 1;
    } else {
      return 0;
    }
  });
  const satellitesCount = obj.length;
  const starlinkCount = obj.filter(sat => sat.OBJECT_NAME.indexOf('STARLINK') !== -1).length;
  const a = Math.ceil(Math.log2(satellitesCount + 1));
  const targetWidth = 2 ** Math.floor(a / 2);
  const targetHeight = 2 ** Math.ceil(a / 2);
  const TLEBuff = Buffer.alloc(targetWidth * blockSizeX * targetHeight * blockSizeY * 4);
  const NameBuff = Buffer.alloc(targetWidth * blockSizeX * targetHeight * blockSizeY * 4);
  const currentTime = Date.now();
  const currentTimeIncsThick = BigInt(Date.now()) * 10000n + 621355968000000000n;
  console.log(satellitesCount + ' satellites');
  console.log(starlinkCount + ' starlinks');
  const dataBuffer = [Buffer.alloc(16),Buffer.alloc(16)];
  dataBuffer[0][0] = 1; // バージョン1
  dataBuffer[0].writeUInt32BE(satellitesCount, 4); // 衛星数
  dataBuffer[0].writeBigInt64BE(currentTimeIncsThick, 8); // 生成日時
  dataBuffer[1].writeUInt32BE(starlinkCount, 0); // starlink数（バージョン1以降で使用）

  // AIS 6bit ASCII
  const NameCharList = [
    '@', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O',
    'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',	'[', '\\', ']', '^', '_',
    ' ', '!', '"', '#', '$', '%', '&', '\'', '(', ')', '*', '+', ',', '-', '.', '/',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',':', ';', '<', '=', '>', '?',
  ];
  const NameCharMap = {};
  NameCharList.forEach((char, index) => {
    NameCharMap[char] = index;
  });


  const writeFloat = (buf, val, idx, x, y) => {
    const ix = idx % targetWidth;
    const iy = targetHeight - Math.floor(idx / targetWidth) - 1;
    const pos = ix * blockSizeX * 4 + iy * targetWidth * blockSizeX * blockSizeY * 4;
    const offset = x * 4 + (blockSizeY - y - 1) * targetWidth * blockSizeX * 4;

    buf.writeFloatBE(val, pos + offset);
  };
  const writeUint = (buf, val, idx, x, y) => {
    const ix = idx % targetWidth;
    const iy = targetHeight - Math.floor(idx / targetWidth) - 1;
    const pos = ix * blockSizeX * 4 + iy * targetWidth * blockSizeX * blockSizeY * 4;
    const offset = x * 4 + (blockSizeY - y - 1) * targetWidth * blockSizeX * 4;

    buf.writeUInt32BE(val, pos + offset);
  };
  const writebyte = (buf, val, idx, x, y, color) => {
    const ix = idx % targetWidth;
    const iy = targetHeight - Math.floor(idx / targetWidth) - 1;
    const pos = ix * blockSizeX * 4 + iy * targetWidth * blockSizeX * blockSizeY * 4;
    const offset = x * 4 + (blockSizeY - y - 1) * targetWidth * blockSizeX * 4;

    buf[pos + offset + color] = val;
  };

  // 共通データをブロックの最後に書き込む
  for (let i = 0; i < blockSizeY; i++) {
    for (let j = 0; j < blockSizeX; j++) {
      for (let k = 0; k < 4; k++) {
        writebyte(TLEBuff, dataBuffer[i].readUInt8(j * 4 + k), targetWidth * targetHeight - 1, j, i, k);
        writebyte(NameBuff, dataBuffer[i].readUInt8(j * 4 + k), targetWidth * targetHeight - 1, j, i, k);
      }
    }
  }
  let idx = 0;
  let maxObjectNameLength = 0;
  for (const sat of obj) {
    const ep = (currentTime - Date.parse(sat.EPOCH + 'Z')) / 1000;

    writeFloat(TLEBuff, ep, idx, 0, 0);
    writeFloat(TLEBuff, sat.INCLINATION, idx, 1, 0);
    writeFloat(TLEBuff, sat.RA_OF_ASC_NODE, idx, 2, 0);
    writeFloat(TLEBuff, sat.ECCENTRICITY, idx, 3, 0);
    writeFloat(TLEBuff, sat.ARG_OF_PERICENTER, idx, 0, 1);
    writeFloat(TLEBuff, sat.MEAN_ANOMALY, idx, 1, 1);
    writeFloat(TLEBuff, sat.MEAN_MOTION, idx, 2, 1);
    writeFloat(TLEBuff, sat.BSTAR, idx, 3, 1);
    if (sat.OBJECT_NAME.length > maxObjectNameLength) {
      maxObjectNameLength = sat.OBJECT_NAME.length;
    }
    if (sat.OBJECT_NAME.length > 40) {
      core.warning(`OBJECT_NAME "${sat.OBJECT_NAME}" is too long and will be truncated.`);
    }
    for (let i = 0; i < 8; i++) {
      let charBuffer = 0;
      // 1pxに6bitを5文字分詰め込む
      for (let j = 0; j < 5; j++) {
        const char = sat.OBJECT_NAME[i * 5 + j] || ' ';
        charBuffer <<= 6;
        charBuffer |= (NameCharMap[char] !== undefined) ? NameCharMap[char] : 0; // サポートされていない文字はスペースとみなす
        if (NameCharMap[char] === undefined) {
          core.warning(`OBJECT_NAME "${sat.OBJECT_NAME}" contains unsupported character "${char}" which will be treated as space.`);
        }
      }
      writeUint(NameBuff, charBuffer, idx, i % blockSizeX, Math.floor(i / blockSizeX));
    }
    idx++;
  }

  const png = new PNG({
    colorType: 6,
    bitDepth: 8,
    width: targetWidth * blockSizeX,
    height: targetHeight * blockSizeY,
  });
  png.data = TLEBuff;
  await fs.writeFile(new URL('satellites.png', pagesDirectory), PNG.sync.write(png));

  const namePng = new PNG({
    colorType: 6,
    bitDepth: 8,
    width: targetWidth * blockSizeX,
    height: targetHeight * blockSizeY,
  });
  namePng.data = NameBuff;
  await fs.writeFile(new URL('satellites_name.png', pagesDirectory), PNG.sync.write(namePng));

  core.info(`satellites.png を出力しました。格納衛星数: ${idx}`);
}

/**
 * Main
 */
const pagesDirectory = new URL(PAGES_DIRECTORY_PATH, import.meta.url);
await fs.mkdir(pagesDirectory, { recursive: true });

await buildSatellitesText(pagesDirectory);
await buildSatellitesPng(pagesDirectory);
