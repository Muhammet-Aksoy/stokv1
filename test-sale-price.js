const axios = require('axios');

const BASE_URL = 'http://localhost:3000';

async function testSalePriceColumn() {
    console.log('🧪 Satış Fiyatı Sütunu Testi Başlatılıyor...\n');
    
    try {
        // 1. Mevcut test ürününü kullan
        console.log('1️⃣ Mevcut test ürünü kullanılıyor...');
        const testBarcode = 'TEST456';
        
        // 2. Stok listesini al
        console.log('\n2️⃣ Stok listesi alınıyor...');
        const stockResponse = await axios.get(`${BASE_URL}/api/tum-veriler`);
        const stockData = stockResponse.data;
        
        console.log('📊 Stok listesi alındı');
        console.log('📋 Response structure:', Object.keys(stockData));
        console.log('📋 Data structure:', Object.keys(stockData.data || {}));
        if (stockData.data && stockData.data.stokListesi) {
            console.log('📋 Toplam ürün sayısı:', Object.keys(stockData.data.stokListesi).length);
        } else {
            console.log('❌ stokListesi bulunamadı');
            console.log('📋 Available keys in data:', Object.keys(stockData.data || {}));
        }
        
        // 3. Test ürününü bul
        const testProductKey = Object.keys(stockData.data.stokListesi || {}).find(key => 
            stockData.data.stokListesi[key].barkod === testBarcode
        );
        
        if (testProductKey) {
            const product = stockData.data.stokListesi[testProductKey];
            console.log('\n3️⃣ Test ürünü bulundu:');
            console.log('   Barkod:', product.barkod);
            console.log('   Ürün Adı:', product.ad);
            console.log('   Marka:', product.marka);
            console.log('   Miktar:', product.miktar);
            console.log('   Alış Fiyatı:', product.alisFiyati);
            console.log('   Satış Fiyatı:', product.satisFiyati);
            
            // 4. Satış fiyatının varlığını kontrol et
            if (product.satisFiyati !== undefined && product.satisFiyati !== null) {
                console.log('\n✅ SATIŞ FİYATI SÜTUNU ÇALIŞIYOR!');
                console.log('   Satış Fiyatı:', product.satisFiyati, '₺');
            } else {
                console.log('\n❌ SATIŞ FİYATI SÜTUNU BULUNAMADI!');
                console.log('   Satış Fiyatı:', product.satisFiyati);
            }
        } else {
            console.log('\n❌ Test ürünü bulunamadı!');
        }
        
        // 5. Test tamamlandı
        console.log('\n4️⃣ Test tamamlandı');
        
        console.log('\n🎉 Test tamamlandı!');
        
    } catch (error) {
        console.error('❌ Test hatası:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
    }
}

// Testi çalıştır
testSalePriceColumn();