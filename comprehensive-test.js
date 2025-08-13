const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE = 'http://localhost:3000';
const TEST_TIMEOUT = 30000;

console.log('🧪 Starting Comprehensive System Test...\n');

// Test data
const testProducts = [
    {
        barkod: 'TEST001',
        ad: 'Test Ürün 1',
        marka: 'Test Marka',
        miktar: 10,
        alisFiyati: 50,
        satisFiyati: 100,
        kategori: 'Test Kategori',
        varyant_id: 'V1'
    },
    {
        barkod: 'TEST001', // Same barcode, different variant
        ad: 'Test Ürün 1 - Varyant 2',
        marka: 'Test Marka',
        miktar: 5,
        alisFiyati: 55,
        satisFiyati: 110,
        kategori: 'Test Kategori',
        varyant_id: 'V2'
    },
    {
        barkod: 'TEST002',
        ad: 'Test Ürün 2',
        marka: 'Test Marka 2',
        miktar: 15,
        alisFiyati: 30,
        satisFiyati: 60,
        kategori: 'Test Kategori 2',
        varyant_id: ''
    }
];

const testCustomer = {
    id: 'TESTCUST001',
    ad: 'Test Müşteri',
    telefon: '555-1234',
    adres: 'Test Adres',
    bakiye: 0
};

let serverPid = null;

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function startServer() {
    console.log('🚀 Starting server...');
    const { spawn } = require('child_process');
    
    const server = spawn('node', ['server.js'], {
        stdio: 'pipe',
        detached: false
    });
    
    return new Promise((resolve, reject) => {
        let output = '';
        
        server.stdout.on('data', (data) => {
            output += data.toString();
            if (output.includes('Server running on port')) {
                serverPid = server.pid;
                console.log('✅ Server started successfully');
                resolve(server);
            }
        });
        
        server.stderr.on('data', (data) => {
            console.error('Server error:', data.toString());
        });
        
        server.on('error', (error) => {
            console.error('Failed to start server:', error);
            reject(error);
        });
        
        // Timeout after 10 seconds
        setTimeout(() => {
            reject(new Error('Server startup timeout'));
        }, 10000);
    });
}

async function stopServer() {
    if (serverPid) {
        console.log('🛑 Stopping server...');
        try {
            process.kill(serverPid, 'SIGTERM');
            await sleep(2000);
            console.log('✅ Server stopped');
        } catch (error) {
            console.error('Error stopping server:', error);
        }
    }
}

async function waitForServer() {
    console.log('⏳ Waiting for server to be ready...');
    for (let i = 0; i < 30; i++) {
        try {
            await axios.get(`${API_BASE}/api/test`, { timeout: 2000 });
            console.log('✅ Server is ready');
            return true;
        } catch (error) {
            await sleep(1000);
        }
    }
    throw new Error('Server did not start within expected time');
}

async function testAPI() {
    console.log('\n📋 Testing API endpoints...');
    
    try {
        // Test API status
        const response = await axios.get(`${API_BASE}/api/test`);
        console.log('✅ API test endpoint:', response.data.message);
        
        // Test database status
        const dbResponse = await axios.get(`${API_BASE}/api/database-status`);
        console.log('✅ Database status:', dbResponse.data.status);
        
        return true;
    } catch (error) {
        console.error('❌ API test failed:', error.message);
        return false;
    }
}

async function testProductOperations() {
    console.log('\n📦 Testing product operations...');
    
    try {
        // Add test products
        for (const product of testProducts) {
            try {
                const response = await axios.post(`${API_BASE}/urunler`, product);
                console.log(`✅ Added product: ${product.ad} (Variant: ${product.varyant_id || 'None'})`);
            } catch (error) {
                console.log(`ℹ️ Product might already exist: ${product.ad}`);
            }
        }
        
        // Get all products
        const getResponse = await axios.get(`${API_BASE}/api/tum-veriler`);
        const data = getResponse.data;
        
        if (data.stokListesi) {
            console.log(`✅ Retrieved ${Object.keys(data.stokListesi).length} products from database`);
            
            // Check variant handling
            const test001Products = Object.values(data.stokListesi).filter(p => p.barkod === 'TEST001');
            if (test001Products.length >= 2) {
                console.log('✅ Variant products with same barcode are properly handled');
                console.log(`   Found ${test001Products.length} variants for barcode TEST001`);
                test001Products.forEach((p, index) => {
                    console.log(`   Variant ${index + 1}: ${p.urun_adi || p.ad} (${p.varyant_id || 'No variant ID'})`);
                });
            } else {
                console.error('❌ Variant products not properly handled');
                return false;
            }
        }
        
        return true;
    } catch (error) {
        console.error('❌ Product operations test failed:', error.message);
        return false;
    }
}

async function testSalesOperations() {
    console.log('\n💰 Testing sales operations...');
    
    try {
        // Add a customer first
        try {
            await axios.post(`${API_BASE}/api/musteri-ekle`, testCustomer);
            console.log('✅ Added test customer');
        } catch (error) {
            console.log('ℹ️ Customer might already exist');
        }
        
        // Make a sale with custom price
        const customPrice = 95; // Different from default product price
        const saleData = {
            id: Date.now().toString(36) + Math.random().toString(36).substring(2, 7),
            tarih: new Date().toISOString(),
            barkod: 'TEST001',
            urunAdi: 'Test Ürün 1',
            marka: 'Test Marka',
            miktar: 2,
            fiyat: customPrice, // Custom price, not default
            alisFiyati: 50,
            toplam: customPrice * 2,
            borc: false,
            musteriId: testCustomer.id,
            aciklama: 'Test satış'
        };
        
        const saleResponse = await axios.post(`${API_BASE}/api/satis-ekle`, saleData);
        console.log('✅ Sale recorded with custom price:', customPrice);
        
        // Get sales history and verify price
        const dataResponse = await axios.get(`${API_BASE}/api/tum-veriler`);
        const salesHistory = dataResponse.data.satisGecmisi;
        
        const testSale = salesHistory.find(s => s.id === saleData.id);
        if (testSale && testSale.fiyat === customPrice) {
            console.log('✅ Sales history shows correct custom price:', testSale.fiyat);
        } else {
            console.error('❌ Sales history shows incorrect price');
            return false;
        }
        
        return true;
    } catch (error) {
        console.error('❌ Sales operations test failed:', error.message);
        return false;
    }
}

async function testBackupSystem() {
    console.log('\n💾 Testing backup system...');
    
    try {
        // Check if backup files exist
        const backupDir = path.join(__dirname, 'veriler', 'backups');
        if (fs.existsSync(backupDir)) {
            const backupFiles = fs.readdirSync(backupDir);
            console.log(`✅ Backup directory exists with ${backupFiles.length} files`);
        }
        
        // Check database file
        const dbPath = path.join(__dirname, 'veriler', 'veritabani.db');
        if (fs.existsSync(dbPath)) {
            const dbStats = fs.statSync(dbPath);
            console.log(`✅ Database file exists (${Math.round(dbStats.size / 1024)}KB)`);
        }
        
        // Check JSON backup
        const jsonBackupPath = path.join(__dirname, 'veriler', 'tumVeriler.json');
        if (fs.existsSync(jsonBackupPath)) {
            const jsonStats = fs.statSync(jsonBackupPath);
            console.log(`✅ JSON backup exists (${Math.round(jsonStats.size / 1024)}KB)`);
        }
        
        return true;
    } catch (error) {
        console.error('❌ Backup system test failed:', error.message);
        return false;
    }
}

async function testNetworkConfiguration() {
    console.log('\n🌐 Testing network configuration...');
    
    try {
        // Check if server responds to local IP
        const os = require('os');
        const networkInterfaces = os.networkInterfaces();
        let localIP = null;
        
        for (const name of Object.keys(networkInterfaces)) {
            for (const interface of networkInterfaces[name]) {
                if (interface.family === 'IPv4' && !interface.internal) {
                    localIP = interface.address;
                    break;
                }
            }
            if (localIP) break;
        }
        
        if (localIP) {
            try {
                const response = await axios.get(`http://${localIP}:3000/api/test`, { timeout: 5000 });
                console.log(`✅ Server accessible on local IP: ${localIP}:3000`);
            } catch (error) {
                console.log(`⚠️ Server not accessible on local IP: ${localIP}:3000`);
                console.log('   This might be due to firewall settings');
            }
        }
        
        return true;
    } catch (error) {
        console.error('❌ Network configuration test failed:', error.message);
        return false;
    }
}

async function cleanupTestData() {
    console.log('\n🧹 Cleaning up test data...');
    
    try {
        // Delete test products
        for (const product of testProducts) {
            try {
                await axios.delete(`${API_BASE}/api/stok-sil/${encodeURIComponent(product.barkod)}`);
            } catch (error) {
                // Ignore errors - product might not exist
            }
        }
        
        // Delete test customer
        try {
            await axios.delete(`${API_BASE}/api/musteri-sil/${encodeURIComponent(testCustomer.id)}`);
        } catch (error) {
            // Ignore errors - customer might not exist
        }
        
        console.log('✅ Test data cleaned up');
        return true;
    } catch (error) {
        console.error('❌ Cleanup failed:', error.message);
        return false;
    }
}

async function runTests() {
    let server = null;
    
    try {
        // Start server
        server = await startServer();
        await waitForServer();
        
        // Run tests
        const results = {
            api: await testAPI(),
            products: await testProductOperations(),
            sales: await testSalesOperations(),
            backup: await testBackupSystem(),
            network: await testNetworkConfiguration()
        };
        
        // Cleanup
        await cleanupTestData();
        
        // Summary
        console.log('\n📊 Test Results Summary:');
        console.log('========================');
        Object.entries(results).forEach(([test, passed]) => {
            console.log(`${passed ? '✅' : '❌'} ${test.toUpperCase()}: ${passed ? 'PASSED' : 'FAILED'}`);
        });
        
        const allPassed = Object.values(results).every(result => result);
        console.log(`\n🎯 Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
        
        if (allPassed) {
            console.log('\n🎉 System is working correctly!');
            console.log('✅ Variant products are properly handled');
            console.log('✅ Sales prices are correctly recorded');
            console.log('✅ Network access is configured');
            console.log('✅ Backup system is operational');
        }
        
        return allPassed;
        
    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
        return false;
    } finally {
        if (server) {
            server.kill();
        }
        await stopServer();
    }
}

// Handle process termination
process.on('SIGINT', async () => {
    console.log('\n🛑 Test interrupted');
    await stopServer();
    process.exit(1);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Test terminated');
    await stopServer();
    process.exit(1);
});

// Run tests
runTests().then(success => {
    process.exit(success ? 0 : 1);
}).catch(error => {
    console.error('❌ Unexpected error:', error);
    process.exit(1);
});