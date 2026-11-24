# Rencana Revisi Final A1 — Versi 3

**Status:** READ-ONLY — menunggu persetujuan sebelum implementasi  
**Tanggal:** 16 November 2026  
**Dasar:** Keputusan D1–D5 + temuan review v1 dan v2 (4 perbaikan terakhir)

---

## Ringkasan Keputusan (Final)

| ID | Topik | Keputusan |
|---|---|---|
| D1 | Malformed horizontal (`abc,2`, `1,`, `,2`) | **Warning** `invalidGeometry`; geometri dibuang *seluruhnya*. Fatal out-of-range/non-finite → error `invalidGeometryCoordinate`. Fatal mengalahkan warning malformed. |
| D2 | Penutupan ring dengan altitude | Ring valid jika horizontal pertama=terakhir. Altitude dibandingkan hanya jika kedua ujung non-null; jika berbeda → Polygon dibuang. Altitude gagal dibaca → geometri dipertahankan, altitude=null, warning `unsupportedGeometryAltitude`. |
| D3 | Flag internal | `hasMalformedHorizontal`, `hasOutOfRangeHorizontal`, `hasNonFiniteHorizontal`, `hasInvalidAltitude`. Tidak ada enum/field publik baru. |
| D4 | Akuntansi (koreksi v2) | Tuple horizontal valid (termasuk yang altitude-nya gagal) tetap dihitung. Outer/inner ring yang ditolak tetap menghabiskan anggaran Polygon. Batas inner ring memperhitungkan outer ring. I8-a: LineString yang ditolak tidak menambah `coordinateCount`. |
| D5 | Test | 11 test baru di `kml_import_service_test.dart`, 2 baru + 1 dimodifikasi di `map_importer_test.dart`. |

---

## Bagian 1 — Perubahan `_ParsedCoordinates`

**File:** `lib/services/kml_import_service.dart` baris 2648–2663

Pecah `hasInvalidCoordinate` menjadi empat flag internal; tidak ada field/enum publik baru:

```dart
class _ParsedCoordinates {
  final List<LatLng> points;
  final List<double?> altitudes;
  final bool hasMalformedHorizontal;    // token tidak punya 2 komponen: abc,2 / 1, / ,2 / abc
  final bool hasOutOfRangeHorizontal;   // isFinite tetapi di luar ±90/±180
  final bool hasNonFiniteHorizontal;    // !isFinite: NaN, Infinity, 1e400
  final bool hasInvalidAltitude;        // altitude gagal: tryParse null ATAU !isFinite

  // Helper turunan — internal; bukan field publik
  bool get hasFatalHorizontal => hasOutOfRangeHorizontal || hasNonFiniteHorizontal;

  const _ParsedCoordinates.empty()
    : points = const [],
      altitudes = const [],
      hasMalformedHorizontal = false,
      hasOutOfRangeHorizontal = false,
      hasNonFiniteHorizontal = false,
      hasInvalidAltitude = false;
}
```

`hasInvalidCoordinate` (nama lama) dihapus. Semua pemanggil dalam file yang sama dimigrasi. Tidak ada perubahan pada `ImportIssueCode`, `ImportIssue`, atau `ImportParseResult`.

---

## Bagian 2 — Perubahan `_coordinates()` — Klasifikasi Token

**File:** `lib/services/kml_import_service.dart` baris 2319–2420

### Peta klasifikasi token (urutan eksekusi per token)

| Tahap | Kondisi | Flag | Nasib tuple |
|---|---|---|---|
| 1. Struktur | `firstComma <= 0` atau `> 2 koma` | `hasMalformedHorizontal` | buang |
| 2. Parse | `double.tryParse(lonStr) == null` atau `tryParse(latStr) == null` | `hasMalformedHorizontal` | buang |
| 3. Finite | `!lon.isFinite \|\| !lat.isFinite` | `hasNonFiniteHorizontal` | buang |
| 4. Range | `lat < -90 \|\| lat > 90 \|\| lon < -180 \|\| lon > 180` | `hasOutOfRangeHorizontal` | buang |
| 5. Altitude | `secondComma != -1 && (altParse==null \|\| !alt.isFinite)` | `hasInvalidAltitude` | **pertahankan**, altitude=null |

> **Catatan `double.tryParse`:** `"NaN"` → `double.nan` (bukan null); `"Infinity"` → `double.infinity` (bukan null); `"abc"` → null; `""` → null. Tahap 2 menetapkan malformed hanya untuk null dari tryParse; tahap 3 menangkap NaN/Infinity setelah tryParse non-null.

### Prioritas fatal atas malformed

Jika loop menemukan token fatal (non-finite atau out-of-range) *dan* token malformed pada elemen yang sama, `hasFatalHorizontal == true`. Emisi issue setelah loop akan mengutamakan error fatal dan tidak menghasilkan warning malformed tambahan.

### Emisi issue setelah loop (menggantikan blok baris 2403–2414)

```dart
// 1. Fatal horizontal → error (paling tinggi prioritasnya)
if ((hasOutOfRangeHorizontal || hasNonFiniteHorizontal) && reportInvalidCoordinateIssue) {
  issues.add(ImportIssue(
    code: ImportIssueCode.invalidGeometryCoordinate,
    severity: ImportIssueSeverity.error,
    message: '$sourceReference contains invalid or out-of-range coordinates.',
    sourceReference: sourceReference,
    sourceOrder: sourceOrder,
  ));
}

// 2. Malformed → warning, hanya jika tidak ada fatal (fatal diutamakan)
//    Berlaku untuk SEMUA geometri (Point, LineString, dan Polygon ring).
//    reportInvalidCoordinateIssue tidak memengaruhi cabang ini.
if (hasMalformedHorizontal && !hasFatalHorizontal) {
  issues.add(ImportIssue(
    code: ImportIssueCode.invalidGeometry,
    severity: ImportIssueSeverity.warning,
    message: '$sourceReference contains malformed coordinate tuples; they were skipped.',
    sourceReference: sourceReference,
    sourceOrder: sourceOrder,
  ));
}

// 3. Altitude gagal → warning (selalu, terlepas dari horizontal)
if (hasInvalidAltitude) {
  issues.add(ImportIssue(
    code: ImportIssueCode.unsupportedGeometryAltitude,
    severity: ImportIssueSeverity.warning,
    message: '$sourceReference has one or more altitude values that could not be read; they were set to null.',
    sourceReference: sourceReference,
    sourceOrder: sourceOrder,
  ));
}
```

> [!IMPORTANT]
> **Perbedaan dari versi 2 (Opsi B):** Warning malformed (`invalidGeometry` warning) kini diemit dari `_coordinates()` untuk **semua** geometri termasuk Point dan LineString — ini mengembalikan keputusan awal D1. `reportInvalidCoordinateIssue` hanya mengendalikan emisi `invalidGeometryCoordinate` (fatal); tidak memengaruhi emisi warning malformed atau warning altitude.

---

## Bagian 3 — Syarat Pembuangan Point dan LineString

**File:** `lib/services/kml_import_service.dart` baris 424–513

### Prinsip

- Geometri dibuang **seluruhnya** jika ada satu tuple malformed atau fatal — meskipun ada tuple valid lainnya.
- Tidak ada geometri yang dibentuk dari titik-titik di kedua sisi token rusak.
- Tidak ada `invalidGeometry` error tambahan dari pemanggil ketika penyebabnya sudah menghasilkan warning malformed atau error fatal dari `_coordinates()`.

### Kondisi pemanggil — Point

```
koordinat ← _coordinates(..., reportInvalidCoordinateIssue: true)

// Periksa flag cacat sebelum memeriksa jumlah tuple
jika koordinat.hasMalformedHorizontal || koordinat.hasFatalHorizontal:
    // Issue sudah diemit oleh _coordinates():
    //   - hasFatalHorizontal → invalidGeometryCoordinate error
    //   - hasMalformedHorizontal (tanpa fatal) → invalidGeometry warning
    // Pemanggil TIDAK menambah issue kedua.
    coordinateCount += koordinat.points.length   // tetap hitung tuple valid yang lolos
    break  // Point tidak terbentuk

// Tidak ada malformed/fatal — periksa jumlah tuple
jika koordinat.points.length == 1:
    terima → tambah ke points, featureCount++
jika koordinat.points.length > 1:
    emisi invalidGeometry error "has more than one valid coordinate tuple"
jika koordinat.points.length == 0:
    emisi invalidGeometry error "has no valid coordinate"
coordinateCount += koordinat.points.length
```

### Kondisi pemanggil — LineString

```
koordinat ← _coordinates(..., reportInvalidCoordinateIssue: true)

// Periksa flag cacat sebelum memeriksa jumlah tuple
jika koordinat.hasMalformedHorizontal || koordinat.hasFatalHorizontal:
    // Issue sudah diemit oleh _coordinates().
    // Pemanggil TIDAK menambah issue kedua.
    // LineString tidak terbentuk dan tidak dihitung (I8-a).
    break

// Tidak ada malformed/fatal — periksa jumlah tuple
jika koordinat.points.length >= 2:
    terima → tambah ke lines, featureCount++
    coordinateCount += koordinat.points.length
jika lainnya (< 2 tuple valid, tanpa cacat):
    emisi invalidGeometry error "has fewer than two coordinates"
    // Tidak dihitung (I8-a)
```

> [!NOTE]
> Blok `break` untuk malformed/fatal pada LineString tidak menambah `coordinateCount` — ini mempertahankan I8-a: LineString yang ditolak tidak menghabiskan anggaran koordinat.

---

## Bagian 4 — Emisi Issue Polygon (Pemanggil)

**File:** `lib/services/kml_import_service.dart` baris 515–566

### Masalah

`_isValidPolygonRing()` hanya mengembalikan `bool`. Pemanggil tidak tahu apakah penyebab kegagalan adalah malformed, fatal horizontal, atau closure gagal. Polygon dengan NaN atau out-of-range harus tetap menghasilkan `invalidGeometryCoordinate` error — bukan hanya `invalidGeometry` warning.

### Strategi: pemanggil memeriksa flag `_ParsedCoordinates` setelah `_isValidPolygonRing` mengembalikan false

Pemanggil sudah memiliki akses ke `_ParsedCoordinates`. Variabel `anyFatalEmitted` melacak apakah error fatal sudah diemit.

```
outerCoordinates ← _coordinates(outer, ..., reportInvalidCoordinateIssue: false)
polygonCoordinateCount ← outerCoordinates.points.length
validPolygon ← _isValidPolygonRing(outerCoordinates)
anyFatalEmitted ← false

// Jika outer ring tidak valid, periksa penyebabnya
jika !validPolygon && outerCoordinates.hasFatalHorizontal:
    emisi invalidGeometryCoordinate error (outer ring)
    anyFatalEmitted ← true
    // Warning malformed sudah diemit oleh _coordinates() jika hasMalformedHorizontal

// Loop inner ring
untuk setiap inner ring:
    ring ← _coordinates(inner, ..., reportInvalidCoordinateIssue: false)
    polygonCoordinateCount += ring.points.length
    jika _isValidPolygonRing(ring):
        holes.add(...)
    jika lainnya (inner ring tidak valid):
        validPolygon ← false
        jika ring.hasFatalHorizontal:
            emisi invalidGeometryCoordinate error (inner ring ini)
            anyFatalEmitted ← true

coordinateCount += polygonCoordinateCount   // selalu, baris 554 — tidak berubah

jika !validPolygon:
    jika !anyFatalEmitted:
        // Penyebab: malformed atau closure gagal
        // Warning malformed sudah ada dari _coordinates() jika hasMalformedHorizontal.
        // Tambah warning generik untuk closure/structural:
        emisi invalidGeometry warning "$sourceReference was skipped..."
    // Tidak ada warning tambahan jika anyFatalEmitted — fatal sudah cukup
    break
```

**Hasil per skenario:**

| Penyebab kegagalan ring | Issue yang diemit | Severity |
|---|---|---|
| Fatal (NaN/out-of-range) | `invalidGeometryCoordinate` (dari pemanggil) | error |
| Malformed + fatal bersama | `invalidGeometryCoordinate` + `invalidGeometry` warning (dari `_coordinates()`) | error + warning |
| Malformed saja | `invalidGeometry` warning (dari `_coordinates()`) + `invalidGeometry` warning (dari pemanggil generik) | warning + warning |
| Altitude closure berbeda | `invalidGeometry` warning (dari pemanggil generik) | warning |
| Altitude satu ujung null | `unsupportedGeometryAltitude` warning (dari `_coordinates()`) — ring diterima | warning |

> [!NOTE]
> Kasus malformed saja menghasilkan dua `invalidGeometry` warning berbeda: satu dari `_coordinates()` dengan pesan "contains malformed coordinate tuples", satu dari pemanggil dengan pesan "was skipped...". Keduanya adalah warning dan keduanya akurat — yang pertama menjelaskan *apa yang salah*, yang kedua menjelaskan *akibatnya*. `_skippedGeometryWarningCount` (lihat Bagian 7) akan menghitung keduanya — ini diterima karena kedua warning memang mencerminkan satu Polygon yang dibuang.

### Implementasi `_isValidPolygonRing` (perubahan D2)

```dart
bool _isValidPolygonRing(_ParsedCoordinates ring) {
  // Fatal atau malformed → invalid
  if (ring.hasFatalHorizontal || ring.hasMalformedHorizontal) return false;
  if (ring.points.length < 3) return false;

  final distinctPositions = <(double, double)>{};
  for (final point in ring.points) {
    distinctPositions.add((point.latitude, point.longitude));
  }
  if (distinctPositions.length < 3) return false;

  final first = ring.points.first;
  final last = ring.points.last;
  // Penutupan horizontal — tidak berubah
  if (first.latitude != last.latitude || first.longitude != last.longitude) {
    return false;
  }

  // Penutupan altitude — D2:
  // Gagal hanya jika kedua altitude terbaca (non-null) dan berbeda.
  final firstAlt = ring.altitudes.first;
  final lastAlt = ring.altitudes.last;
  if (firstAlt != null && lastAlt != null && firstAlt != lastAlt) {
    return false;
  }

  return true;
}
```

---

## Bagian 5 — Akuntansi Koordinat (D4)

**File:** `lib/services/kml_import_service.dart` baris 528–554

### Alur yang benar (berdasarkan kode aktual)

```
polygonCoordinateCount ← outerCoordinates.points.length     // outer ring

untuk setiap inner ring:
    remaining ← maxCoordinates - coordinateCount - polygonCoordinateCount
    //                                             ↑ batas inner memperhitungkan outer
    ring ← _coordinates(inner, maxAllowedCoordinates: remaining, ...)
    polygonCoordinateCount += ring.points.length              // dihitung, valid atau tidak
    jika _isValidPolygonRing(ring): holes.add(...)
    jika lainnya: validPolygon ← false [+ emisi fatal jika perlu]

coordinateCount += polygonCoordinateCount   // baris 554, SEBELUM if !validPolygon
                                            // Ring yang ditolak TETAP menghabiskan anggaran

jika !validPolygon:
    emisi issue (lihat Bagian 4)
    break
```

> [!IMPORTANT]
> `coordinateCount += polygonCoordinateCount` di baris 554 terjadi **sebelum** `if (!validPolygon)` di baris 555. Ring yang ditolak **tetap menghabiskan anggaran**. Ini adalah perilaku yang ada dan tidak berubah. Ringkasan D4 lama ("ring dibuang tidak menambah anggaran") adalah keliru dan sudah dikoreksi.

### Tabel perbandingan per geometri

| Geometri | Ditolak? | Tambah `coordinateCount`? | Alasan |
|---|---|---|---|
| Point | Ya atau Tidak | **Ya** (baris 473, selalu) | `+=` di luar blok kondisi |
| LineString | Ya (< 2, malformed, fatal) | **Tidak** (I8-a) | `+=` hanya di dalam blok `if length >= 2` |
| LineString | Tidak (diterima) | **Ya** (baris 502) | masuk blok accepted |
| Polygon outer+inner | Ditolak | **Ya** (baris 554 selalu dieksekusi) | `+=` sebelum `if !validPolygon` |
| Polygon outer+inner | Diterima | **Ya** (baris 554) | sama |

### Konsekuensi delta altitude-invalid

Sebelum A1: tuple dengan altitude `abc` → tuple dibuang → tidak terhitung. Setelah A1: altitude gagal → altitude=null, tuple dipertahankan → terhitung. File dengan banyak altitude invalid akan menghitung lebih banyak koordinat — ini mencerminkan konten nyata yang kini dipertahankan.

### Konsekuensi I8-a

LineString yang ditolak tidak menambah `coordinateCount`. File dengan banyak LineString invalid mendapat anggaran lebih lega — ini keputusan yang disengaja.

---

## Bagian 6 — Perubahan `_polygonRing()` di `map_importer.dart`

**File:** `lib/services/map_importer.dart` baris 416–441

### Masalah

Fungsi saat ini membandingkan `first` dan `last` elemen-per-elemen. Setelah D2, ring yang lolos `_isValidPolygonRing()` dapat memiliki:
- `altitudeFirst = null` → `_coordinate(point, null)` → `[lon, lat]` (panjang 2)
- `altitudeLast = 50.0` → `_coordinate(point, 50.0)` → `[lon, lat, 50.0]` (panjang 3)

Kondisi `first.length != last.length` → **throw**, padahal ring ini seharusnya valid.

### Catatan kompatibilitas: dimensi campuran 2D/3D

Ketika salah satu altitude ujung ring adalah null, `_coordinateSequence` menghasilkan koordinat dengan dimensi campuran: beberapa elemen berupa `[lon, lat]` (2D) dan beberapa berupa `[lon, lat, alt]` (3D). Ini adalah output yang valid berdasarkan keputusan D2 — altitude null mencerminkan altitude yang gagal dibaca, bukan altitude nol.

**Tidak ada normalisasi:** altitude null **tidak** diubah menjadi `0.0`, dan altitude valid **tidak** diubah menjadi null. Dimensi campuran dalam satu ring adalah konsekuensi yang diterima dari mempertahankan geometri horizontal meski sebagian altitude gagal dibaca.

Konsumen GeoJSON (misalnya rendering engine) yang menerima ring ini harus dapat menangani koordinat 2D dan 3D yang bercampur dalam satu LinearRing. Ini sesuai dengan spesifikasi GeoJSON (RFC 7946 §3.1.1) yang mengizinkan dimensi campuran dalam satu objek geometri meskipun tidak direkomendasikan — dan sesuai dengan keputusan untuk tidak mengubah data.

### Perubahan minimal

Strategi: bandingkan hanya dimensi yang ada di **keduanya** (`minLen = min(first.length, last.length)`):

```dart
List<List<double>> _polygonRing(
  List<LatLng> ring,
  List<double?> altitudes,
  String label,
) {
  // Pemeriksaan 1: penutupan horizontal (tidak berubah)
  if (ring.length < 4 ||
      ring.first.latitude != ring.last.latitude ||
      ring.first.longitude != ring.last.longitude) {
    throw MapImportPackageException(
      '$label is not a closed GeoJSON linear ring; coordinates were not changed.',
    );
  }

  final coordinates = _coordinateSequence(ring, altitudes, label);
  final first = coordinates.first;
  final last = coordinates.last;

  // Pemeriksaan 2: bandingkan hanya dimensi yang ada di keduanya
  // - Keduanya 2D (panjang 2): bandingkan lon, lat
  // - Keduanya 3D (panjang 3): bandingkan lon, lat, altitude
  // - Campuran (panjang 2 + 3): bandingkan lon, lat saja (minLen=2)
  //   Ring diterima karena horizontal tertutup; altitude satu ujung null
  //   sudah divalidasi di parser (D2).
  final minLen = first.length < last.length ? first.length : last.length;
  for (var i = 0; i < minLen; i++) {
    if (first[i] != last[i]) {
      throw MapImportPackageException(
        '$label has different first and last positions; coordinates were not changed.',
      );
    }
  }

  return coordinates;
}
```

**Mengapa tidak melonggarkan validasi lain:**
- Ketika keduanya 3D dan altitude berbeda: `first[2] != last[2]` → masih throw.
- Ketika campuran: `minLen=2`, lon dan lat dibandingkan → horizontal closure tetap terjaga.
- Validasi `ring.length < 4` dan horizontal closure pertama tidak berubah.
- Validasi `distinctPositions.length < 3` dan jumlah minimum titik tidak berubah (dilakukan di `_isValidPolygonRing` di parser).

---

## Bagian 7 — Audit UI: Rename dan Perubahan `map_home_page.dart`

**File:** `lib/screens/map_home_page.dart`

### Inventaris pemakaian yang diaudit

Fungsi dan string yang akan berubah dipakai di **empat** lokasi (tiga konteks fungsional):

| Lokasi | Konteks | Variabel / Fungsi yang dipakai |
|---|---|---|
| Baris 1799–1900 | Load maps aktif saat startup | `skippedPolygonCount`, `filesWithSkippedPolygons`, string inline baris 1897 |
| Baris 1922–1930 | Definisi `_skippedPolygonWarningCount()` | — (definisi fungsi) |
| Baris 1932–1934 | Definisi `_polygonWarningMessage()` | — (definisi fungsi) |
| Baris 1947–2031 | Import baru (`_importMap`) | `skippedPolygonCount`, `_skippedPolygonWarningCount()`, `_polygonWarningMessage()` |
| Baris 2056–2071 | Toggle aktivasi peta | `skippedPolygonCount`, `_skippedPolygonWarningCount()`, `_polygonWarningMessage()` |

### Alasan perubahan

Setelah A1, `invalidGeometry` warning diemit oleh:
1. Polygon outer/inner ring invalid (perilaku lama).
2. Point malformed (baru).
3. LineString malformed (baru).

`_skippedPolygonWarningCount` menghitung semua `code == invalidGeometry && severity == warning`. Tanpa perubahan, counter ini — dan semua pesan UI — akan keliru menyebut semua kasus ini sebagai "Polygon".

### Perubahan yang diperlukan

**Fungsi `_skippedPolygonWarningCount` → `_skippedGeometryWarningCount`:**

```dart
// Sebelum:
int _skippedPolygonWarningCount(ImportParseResult result) {
  return result.issues
      .where(
        (issue) =>
            issue.code == ImportIssueCode.invalidGeometry &&
            issue.severity == ImportIssueSeverity.warning,
      )
      .length;
}

// Sesudah (hanya rename fungsi; predikat tidak berubah):
int _skippedGeometryWarningCount(ImportParseResult result) {
  return result.issues
      .where(
        (issue) =>
            issue.code == ImportIssueCode.invalidGeometry &&
            issue.severity == ImportIssueSeverity.warning,
      )
      .length;
}
```

**Fungsi `_polygonWarningMessage` → `_skippedGeometryWarningMessage`:**

```dart
// Sebelum:
String _polygonWarningMessage(String mapName, int count) {
  return '$mapName: $count Polygon tidak valid dilewati.';
}

// Sesudah (rename + ubah teks):
String _skippedGeometryWarningMessage(String mapName, int count) {
  return '$mapName: $count geometri tidak valid dilewati.';
}
```

**String inline baris 1897 (konteks startup load):**

```dart
// Sebelum:
'$skippedPolygonCount Polygon tidak valid dilewati saat memuat '
'$filesWithSkippedPolygons file.'

// Sesudah:
'$skippedPolygonCount geometri tidak valid dilewati saat memuat '
'$filesWithSkippedPolygons file.'
```

**Semua pemanggil** `_skippedPolygonWarningCount(...)` → diganti dengan `_skippedGeometryWarningCount(...)` (3 lokasi: baris 1814, 1973, 2065).  
**Semua pemanggil** `_polygonWarningMessage(...)` → diganti dengan `_skippedGeometryWarningMessage(...)` (3 lokasi: baris 2008, 2023, 2068).  
**Variabel** `skippedPolygonCount` dan `filesWithSkippedPolygons` cukup di-rename secara opsional untuk kejelasan, tetapi bukan keharusan — nilainya tetap benar.

### Inventaris perubahan di `map_home_page.dart`

| Baris | Perubahan |
|---|---|
| 1799 | rename variabel `skippedPolygonCount` → `skippedGeometryCount` (opsional) |
| 1800 | rename variabel `filesWithSkippedPolygons` → `filesWithSkippedGeometries` (opsional) |
| 1814 | panggil `_skippedGeometryWarningCount(...)` |
| 1897 | ubah string "Polygon tidak valid" → "geometri tidak valid" |
| 1922–1930 | rename fungsi `_skippedPolygonWarningCount` → `_skippedGeometryWarningCount` |
| 1932–1934 | rename fungsi `_polygonWarningMessage` → `_skippedGeometryWarningMessage`, ubah teks |
| 1947 | rename variabel lokal `skippedPolygonCount` (opsional) |
| 1973 | panggil `_skippedGeometryWarningCount(...)` |
| 2007–2008 | panggil `_skippedGeometryWarningMessage(...)` |
| 2021–2023 | panggil `_skippedGeometryWarningMessage(...)` |
| 2065 | panggil `_skippedGeometryWarningCount(...)` |
| 2066–2068 | panggil `_skippedGeometryWarningMessage(...)` |

> [!NOTE]
> Rename variabel lokal (`skippedPolygonCount`, `filesWithSkippedPolygons`) adalah opsional karena hanya mempengaruhi keterbacaan — nilai dan logika tidak berubah. Rename fungsi dan perubahan string pesan adalah wajib.

### Dampak pada test yang ada

Tidak ada test di `kml_import_service_test.dart` atau `map_importer_test.dart` yang secara langsung menguji string pesan UI atau nama fungsi `_skippedPolygonWarningCount` / `_polygonWarningMessage` — keduanya adalah metode privat di UI layer. Tidak ada regresi test yang diharapkan dari perubahan ini.

---

## Bagian 8 — Klarifikasi Double-Error Point/LineString

### Alur emisi issue (perilaku lama vs baru)

**Perilaku LAMA — out-of-range (contoh: `181,2` di Point):**

```
_coordinates():
  → invalidCoordinate=true → emisi invalidGeometryCoordinate error  ← issue #1
Pemanggil:
  → points.length==0 → emisi invalidGeometry error "has no valid coordinate"  ← issue #2
Total: 2 error
```

**Perilaku BARU — out-of-range:**

```
_coordinates():
  → hasOutOfRangeHorizontal=true → emisi invalidGeometryCoordinate error  ← issue #1
Pemanggil:
  → hasFatalHorizontal=true → masuk blok pembuangan, tidak emisi issue kedua
Total: 1 error
```

**Perilaku BARU — malformed (contoh: `abc,2` di Point):**

```
_coordinates():
  → hasMalformedHorizontal=true, hasFatalHorizontal=false
  → emisi invalidGeometry warning "contains malformed coordinate tuples"  ← issue #1
Pemanggil:
  → hasMalformedHorizontal=true → masuk blok pembuangan, tidak emisi issue kedua
Total: 1 warning
```

**Perilaku BARU — altitude invalid (contoh: `1,2,invalid` di Point):**

```
_coordinates():
  → hasInvalidAltitude=true → altitude=null, tuple diterima
  → emisi unsupportedGeometryAltitude warning  ← issue #1
Pemanggil:
  → hasMalformedHorizontal=false, hasFatalHorizontal=false → tidak masuk blok pembuangan
  → points.length==1 → Point diterima
Total: 1 warning, 0 error — Point dipertahankan
```

### Ringkasan perubahan

| Kondisi | Sebelum A1 | Setelah A1 |
|---|---|---|
| Out-of-range atau non-finite | 2 error (duplikasi) | **1 error** (fatal saja) |
| Malformed saja | 2 error (coordinate keliru severity + geometry) | **1 warning** (geometry malformed) |
| Altitude invalid, horizontal valid | 2 error + geometri hilang | **1 warning** + geometri dipertahankan |

Double-error sebelumnya adalah duplikasi yang tidak disengaja — tidak ada test yang mengunci duplikasi ini. A1 menghilangkannya.

---

## Bagian 9 — I8-a: Verifikasi melalui Audit Kode

**Klaim:** LineString yang ditolak tidak menambah `coordinateCount`.

**Bukti dari kode aktual (baris 483–513):**

```dart
case 'LineString':
  final coordinates = _coordinates(...);
  if (coordinates.points.length >= 2) {
    ...
    coordinateCount += coordinates.points.length;   // HANYA di sini
  } else {
    issues.add(...);
    // ← tidak ada coordinateCount += di cabang else
  }
```

Setelah A1, blok pembuangan karena malformed/fatal (periksa flag sebelum pemeriksaan length) juga menggunakan `break` tanpa `+=`.

**T11 tidak membuktikan secara langsung** bahwa `coordinateCount` internal tidak bertambah — variabel ini tidak terekspos. T11 membuktikan bahwa LineString yang ditolak menghasilkan issue yang benar dan tidak masuk ke output. Pembuktian I8-a adalah **melalui audit kode** di atas.

---

## Bagian 10 — Daftar Test Lengkap

### Test baru di `test/kml_import_service_test.dart` — 11 test

**Kelompok D1 — Malformed horizontal (5 test: T1–T5):**

| # | Input | Perilaku yang dibuktikan |
|---|---|---|
| T1 | `abc,2` di Point | 1 warning `invalidGeometry` ("contains malformed"), tidak ada Point di output, `parse()` throw karena tidak ada konten |
| T2 | `1,` di Point | Sama dengan T1 |
| T3 | `,2` di Point | Sama dengan T1 |
| T4 | `abc,2 1,2` di Point (campuran malformed + valid) | Point dibuang **seluruhnya** (meski ada 1 tuple valid); 1 warning `invalidGeometry` dari `_coordinates()`; tidak ada Point di output |
| T5 | Polygon outer ring dengan `0,abc` di antara tuple valid | `invalidGeometry` warning (Polygon dibuang); bukan `invalidGeometryCoordinate` |

**Kelompok D2 — Ring altitude (3 test: T6–T8):**

| # | Koordinat outer ring | Perilaku yang dibuktikan |
|---|---|---|
| T6 | `0,0,100 1,0,100 1,1,100 0,0,abc` | Warning `unsupportedGeometryAltitude`, Polygon **dipertahankan**, `parseWithIssues()` sukses |
| T7 | `0,0,100 1,0,100 1,1,100 0,0,999` | `invalidGeometry` warning (Polygon dibuang — ring tidak tertutup altitude) |
| T8 | `0,0 1,0 1,1 0,0` (2D tanpa altitude) | Polygon dipertahankan, tidak ada `unsupportedGeometryAltitude` |

**Kelompok D3 — Klasifikasi horizontal (2 test: T9–T10):**

| # | Input | Perilaku yang dibuktikan |
|---|---|---|
| T9 | `NaN,2` di Point | 1 error `invalidGeometryCoordinate` (fatal, non-finite); tidak ada `invalidGeometry` warning; tidak ada Point di output |
| T10 | `1,91` di Point | 1 error `invalidGeometryCoordinate` (fatal, out-of-range) |

**Kelompok I8-a — Akuntansi (1 test: T11):**

| # | Input | Perilaku yang dibuktikan |
|---|---|---|
| T11 | `1,2 181,2` di LineString | **1 error** `invalidGeometryCoordinate` saja (fatal out-of-range); tidak ada `invalidGeometry` error kedua; tidak ada LineString di output. I8-a diverifikasi lewat audit kode (Bagian 9). |

> [!IMPORTANT]
> **T11 dikoreksi dari versi 2:** Input `1,2 181,2` mengandung satu token fatal (`181,2` → out-of-range). Sesuai Bagian 3, pemanggil tidak menambah `invalidGeometry` error kedua ketika `hasFatalHorizontal=true`. Ekspektasi: hanya 1 error `invalidGeometryCoordinate`. Tidak ada `invalidGeometry` error. Tidak ada LineString di output.

**Total: 11 test baru di `kml_import_service_test.dart`.**

### Test baru di `test/map_importer_test.dart` — 2 test

| # | Deskripsi | Perilaku yang dibuktikan |
|---|---|---|
| T12 | Polygon dengan outer ring `0,0,100 1,0,100 1,1,100 0,0,abc` | `importMap()` sukses, paket mengandung 1 polygon, warning `unsupportedGeometryAltitude`, tidak ada error |
| T13 | Polygon dengan outer ring `0,0,100 1,0,100 1,1,100 0,0,999` | `importMap()` throw `MapImportContentException`, issues: `invalidGeometry` warning + `noRenderableContent` error |

**Total: 2 test baru di `map_importer_test.dart`.**

### Test yang dimodifikasi — 1 test

**`test/map_importer_test.dart` baris 1286–1303** — `'emits failed progress with the structured import error'`

**KML saat ini:** `<coordinates>1,2,invalid</coordinates>` (altitude invalid di Point).  
**Setelah A1:** `invalid` sebagai altitude → warning, Point dipertahankan → `importMap()` tidak throw → 3 assertion saat ini akan gagal.

**Assertion yang diganti:**

| Assertion | Sebelum | Sesudah |
|---|---|---|
| KML trigger | `<coordinates>1,2,invalid</coordinates>` | `<coordinates>NaN,2</coordinates>` |
| `throwsA(...)` | `throwsA(isA<MapImportContentException>())` | tidak berubah |
| `progress.last.status` | `ImportProgressStatus.failed` | tidak berubah |
| `progress.last.error` | `isA<MapImportContentException>()` | tidak berubah |
| `progress.last.stage` | `ImportProgressStage.parsing` | tidak berubah |

Hanya KML trigger yang berubah — `NaN,2` sebagai koordinat Point tetap fatal setelah A1 (non-finite horizontal → `invalidGeometryCoordinate` error). Semua assertion tentang infrastruktur progress (`status`, `error`, `stage`) tetap sama dan tetap melindungi perilaku yang diuji.

---

## Bagian 11 — File yang Disentuh

| File | Jenis perubahan | Area yang diubah | Alasan |
|---|---|---|---|
| `lib/services/kml_import_service.dart` | Modifikasi (3 area) | `_ParsedCoordinates` (~2648-2663); `_coordinates()` (~2340-2420); `_isValidPolygonRing()` (~2422-2436) | Klasifikasi flag, emisi issue, penutupan altitude |
| `lib/services/map_importer.dart` | Modifikasi (1 fungsi) | `_polygonRing()` (~416-441) | Tangani dimensi campuran 2D/3D |
| `lib/screens/map_home_page.dart` | Modifikasi (rename + teks) | Fungsi dan string di baris 1814, 1897, 1922–1934, 1973, 2007–2008, 2021–2023, 2065–2068 | Pesan UI mengacu pada "geometri" bukan "Polygon" |
| `test/kml_import_service_test.dart` | Tambah 11 test (T1–T11) | Akhir file / kelompok tematik | Mengunci perilaku baru per klasifikasi |
| `test/map_importer_test.dart` | Tambah 2 test (T12–T13) + modifikasi 1 test | Tambah di akhir; modifikasi ~1286-1303 | End-to-end + trigger berubah |
| `PROGRESS2.md` | Tambah 2 catatan | Bagian baru setelah Bagian 3 | Konsekuensi I8-a dan delta altitude-invalid |

**Total: 5 file kode/test + 1 dokumen. Tidak ada file baru.**

### Batas perubahan yang ditegaskan

- Tidak ada perubahan di luar 6 area di atas.
- `ImportIssueCode`, `ImportIssue`, `ImportParseResult` tidak diubah.
- `map_home_page.dart` hanya rename dan ubah teks pesan — tidak ada perubahan logika.
- Tidak ada commit, checkout, stash, atau pekerjaan B2/C/D/E.

---

## Checklist Validasi (setelah implementasi)

- [ ] `flutter analyze lib/services/kml_import_service.dart lib/services/map_importer.dart lib/screens/map_home_page.dart` → 0 issues
- [ ] `flutter analyze test/kml_import_service_test.dart test/map_importer_test.dart` → 0 issues
- [ ] `dart format --output=none --set-exit-if-changed lib/services/kml_import_service.dart lib/services/map_importer.dart lib/screens/map_home_page.dart test/kml_import_service_test.dart test/map_importer_test.dart` → 0 changed
- [ ] `flutter test test/kml_import_service_test.dart` → semua lulus, tidak ada regresi
- [ ] `flutter test test/map_importer_test.dart` → semua lulus, tidak ada regresi
- [ ] `flutter test` → semua lulus, 0 regresi, 2 skip tetap skip
- [ ] `git diff --check` → exit 0
