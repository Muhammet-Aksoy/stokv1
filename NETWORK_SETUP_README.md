# 🌐 Sabancıoğlu Otomotiv Network Kurulum Kılavuzu

## 🚀 Hızlı Başlangıç

### 1. Server'ı Başlat
```cmd
start-server.bat
```
Bu dosyayı çift tıklayarak sunucuyu başlatın. Otomatik olarak:
- Socket.IO dependency kurulumu yapılır
- IP adresleriniz gösterilir
- Real-time senkronizasyon aktifleşir

### 2. QR Kod ile Bağlantı
Sunucu çalıştıktan sonra tarayıcıda şu adresi açın:
```
http://localhost:3000/qr
```

Bu sayfa size:
- 📱 Tüm aktif IP adreslerini gösterir
- 🎯 Her IP için QR kod oluşturur
- 📋 Kopyala butonları
- 🔄 Otomatik yenileme

---

## 🛠️ Sorun Giderme

### 🔴 "Veriler gözükmüyor" Sorunu

#### 1. Veritabanını Sıfırla:
```
POST http://localhost:3000/api/reset-database
```
veya tarayıcıda:
```javascript
fetch('/api/reset-database', { method: 'POST' })
  .then(r => r.json())
  .then(console.log)
```

#### 2. Database Durumunu Kontrol Et:
```
GET http://localhost:3000/api/database-status
```

### 🔴 "Bağlantı Problemi" Sorunu

#### 1. Firewall Kontrolü:
Windows Defender Firewall'da 3000 portunu açın:
```cmd
netsh advfirewall firewall add rule name="Node.js Server" dir=in action=allow protocol=TCP localport=3000
```

#### 2. Network Ayarları:
- Bilgisayar ve mobil cihaz aynı WiFi ağında olmalı
- Router'da port blocking olmadığından emin olun

#### 3. IP Adresi Kontrolü:
```cmd
ipconfig
```
IPv4 adresini kontrol edin.

---

## 📊 API Endpoints

### Temel Endpoints:
- `GET /` - Ana sayfa (try.html)
- `GET /api/tum-veriler` - Tüm verileri getir
- `POST /api/tum-veriler` - Verileri kaydet (real-time sync)
- `GET /qr` - QR bağlantı sayfası

### Test Endpoints:
- `GET /test` - Basit test sayfası
- `GET /api/test` - API bağlantı testi

### Yönetim Endpoints:
- `GET /api/network-info` - Network bilgileri
- `GET /api/database-status` - Veritabanı durumu
- `POST /api/reset-database` - Veritabanını sıfırla

### Real-time Features:
- Socket.IO WebSocket bağlantısı
- Otomatik veri senkronizasyonu
- Bağlantı durumu göstergesi

---

## 📞 Destek

Sorun yaşarsanız:
1. `start-server.bat` çıktısını kontrol edin
2. `http://localhost:3000/api/database-status` adresini test edin
3. Firewall ayarlarını kontrol edin
4. Router ayarlarını kontrol edin

**Not:** Bu sistem yerel ağ (LAN) kullanımı içindir.