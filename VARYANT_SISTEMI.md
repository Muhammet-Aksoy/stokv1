# Aynı Barkodlu Ürün Varyantları Sistemi

## 🎯 Sistem Özelliği

Bu güncelleme ile sistem artık **aynı barkodlu ürünlerin farklı varyantlarını** desteklemektedir. Artık aynı barkod numarasına sahip farklı marka ve özelliklerdeki ürünler ayrı ayrı takip edilebilir.

## 🔄 Değişiklikler

### 1. Veritabanı Şeması Güncellemesi

**Önceki Durum:**
```sql
CREATE TABLE stok (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barkod TEXT UNIQUE NOT NULL,  -- Sadece barkod benzersiz
    ad TEXT NOT NULL,
    marka TEXT,
    -- diğer alanlar...
);
```

**Yeni Durum:**
```sql
CREATE TABLE stok (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barkod TEXT NOT NULL,         -- Barkod artık benzersiz değil
    ad TEXT NOT NULL,
    marka TEXT,
    varyant_id TEXT,              -- Yeni varyant ID alanı
    -- diğer alanlar...
    UNIQUE(barkod, marka, varyant_id)  -- Kombinasyon benzersiz
);
```

### 2. Ürün Ekleme Mantığı

**Yeni Davranış:**
- Aynı barkod + marka + varyant_id kombinasyonu varsa → **Güncelleme**
- Farklı kombinasyon varsa → **Yeni ürün ekleme**

**Örnek Senaryolar:**

| Barkod | Marka | Varyant ID | Durum |
|--------|-------|------------|-------|
| 123456 | Bosch | (boş) | ✅ Eklendi |
| 123456 | Brembo | (boş) | ✅ Eklendi |
| 123456 | Bosch | SPORT | ✅ Eklendi |
| 123456 | Bosch | (boş) | 🔄 Güncellendi |

### 3. Yeni API Endpoint'leri

#### GET `/api/stok-varyantlar/:barkod`
Aynı barkodlu tüm varyantları listeler.

**Örnek Kullanım:**
```bash
curl http://localhost:3000/api/stok-varyantlar/123456
```

**Örnek Yanıt:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "barkod": "123456",
      "ad": "Fren Balatası",
      "marka": "Bosch",
      "varyant_id": "",
      "miktar": 10
    },
    {
      "id": 2,
      "barkod": "123456",
      "ad": "Fren Balatası",
      "marka": "Brembo",
      "varyant_id": "",
      "miktar": 5
    },
    {
      "id": 3,
      "barkod": "123456",
      "ad": "Fren Balatası",
      "marka": "Bosch",
      "varyant_id": "SPORT",
      "miktar": 8
    }
  ],
  "count": 3,
  "barkod": "123456"
}
```

### 4. Güncellenmiş API Endpoint'leri

#### POST `/api/stok-ekle`
Artık varyant desteği ile çalışır.

**Yeni Parametreler:**
- `varyant_id` (opsiyonel): Varyant tanımlayıcısı

**Örnek İstek:**
```json
{
  "barkod": "123456",
  "ad": "Fren Balatası",
  "marka": "Bosch",
  "varyant_id": "SPORT",
  "miktar": 10,
  "alisFiyati": 50,
  "satisFiyati": 75
}
```

#### PUT `/api/stok-guncelle`
Artık ürün ID'si ile güncelleme yapar.

**Gerekli Parametreler:**
- `id`: Ürün ID'si (kesin güncelleme için)

## 🧪 Test Sonuçları

Sistem test edildi ve şu sonuçlar alındı:

```
📦 Test 1: Aynı barkodlu farklı marka ürünler ekleniyor...
✅ Ürün 1 eklendi: Yeni ürün başarıyla eklendi
✅ Ürün 2 eklendi: Yeni ürün başarıyla eklendi
✅ Ürün 3 eklendi: Yeni ürün başarıyla eklendi

🔍 Test 2: Aynı barkodlu varyantlar listeleniyor...
📋 Bulunan varyant sayısı: 3
1. Bosch - Fren Balatası (Ana) - Stok: 10
2. Bosch - Fren Balatası (SPORT) - Stok: 8
3. Brembo - Fren Balatası (Ana) - Stok: 5
```

## 📋 Kullanım Senaryoları

### Senaryo 1: Farklı Marka Aynı Ürün
```
Barkod: 123456
- Marka: Bosch → Stok: 10
- Marka: Brembo → Stok: 5
- Marka: TRW → Stok: 8
```

### Senaryo 2: Aynı Marka Farklı Varyant
```
Barkod: 123456
- Marka: Bosch, Varyant: (boş) → Normal fren balatası
- Marka: Bosch, Varyant: SPORT → Spor fren balatası
- Marka: Bosch, Varyant: PREMIUM → Premium fren balatası
```

### Senaryo 3: Karma Senaryo
```
Barkod: 123456
- Marka: Bosch, Varyant: (boş) → Normal
- Marka: Bosch, Varyant: SPORT → Spor
- Marka: Brembo, Varyant: (boş) → Normal
- Marka: TRW, Varyant: PREMIUM → Premium
```

## 🔧 Teknik Detaylar

### Veri Anahtarı Sistemi
Frontend'de ürünler şu formatta anahtarlanır:
```javascript
const key = `${barkod}_${marka || ''}_${varyant_id || ''}`;
```

**Örnek Anahtarlar:**
- `123456_Bosch_` (Bosch normal)
- `123456_Bosch_SPORT` (Bosch spor)
- `123456_Brembo_` (Brembo normal)

### Geriye Uyumluluk
- Mevcut veriler otomatik olarak yeni sisteme uyarlanır
- `varyant_id` alanı mevcut kayıtlar için boş olarak ayarlanır
- Eski API çağrıları çalışmaya devam eder

## 🚀 Faydalar

1. **Esnek Ürün Yönetimi**: Aynı ürünün farklı varyantları takip edilebilir
2. **Marka Bazlı Ayrım**: Farklı markalar ayrı ayrı stoklanabilir
3. **Varyant Desteği**: Aynı markanın farklı versiyonları
4. **Geriye Uyumluluk**: Mevcut sistemler etkilenmez
5. **Detaylı Raporlama**: Varyant bazlı raporlar alınabilir

## ⚠️ Önemli Notlar

1. **Benzersizlik Kuralı**: `(barkod + marka + varyant_id)` kombinasyonu benzersiz olmalıdır
2. **Varyant ID**: Boş bırakılabilir (ana varyant için)
3. **Marka Alanı**: Boş bırakılabilir ama önerilmez
4. **Güncelleme**: Ürün güncellemesi için ID kullanılmalıdır

## 📞 Destek

Sistem ile ilgili sorularınız için:
- Test dosyası: `test-variants.js`
- API dokümantasyonu: `README.md`
- Teknik detaylar: `server.js`