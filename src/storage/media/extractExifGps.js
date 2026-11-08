/**
 * Pure JavaScript EXIF GPS parser.
 * Extracts GPS coordinates (latitude, longitude, altitude, timestamp) from raw EXIF buffer
 * provided by Sharp (meta.exif), supporting both Little-Endian (II) and Big-Endian (MM) TIFF headers.
 */

function readRational(buf, offset, isLE) {
  if (offset + 8 > buf.length) return 0;
  const num = isLE ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
  const den = isLE ? buf.readUInt32LE(offset + 4) : buf.readUInt32BE(offset + 4);
  if (den === 0) return 0;
  return num / den;
}

/**
 * Extract GPS coordinates from EXIF buffer.
 * @param {Buffer} exifBuffer
 * @returns {{ latitude: number, longitude: number, altitude?: number, timestamp?: string }|null}
 */
export function extractExifGps(exifBuffer) {
  if (!Buffer.isBuffer(exifBuffer) || exifBuffer.length < 14) return null;

  try {
    let tiffStart = 0;
    // Strip leading 'Exif\0\0' if present
    if (
      exifBuffer.length >= 6 &&
      exifBuffer[0] === 0x45 &&
      exifBuffer[1] === 0x78 &&
      exifBuffer[2] === 0x69 &&
      exifBuffer[3] === 0x66 &&
      exifBuffer[4] === 0x00 &&
      exifBuffer[5] === 0x00
    ) {
      tiffStart = 6;
    }

    if (tiffStart + 8 > exifBuffer.length) return null;

    // Check endianness
    const b0 = exifBuffer[tiffStart];
    const b1 = exifBuffer[tiffStart + 1];
    let isLE = false;
    if (b0 === 0x49 && b1 === 0x49) {
      isLE = true; // Little-endian 'II'
    } else if (b0 === 0x4D && b1 === 0x4D) {
      isLE = false; // Big-endian 'MM'
    } else {
      return null; // Not valid TIFF
    }

    const readU16 = (o) => (isLE ? exifBuffer.readUInt16LE(o) : exifBuffer.readUInt16BE(o));
    const readU32 = (o) => (isLE ? exifBuffer.readUInt32LE(o) : exifBuffer.readUInt32BE(o));

    // Magic number 42
    const magic = readU16(tiffStart + 2);
    if (magic !== 42) return null;

    // Offset to IFD0
    const ifd0Offset = readU32(tiffStart + 4);
    let ifd0Pos = tiffStart + ifd0Offset;
    if (ifd0Pos + 2 > exifBuffer.length) return null;

    const ifd0Entries = readU16(ifd0Pos);
    ifd0Pos += 2;

    let gpsIfdOffset = null;
    for (let i = 0; i < ifd0Entries; i++) {
      const entryPos = ifd0Pos + i * 12;
      if (entryPos + 12 > exifBuffer.length) break;
      const tag = readU16(entryPos);
      if (tag === 0x8825) {
        // GPSInfo pointer
        gpsIfdOffset = readU32(entryPos + 8);
        break;
      }
    }

    if (gpsIfdOffset == null) return null;

    let gpsPos = tiffStart + gpsIfdOffset;
    if (gpsPos + 2 > exifBuffer.length) return null;

    const gpsEntries = readU16(gpsPos);
    gpsPos += 2;

    let latRef = 'N';
    let latDms = null;
    let lngRef = 'E';
    let lngDms = null;
    let altRef = 0;
    let altitudeVal = null;
    let gpsDate = null;
    let gpsTime = null;

    for (let i = 0; i < gpsEntries; i++) {
      const entryPos = gpsPos + i * 12;
      if (entryPos + 12 > exifBuffer.length) break;

      const tag = readU16(entryPos);
      const type = readU16(entryPos + 2);
      const count = readU32(entryPos + 4);

      // Value location: inline if <= 4 bytes, otherwise offset from tiffStart
      const dataSize = (type === 1 || type === 2 || type === 7) ? count : (type === 3 ? count * 2 : (type === 4 ? count * 4 : (type === 5 ? count * 8 : count)));
      const valuePos = dataSize <= 4 ? entryPos + 8 : tiffStart + readU32(entryPos + 8);

      if (valuePos + dataSize > exifBuffer.length) continue;

      if (tag === 0x0001) {
        // GPSLatitudeRef
        latRef = String.fromCharCode(exifBuffer[valuePos] || 78).toUpperCase();
      } else if (tag === 0x0002) {
        // GPSLatitude: 3 rationals (deg, min, sec)
        if (count >= 3 && valuePos + 24 <= exifBuffer.length) {
          const d = readRational(exifBuffer, valuePos, isLE);
          const m = readRational(exifBuffer, valuePos + 8, isLE);
          const s = readRational(exifBuffer, valuePos + 16, isLE);
          latDms = { d, m, s };
        }
      } else if (tag === 0x0003) {
        // GPSLongitudeRef
        lngRef = String.fromCharCode(exifBuffer[valuePos] || 69).toUpperCase();
      } else if (tag === 0x0004) {
        // GPSLongitude: 3 rationals
        if (count >= 3 && valuePos + 24 <= exifBuffer.length) {
          const d = readRational(exifBuffer, valuePos, isLE);
          const m = readRational(exifBuffer, valuePos + 8, isLE);
          const s = readRational(exifBuffer, valuePos + 16, isLE);
          lngDms = { d, m, s };
        }
      } else if (tag === 0x0005) {
        // GPSAltitudeRef (0 = above sea level, 1 = below sea level)
        altRef = exifBuffer[valuePos] || 0;
      } else if (tag === 0x0006) {
        // GPSAltitude: 1 rational
        altitudeVal = readRational(exifBuffer, valuePos, isLE);
      } else if (tag === 0x001d) {
        // GPSDateStamp: "YYYY:MM:DD"
        gpsDate = exifBuffer.toString('ascii', valuePos, valuePos + Math.min(count, 11)).replace(/\0.*$/, '').trim();
      } else if (tag === 0x0007) {
        // GPSTimeStamp: 3 rationals (h, m, s)
        if (count >= 3 && valuePos + 24 <= exifBuffer.length) {
          const h = Math.floor(readRational(exifBuffer, valuePos, isLE));
          const min = Math.floor(readRational(exifBuffer, valuePos + 8, isLE));
          const sec = Math.floor(readRational(exifBuffer, valuePos + 16, isLE));
          gpsTime = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        }
      }
    }

    if (!latDms || !lngDms) return null;

    let latitude = latDms.d + latDms.m / 60 + latDms.s / 3600;
    if (latRef === 'S') latitude = -latitude;

    let longitude = lngDms.d + lngDms.m / 60 + lngDms.s / 3600;
    if (lngRef === 'W') longitude = -longitude;

    // Check validity
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

    const result = {
      latitude: Number(latitude.toFixed(6)),
      longitude: Number(longitude.toFixed(6)),
    };

    if (altitudeVal != null && Number.isFinite(altitudeVal)) {
      result.altitude = Number((altRef === 1 ? -altitudeVal : altitudeVal).toFixed(2));
    }

    if (gpsDate && gpsTime) {
      const isoDate = gpsDate.replace(/:/g, '-');
      result.timestamp = `${isoDate}T${gpsTime}Z`;
    }

    return result;
  } catch (err) {
    console.warn(`[media:exif] GPS extraction failed: ${err?.message || err}`);
    return null;
  }
}

