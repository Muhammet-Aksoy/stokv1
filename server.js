const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const nodemailer = require('nodemailer');

// Server configuration
const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Database configuration
const dbPath = path.join(__dirname, 'veriler', 'veritabani.db');
let db = null;

// Email configuration for daily backups
const emailConfig = require('./email-config');

// Email transporter
let transporter = null;
try {
    transporter = nodemailer.createTransporter(emailConfig);
} catch (error) {
    console.warn('⚠️ Email configuration not set up:', error.message);
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static('.'));

// Database initialization with proper error handling
function initializeDatabase() {
    try {
        // Ensure data directory exists
        fs.ensureDirSync(path.dirname(dbPath));
        
        // Initialize database
        db = new Database(dbPath);
        console.log('✅ Database connected:', dbPath);
        
        // Enable foreign keys and optimize performance
        db.exec('PRAGMA foreign_keys = ON');
        db.exec('PRAGMA journal_mode = WAL');
        db.exec('PRAGMA synchronous = NORMAL');
        
        // Create tables with proper schema
        db.exec(`
            CREATE TABLE IF NOT EXISTS stok (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                barkod TEXT NOT NULL,
                ad TEXT NOT NULL,
                marka TEXT,
                miktar INTEGER DEFAULT 0,
                alisFiyati REAL DEFAULT 0,
                satisFiyati REAL DEFAULT 0,
                kategori TEXT,
                aciklama TEXT,
                varyant_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        db.exec(`
            CREATE TABLE IF NOT EXISTS musteriler (
                id TEXT PRIMARY KEY,
                ad TEXT NOT NULL,
                telefon TEXT,
                adres TEXT,
                bakiye REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        db.exec(`
            CREATE TABLE IF NOT EXISTS satisGecmisi (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                barkod TEXT NOT NULL,
                urunAdi TEXT,
                miktar INTEGER DEFAULT 0,
                fiyat REAL DEFAULT 0,
                alisFiyati REAL DEFAULT 0,
                musteriId TEXT,
                tarih DATETIME DEFAULT CURRENT_TIMESTAMP,
                borc INTEGER DEFAULT 0,
                toplam REAL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        db.exec(`
            CREATE TABLE IF NOT EXISTS borclarim (
                id TEXT PRIMARY KEY,
                musteriId TEXT NOT NULL,
                tutar REAL DEFAULT 0,
                aciklama TEXT,
                tarih DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add missing columns safely
        const addColumnSafely = (table, column, definition) => {
            try {
                db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
                console.log(`✅ Added ${column} to ${table}`);
            } catch (e) {
                console.log(`ℹ️ ${column} already exists in ${table}`);
            }
        };
        
        addColumnSafely('stok', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        addColumnSafely('musteriler', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        addColumnSafely('musteriler', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        addColumnSafely('satisGecmisi', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        addColumnSafely('borclarim', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
        
        // Create indices for better performance
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_stok_barkod ON stok(barkod);
            CREATE INDEX IF NOT EXISTS idx_satis_tarih ON satisGecmisi(tarih);
            CREATE INDEX IF NOT EXISTS idx_musteri_updated ON musteriler(updated_at);
        `);
        
        // Add marka column if it doesn't exist (migration for existing databases)
        try {
            db.prepare('SELECT marka FROM stok LIMIT 1').get();
        } catch (e) {
            console.log('📦 Adding marka column to stok table...');
            db.exec('ALTER TABLE stok ADD COLUMN marka TEXT');
        }
        
        // Add varyant_id column if it doesn't exist (migration for existing databases)
        try {
            db.prepare('SELECT varyant_id FROM stok LIMIT 1').get();
        } catch (e) {
            console.log('📦 Adding varyant_id column to stok table...');
            db.exec('ALTER TABLE stok ADD COLUMN varyant_id TEXT');
        }
        
        // Add urunAdi column to satisGecmisi if it doesn't exist (migration for existing databases)
        try {
            db.prepare('SELECT urunAdi FROM satisGecmisi LIMIT 1').get();
        } catch (e) {
            console.log('📦 Adding urunAdi column to satisGecmisi table...');
            db.exec('ALTER TABLE satisGecmisi ADD COLUMN urunAdi TEXT');
        }
        
        // Initialize database with sample data if empty
        const stokCount = db.prepare('SELECT COUNT(*) as count FROM stok').get().count;
        const musteriCount = db.prepare('SELECT COUNT(*) as count FROM musteriler').get().count;
        
        console.log('✅ Database initialized successfully');
        
        // Verify tables
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        console.log('📊 Available tables:', tables.map(t => t.name));
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        process.exit(1);
    }
}

// Initialize database
initializeDatabase();

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('🔗 Client connected:', socket.id);
    
    socket.on('disconnect', () => {
        console.log('❌ Client disconnected:', socket.id);
    });
    
    // Send initial connection confirmation
    socket.emit('connected', {
        message: 'Başarıyla bağlandı',
        timestamp: new Date().toISOString(),
        socketId: socket.id
    });
    
    // Handle data requests with robust error handling
            socket.on('requestData', () => {
            try {
                // console.log('📡 Data request from client:', socket.id);
                
                const data = db.transaction(() => {
                    let stokListesi = {};
                    let satisGecmisi = [];
                    let musteriler = {};
                    let borclarim = {};
                    
                    // Get stok data - FIXED: Use consistent key format with validation
                    try {
                        const stokRows = db.prepare('SELECT * FROM stok ORDER BY updated_at DESC').all();
                        console.log(`📦 Loading ${stokRows.length} stock items from database...`);
                        
                        stokRows.forEach(row => { 
                            // Use the original product ID as key to maintain consistency with backup data
                            // This prevents data loss during sync operations
                            const key = row.id || `${row.barkod}_${row.marka || ''}_${row.varyant_id || ''}`;
                            
                            // Validate required fields
                            if (!row.barkod) {
                                console.warn('⚠️ Skipping product without barcode:', row);
                                return;
                            }
                            
                            // Map database columns to frontend expected format
                            stokListesi[key] = {
                                id: row.id,
                                barkod: row.barkod,
                                urun_adi: row.ad || '', // Map 'ad' to 'urun_adi'
                                marka: row.marka || '',
                                kategori: row.kategori || '',
                                fiyat: row.satisFiyati || 0, // Map 'satisFiyati' to 'fiyat'
                                stok_miktari: row.miktar || 0, // Map 'miktar' to 'stok_miktari'
                                min_stok: 0, // Default value since this column doesn't exist in DB
                                alisFiyati: row.alisFiyati || 0, // Keep original purchase price
                                varyant_id: row.varyant_id || '',
                                varyant_adi: '', // Default value since this column doesn't exist in DB
                                created_at: row.created_at,
                                updated_at: row.updated_at
                            };
                        });
                        
                        console.log(`✅ Successfully loaded ${Object.keys(stokListesi).length} products`);
                    } catch (error) {
                        console.error('❌ Error loading stock data:', error);
                        // Fallback to JSON file if database fails
                        try {
                            const jsonData = JSON.parse(fs.readFileSync('veriler/tumVeriler.json', 'utf8'));
                            stokListesi = jsonData.stokListesi || {};
                            console.log(`📄 Fallback: Loaded ${Object.keys(stokListesi).length} products from JSON`);
                        } catch (jsonError) {
                            console.error('❌ Failed to load from JSON fallback:', jsonError);
                        }
                    }
                    
                    // Get satis data
                    try {
                        satisGecmisi = db.prepare('SELECT * FROM satisGecmisi ORDER BY tarih DESC').all();
                    } catch (e) {
                        console.warn('⚠️ Satis query error:', e.message);
                    }
                    
                    // Get musteriler data
                    try {
                        const musteriRows = db.prepare('SELECT * FROM musteriler ORDER BY updated_at DESC').all();
                        musteriRows.forEach(row => { musteriler[row.id] = row; });
                    } catch (e) {
                        console.warn('⚠️ Musteri query error:', e.message);
                        // Fallback
                        const musteriRows = db.prepare('SELECT * FROM musteriler ORDER BY id DESC').all();
                        musteriRows.forEach(row => { musteriler[row.id] = row; });
                    }
                    
                    // Get borclarim data
                    try {
                        const borcRows = db.prepare('SELECT * FROM borclarim ORDER BY tarih DESC').all();
                        borcRows.forEach(row => { borclarim[row.id] = row; });
                    } catch (e) {
                        console.warn('⚠️ Borc query error:', e.message);
                    }
                    
                    return { stokListesi, satisGecmisi, musteriler, borclarim };
                })();
                
                socket.emit('dataResponse', {
                    success: true,
                    data: data,
                    timestamp: new Date().toISOString(),
                    count: {
                        stok: Object.keys(data.stokListesi).length,
                        satis: data.satisGecmisi.length,
                        musteri: Object.keys(data.musteriler).length,
                        borc: Object.keys(data.borclarim).length
                    }
                });
                
                // console.log('✅ Data sent to client:', socket.id);
                
            } catch (error) {
                console.error('❌ Data request error:', error);
                socket.emit('dataResponse', {
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        // Handle real-time data updates
        socket.on('dataUpdate', (data) => {
            try {
                // console.log('📡 Data update received:', data.type);
                
                if (!data.type || !data.data) {
                    throw new Error('Invalid data update format');
                }
                
                // Broadcast to all clients
                socket.broadcast.emit('dataUpdate', data);
                
                socket.emit('updateResponse', {
                    success: true,
                    message: 'Data updated successfully',
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                console.error('❌ Data update error:', error);
                socket.emit('updateResponse', {
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
        });
});

// API Routes
app.get('/api/test', (req, res) => {
    try {
        // Database connection test
        const dbTest = db.prepare('SELECT 1 as test').get();
        
        // Table structure test
        const stokColumns = db.prepare("PRAGMA table_info(stok)").all();
        const musteriColumns = db.prepare("PRAGMA table_info(musteriler)").all();
        
        // Data count test
        const stokCount = db.prepare('SELECT COUNT(*) as count FROM stok').get();
        const musteriCount = db.prepare('SELECT COUNT(*) as count FROM musteriler').get();
        const satisCount = db.prepare('SELECT COUNT(*) as count FROM satisGecmisi').get();
        const borcCount = db.prepare('SELECT COUNT(*) as count FROM borclarim').get();
        
        res.json({
            success: true,
            message: 'API çalışıyor',
            timestamp: new Date().toISOString(),
            database: {
                connected: true,
                test: dbTest.test
            },
            tables: {
                stok: {
                    exists: stokColumns.length > 0,
                    columns: stokColumns.map(col => col.name),
                    count: stokCount.count,
                    hasUpdatedAt: stokColumns.some(col => col.name === 'updated_at')
                },
                musteriler: {
                    exists: musteriColumns.length > 0,
                    columns: musteriColumns.map(col => col.name),
                    count: musteriCount.count,
                    hasUpdatedAt: musteriColumns.some(col => col.name === 'updated_at')
                },
                satisGecmisi: {
                    count: satisCount.count
                },
                borclarim: {
                    count: borcCount.count
                }
            },
            socket: {
                connected: io.engine.clientsCount,
                rooms: Object.keys(io.sockets.adapter.rooms)
            }
        });
        
    } catch (error) {
        console.error('❌ Test endpoint error:', error);
        res.status(500).json({
            success: false,
            message: 'Test başarısız',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// GET endpoint for all data
app.get('/api/tum-veriler', async (req, res) => {
    try {
        // console.log('📡 GET /api/tum-veriler - Data request received');
        
        const data = db.transaction(() => {
            let stokListesi = {};
            let satisGecmisi = [];
            let musteriler = {};
            let borclarim = {};
            
            try {
                // Get all stok data with proper error handling
                const stokRows = db.prepare('SELECT * FROM stok ORDER BY updated_at DESC, id DESC').all();
                console.log(`📦 Found ${stokRows.length} products in database`);
                
                // Index by barkod for consistent access
                stokRows.forEach(row => { 
                    // Use composite key (barkod + marka + varyant_id) to handle variants
                    const key = `${row.barkod}_${row.marka || ''}_${row.varyant_id || ''}`;
                    if (row.barkod) {
                        // Map database columns to frontend expected format
                        stokListesi[key] = {
                            id: row.id,
                            barkod: row.barkod,
                            urun_adi: row.ad || '', // Map 'ad' to 'urun_adi'
                            marka: row.marka || '',
                            kategori: row.kategori || '',
                            fiyat: row.satisFiyati || 0, // Map 'satisFiyati' to 'fiyat'
                            stok_miktari: row.miktar || 0, // Map 'miktar' to 'stok_miktari'
                            min_stok: 0, // Default value since this column doesn't exist in DB
                            alisFiyati: row.alisFiyati || 0, // Keep original purchase price
                            varyant_id: row.varyant_id || '',
                            varyant_adi: '', // Default value since this column doesn't exist in DB
                            created_at: row.created_at,
                            updated_at: row.updated_at
                        };
                    } else {
                        console.warn('⚠️ Product without barcode found:', row);
                    }
                });
                
                // Get sales history with proper error handling
                satisGecmisi = db.prepare('SELECT * FROM satisGecmisi ORDER BY tarih DESC, id DESC').all();
                console.log(`💰 Found ${satisGecmisi.length} sales records`);
                
                // Get customers with proper error handling
                const musteriRows = db.prepare('SELECT * FROM musteriler ORDER BY updated_at DESC, id DESC').all();
                console.log(`👥 Found ${musteriRows.length} customers`);
                musteriRows.forEach(row => { 
                    if (row.id) {
                        musteriler[row.id] = row; 
                    } else {
                        console.warn('⚠️ Customer without ID found:', row);
                    }
                });
                
                // Get debts with proper error handling
                const borcRows = db.prepare('SELECT * FROM borclarim ORDER BY tarih DESC, id DESC').all();
                console.log(`💳 Found ${borcRows.length} debt records`);
                borcRows.forEach(row => { 
                    if (row.id) {
                        borclarim[row.id] = row; 
                    } else {
                        console.warn('⚠️ Debt record without ID found:', row);
                    }
                });
                
            } catch (dbError) {
                console.error('❌ Database query error:', dbError);
                throw new Error(`Database query failed: ${dbError.message}`);
            }
            
            return { stokListesi, satisGecmisi, musteriler, borclarim };
        })();
        
        // Validate data integrity
        const stokCount = Object.keys(data.stokListesi).length;
        const satisCount = data.satisGecmisi.length;
        const musteriCount = Object.keys(data.musteriler).length;
        const borcCount = Object.keys(data.borclarim).length;
        
        console.log('📊 Data summary:', {
            stok: stokCount,
            satis: satisCount,
            musteri: musteriCount,
            borc: borcCount
        });
        
        // Ensure we have valid data structure
        if (stokCount === 0 && satisCount === 0 && musteriCount === 0) {
            console.warn('⚠️ No data found in database - this might indicate an issue');
        }
        
        res.json({
            success: true,
            data: data,
            timestamp: new Date().toISOString(),
            count: {
                stok: stokCount,
                satis: satisCount,
                musteri: musteriCount,
                borc: borcCount
            }
        });
        
    } catch (error) {
        console.error('❌ Tum veriler GET error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// POST endpoint for bulk data synchronization
app.post('/api/tum-veriler', async (req, res) => {
    try {
        const { stokListesi, satisGecmisi, musteriler, borclarim } = req.body;
        
        if (!stokListesi || !satisGecmisi || !musteriler || !borclarim) {
            return res.status(400).json({
                success: false,
                error: 'Eksik veri parametreleri',
                timestamp: new Date().toISOString()
            });
        }
        
        // console.log('📡 POST /api/tum-veriler - Bulk sync started');
        // console.log('📊 Import data summary:', {
        //     stok: Object.keys(stokListesi).length,
        //     satis: satisGecmisi.length,
        //     musteri: Object.keys(musteriler).length,
        //     borc: Object.keys(borclarim).length
        // });
        
        const result = db.transaction(() => {
            let updatedCount = 0;
            let insertedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            
            // Sync stok data with improved deduplication
            for (const [key, urun] of Object.entries(stokListesi)) {
                try {
                    // Handle key format consistently - extract barkod from urun object, not from key
                    const barkod = urun.barkod;
                    const marka = urun.marka || '';
                    const varyant_id = urun.varyant_id || '';
                    
                    if (!barkod) {
                        console.warn('⚠️ Skipping product without barcode:', urun);
                        skippedCount++;
                        continue;
                    }
                    
                    // Check for existing record with same barcode, marka, and varyant_id
                    const existing = db.prepare('SELECT id FROM stok WHERE barkod = ? AND marka = ? AND varyant_id = ?').get(barkod, marka, varyant_id);
                    
                    if (existing) {
                        // Update existing record only if data is different
                        const currentData = db.prepare('SELECT * FROM stok WHERE id = ?').get(existing.id);
                        const hasChanges = (
                            currentData.ad !== (urun.urun_adi || urun.ad || '') ||
                            currentData.miktar !== (parseInt(urun.stok_miktari || urun.miktar) || 0) ||
                            currentData.satisFiyati !== (parseFloat(urun.fiyat) || 0) ||
                            currentData.alisFiyati !== (parseFloat(urun.alisFiyati) || 0) ||
                            currentData.kategori !== (urun.kategori || '')
                        );
                        
                        if (hasChanges) {
                            // Ensure proper data types and handle null/undefined values
                            // Map frontend format back to database format
                            const ad = urun.urun_adi || urun.ad || '';
                            const miktar = parseInt(urun.stok_miktari || urun.miktar) || 0;
                            const satisFiyati = parseFloat(urun.fiyat) || 0;
                            const alisFiyati = parseFloat(urun.alisFiyati) || 0;
                            const kategori = urun.kategori || '';
                            
                            db.prepare(`
                                UPDATE stok SET 
                                    ad = ?, miktar = ?, satisFiyati = ?, alisFiyati = ?, 
                                    kategori = ?, updated_at = CURRENT_TIMESTAMP
                                WHERE barkod = ? AND marka = ? AND varyant_id = ?
                            `).run(ad, miktar, satisFiyati, alisFiyati, kategori, barkod, marka, varyant_id);
                            updatedCount++;
                        } else {
                            skippedCount++; // No changes needed
                        }
                    } else {
                        // Insert new record - allow multiple products with same barcode
                        // Ensure proper data types and handle null/undefined values
                        // Map frontend format to database format
                        const ad = urun.urun_adi || urun.ad || '';
                        const miktar = parseInt(urun.stok_miktari || urun.miktar) || 0;
                        const satisFiyati = parseFloat(urun.fiyat) || 0;
                        const alisFiyati = parseFloat(urun.alisFiyati) || 0;
                        const kategori = urun.kategori || '';
                        
                        db.prepare(`
                            INSERT INTO stok (barkod, ad, marka, miktar, satisFiyati, alisFiyati, kategori, varyant_id)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(barkod, ad, marka, miktar, satisFiyati, alisFiyati, kategori, varyant_id);
                        insertedCount++;
                    }
                } catch (e) {
                    console.warn(`⚠️ Stok sync error for ${key}:`, e.message);
                    errorCount++;
                }
            }
            
            // Sync satis data with improved deduplication
            for (const satis of satisGecmisi) {
                try {
                    if (!satis.barkod || !satis.miktar) {
                        console.warn('⚠️ Skipping invalid sales record:', satis);
                        skippedCount++;
                        continue;
                    }
                    
                    // Use composite key for sales deduplication (barkod + tarih + miktar + fiyat)
                    const existing = db.prepare(`
                        SELECT id FROM satisGecmisi 
                        WHERE barkod = ? AND tarih = ? AND miktar = ? AND fiyat = ?
                    `).get(satis.barkod, satis.tarih, satis.miktar, satis.fiyat);
                    
                    if (!existing) {
                        // Ensure proper data types and handle null/undefined values
                        const barkod = satis.barkod || '';
                        const miktar = parseInt(satis.miktar) || 0;
                        const fiyat = parseFloat(satis.fiyat) || 0;
                        const alisFiyati = parseFloat(satis.alisFiyati) || 0;
                        const musteriId = satis.musteriId || null;
                        const tarih = satis.tarih || new Date().toISOString();
                        const borc = satis.borc ? 1 : 0;
                        const toplam = parseFloat(satis.toplam) || 0;
                        
                        db.prepare(`
                            INSERT INTO satisGecmisi (barkod, miktar, fiyat, alisFiyati, musteriId, tarih, borc, toplam)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        `).run(barkod, miktar, fiyat, alisFiyati, musteriId, tarih, borc, toplam);
                        insertedCount++;
                    } else {
                        skippedCount++; // Duplicate sales record
                    }
                } catch (e) {
                    console.warn(`⚠️ Satis sync error for ${satis.id}:`, e.message);
                    errorCount++;
                }
            }
            
            // Sync musteriler data with improved deduplication
            for (const [id, musteri] of Object.entries(musteriler)) {
                try {
                    if (!id || !musteri.ad) {
                        console.warn('⚠️ Skipping invalid customer record:', musteri);
                        skippedCount++;
                        continue;
                    }
                    
                    const existing = db.prepare('SELECT id FROM musteriler WHERE id = ?').get(id);
                    
                    if (existing) {
                        // Update only if data is different
                        const currentData = db.prepare('SELECT * FROM musteriler WHERE id = ?').get(id);
                        const hasChanges = (
                            currentData.ad !== (musteri.ad || '') ||
                            currentData.telefon !== (musteri.telefon || '') ||
                            currentData.adres !== (musteri.adres || '') ||
                            currentData.bakiye !== (parseFloat(musteri.bakiye) || 0)
                        );
                        
                        if (hasChanges) {
                            // Ensure proper data types and handle null/undefined values
                            const ad = musteri.ad || '';
                            const telefon = musteri.telefon || '';
                            const adres = musteri.adres || '';
                            const bakiye = parseFloat(musteri.bakiye) || 0;
                            
                            db.prepare(`
                                UPDATE musteriler SET 
                                    ad = ?, telefon = ?, adres = ?, bakiye = ?, updated_at = CURRENT_TIMESTAMP
                                WHERE id = ?
                            `).run(ad, telefon, adres, bakiye, id);
                            updatedCount++;
                        } else {
                            skippedCount++; // No changes needed
                        }
                    } else {
                        // Insert new customer
                        // Ensure proper data types and handle null/undefined values
                        const ad = musteri.ad || '';
                        const telefon = musteri.telefon || '';
                        const adres = musteri.adres || '';
                        const bakiye = parseFloat(musteri.bakiye) || 0;
                        
                        db.prepare(`
                            INSERT INTO musteriler (id, ad, telefon, adres, bakiye)
                            VALUES (?, ?, ?, ?, ?)
                        `).run(id, ad, telefon, adres, bakiye);
                        insertedCount++;
                    }
                } catch (e) {
                    console.warn(`⚠️ Musteri sync error for ${id}:`, e.message);
                    errorCount++;
                }
            }
            
            // Sync borclarim data with improved deduplication
            for (const [id, borc] of Object.entries(borclarim)) {
                try {
                    if (!id || !borc.musteriId) {
                        console.warn('⚠️ Skipping invalid debt record:', borc);
                        skippedCount++;
                        continue;
                    }
                    
                    const existing = db.prepare('SELECT id FROM borclarim WHERE id = ?').get(id);
                    
                    if (existing) {
                        // Update only if data is different
                        const currentData = db.prepare('SELECT * FROM borclarim WHERE id = ?').get(id);
                        const hasChanges = (
                            currentData.musteriId !== (borc.musteriId || '') ||
                            currentData.tutar !== (parseFloat(borc.tutar) || 0) ||
                            currentData.aciklama !== (borc.aciklama || '') ||
                            currentData.tarih !== (borc.tarih || new Date().toISOString())
                        );
                        
                        if (hasChanges) {
                            // Ensure proper data types and handle null/undefined values
                            const musteriId = borc.musteriId || '';
                            const tutar = parseFloat(borc.tutar) || 0;
                            const aciklama = borc.aciklama || '';
                            const tarih = borc.tarih || new Date().toISOString();
                            
                            db.prepare(`
                                UPDATE borclarim SET 
                                    musteriId = ?, tutar = ?, aciklama = ?, tarih = ?
                                WHERE id = ?
                            `).run(musteriId, tutar, aciklama, tarih, id);
                            updatedCount++;
                        } else {
                            skippedCount++; // No changes needed
                        }
                    } else {
                        // Insert new debt record
                        // Ensure proper data types and handle null/undefined values
                        const musteriId = borc.musteriId || '';
                        const tutar = parseFloat(borc.tutar) || 0;
                        const aciklama = borc.aciklama || '';
                        const tarih = borc.tarih || new Date().toISOString();
                        
                        db.prepare(`
                            INSERT INTO borclarim (id, musteriId, tutar, aciklama, tarih)
                            VALUES (?, ?, ?, ?, ?)
                        `).run(id, musteriId, tutar, aciklama, tarih);
                        insertedCount++;
                    }
                } catch (e) {
                    console.warn(`⚠️ Borc sync error for ${id}:`, e.message);
                    errorCount++;
                }
            }
            
            return { updatedCount, insertedCount, skippedCount, errorCount };
        })();
        
        console.log('📊 Sync result:', result);
        
        res.json({
            success: true,
            message: 'Veriler başarıyla senkronize edildi',
            result: result,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Tum veriler POST error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

app.get('/api/database-status', (req, res) => {
    try {
        const status = {
            connected: db !== null,
            path: dbPath,
            tables: [],
            indexes: []
        };
        
        if (db) {
            // Get table info
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            status.tables = tables.map(t => t.name);
            
            // Get index info
            const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all();
            status.indexes = indexes.map(i => i.name);
            
            // Test connection
            const test = db.prepare('SELECT 1 as test').get();
            status.test = test.test;
        }
        
        res.json({
            success: true,
            status: status,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Database status error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Debug endpoint
app.get('/api/debug', (req, res) => {
    try {
        const debug = {
            server: {
                status: 'running',
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                version: process.version,
                platform: process.platform
            },
            database: {
                status: db !== null ? 'connected' : 'disconnected',
                path: dbPath,
                tables: []
            }
        };

        if (db) {
            // Get table information
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            debug.database.tables = tables.map(table => {
                try {
                    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get().count;
                    return {
                        name: table.name,
                        count: count,
                        status: 'ok'
                    };
                } catch (e) {
                    return {
                        name: table.name,
                        count: 0,
                        status: 'error'
                    };
                }
            });
        }

        res.json({
            success: true,
            debug: debug,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Debug endpoint error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Email backup function
async function sendDailyBackup() {
    if (!transporter) {
        console.warn('⚠️ Email transporter not configured');
        return;
    }

    try {
        // Create backup
        const backupDir = path.join(__dirname, 'veriler', 'backups');
        fs.ensureDirSync(backupDir);
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(backupDir, `daily_backup_${timestamp}.db`);
        
        // Copy database
        fs.copyFileSync(dbPath, backupPath);
        
        // Get database stats
        const stats = db.transaction(() => {
            const stokCount = db.prepare('SELECT COUNT(*) as count FROM stok').get().count;
            const satisCount = db.prepare('SELECT COUNT(*) as count FROM satisGecmisi').get().count;
            const musteriCount = db.prepare('SELECT COUNT(*) as count FROM musteriler').get().count;
            const borcCount = db.prepare('SELECT COUNT(*) as count FROM borclarim').get().count;
            
            return { stokCount, satisCount, musteriCount, borcCount };
        })();
        
        // Send email
        const mailOptions = {
            from: emailConfig.auth.user,
            to: emailConfig.auth.user, // Send to self as backup
            subject: `Günlük Veri Yedeği - ${new Date().toLocaleDateString('tr-TR')}`,
            html: `
                <h2>📊 Günlük Veri Yedeği</h2>
                <p><strong>Tarih:</strong> ${new Date().toLocaleString('tr-TR')}</p>
                <p><strong>Veritabanı İstatistikleri:</strong></p>
                <ul>
                    <li>📦 Ürün Sayısı: ${stats.stokCount}</li>
                    <li>💰 Satış Sayısı: ${stats.satisCount}</li>
                    <li>👥 Müşteri Sayısı: ${stats.musteriCount}</li>
                    <li>💳 Borç Sayısı: ${stats.borcCount}</li>
                </ul>
                <p><strong>Yedek Dosya:</strong> ${path.basename(backupPath)}</p>
                <p><em>Bu yedek dosyası bilgisayarınızda saklanmaktadır.</em></p>
            `,
            attachments: [{
                filename: `backup_${timestamp}.db`,
                path: backupPath
            }]
        };
        
        await transporter.sendMail(mailOptions);
        console.log('✅ Daily backup email sent successfully');
        
        // Clean up old backups (keep last 7 days)
        const files = fs.readdirSync(backupDir);
        const oldFiles = files
            .filter(f => f.startsWith('daily_backup_'))
            .sort()
            .slice(0, -7); // Keep only last 7 files
            
        oldFiles.forEach(file => {
            fs.removeSync(path.join(backupDir, file));
        });
        
    } catch (error) {
        console.error('❌ Daily backup email failed:', error);
    }
}

// Schedule daily backup at 23:00
setInterval(() => {
    const now = new Date();
    if (now.getHours() === 23 && now.getMinutes() === 0) {
        sendDailyBackup();
    }
}, 60000); // Check every minute

// POST /api/stok-ekle - Tek ürün ekle
app.post('/api/stok-ekle', async (req, res) => {
    try {
        const urun = req.body;
        console.log('📦 Yeni ürün ekleniyor:', urun.barkod, urun.ad);
        
        // Validate required fields
        if (!urun.barkod || !urun.ad) {
            return res.status(400).json({
                success: false,
                message: 'Barkod ve ürün adı zorunludur',
                timestamp: new Date().toISOString()
            });
        }
        
        // Ensure proper data types and handle null/undefined values
        const barkod = urun.barkod || '';
        const ad = urun.ad || '';
        const marka = urun.marka || '';
        const miktar = parseInt(urun.miktar) || 0;
        const alisFiyati = parseFloat(urun.alisFiyati) || 0;
        const satisFiyati = parseFloat(urun.satisFiyati) || 0;
        const kategori = urun.kategori || '';
        const aciklama = urun.aciklama || '';
        const varyant_id = urun.varyant_id || '';
        
        // Check if exact same product exists (barcode + brand + variant combination)
        const existingProduct = db.prepare('SELECT * FROM stok WHERE barkod = ? AND marka = ? AND varyant_id = ?').get(barkod, marka, varyant_id);
        
        if (existingProduct) {
            // Exact same product exists - warn user and offer to update
            res.status(409).json({ 
                success: false, 
                message: `Bu ürün zaten mevcut: ${existingProduct.ad}`,
                existingProduct: existingProduct,
                conflict: true,
                timestamp: new Date().toISOString()
            });
            return;
        } else {
            // Check if barcode exists with different properties
            const existingBarcodeProducts = db.prepare('SELECT * FROM stok WHERE barkod = ?').all(barkod);
            
            // Insert new product (allows multiple products with same barcode but different properties)
            const result = db.prepare(`
                INSERT INTO stok (barkod, ad, marka, miktar, alisFiyati, satisFiyati, kategori, aciklama, varyant_id, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(barkod, ad, marka, miktar, alisFiyati, satisFiyati, kategori, aciklama, varyant_id);
            
            // Get the inserted product with its ID
            const insertedProduct = db.prepare('SELECT * FROM stok WHERE barkod = ? AND marka = ? AND varyant_id = ?').get(barkod, marka, varyant_id);
            
            // Real-time sync to all clients
            io.to('dataSync').emit('dataUpdated', {
                type: 'stok-add',
                data: insertedProduct,
                timestamp: new Date().toISOString()
            });
            
            res.status(201).json({ 
                success: true, 
                message: existingBarcodeProducts.length > 0 ? 
                    `Yeni ürün eklendi. Bu barkod ile ${existingBarcodeProducts.length} farklı ürün mevcut.` : 
                    'Yeni ürün başarıyla eklendi', 
                data: insertedProduct,
                isUpdate: false,
                existingVariants: existingBarcodeProducts.length,
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ Ürün eklenirken hata:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ürün eklenirken hata', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// PUT /api/stok-guncelle - Ürün güncelle
app.put('/api/stok-guncelle', async (req, res) => {
    try {
        const urun = req.body;
        console.log('🔄 Ürün güncelleniyor:', urun.barkod);
        
        // Ensure proper data types and handle null/undefined values
        const barkod = urun.barkod || '';
        const ad = urun.ad || '';
        const marka = urun.marka || '';
        const miktar = parseInt(urun.miktar) || 0;
        const alisFiyati = parseFloat(urun.alisFiyati) || 0;
        const satisFiyati = parseFloat(urun.satisFiyati) || 0;
        const kategori = urun.kategori || '';
        const aciklama = urun.aciklama || '';
        const varyant_id = urun.varyant_id || '';
        const id = urun.id; // Use ID for precise update
        
        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Ürün ID gerekli',
                timestamp: new Date().toISOString()
            });
        }
        
        const result = db.prepare(`
            UPDATE stok SET 
                ad = ?, marka = ?, miktar = ?, alisFiyati = ?, satisFiyati = ?, 
                kategori = ?, aciklama = ?, varyant_id = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `).run(ad, marka, miktar, alisFiyati, satisFiyati, kategori, aciklama, varyant_id, id);
        
        if (result.changes > 0) {
            // Get the updated product with its ID
            const updatedProduct = db.prepare('SELECT * FROM stok WHERE id = ?').get(id);
            
            // Real-time sync to all clients
            io.to('dataSync').emit('dataUpdated', {
                type: 'stok-update',
                data: updatedProduct,
                timestamp: new Date().toISOString()
            });
            
            res.json({ 
                success: true, 
                message: 'Ürün başarıyla güncellendi', 
                data: updatedProduct,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'Ürün bulunamadı', 
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ Ürün güncellenirken hata:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ürün güncellenirken hata', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// GET /api/stok-varyantlar/:barkod - Aynı barkodlu ürün varyantlarını getir
app.get('/api/stok-varyantlar/:barkod', async (req, res) => {
    try {
        const { barkod } = req.params;
        console.log('🔍 Barkod varyantları aranıyor:', barkod);
        
        const variants = db.prepare('SELECT * FROM stok WHERE barkod = ? ORDER BY marka, varyant_id').all(barkod);
        
        res.json({
            success: true,
            data: variants,
            count: variants.length,
            barkod: barkod,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Varyant arama hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Varyant arama hatası',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// DELETE /api/stok-sil/:barkod - Ürün sil
app.delete('/api/stok-sil/:barkod', async (req, res) => {
    try {
        const { barkod } = req.params;
        console.log('🗑️ Ürün siliniyor:', barkod);
        
        const result = db.prepare('DELETE FROM stok WHERE barkod = ?').run(barkod);
        
        if (result.changes > 0) {
            // Real-time sync to all clients
            io.to('dataSync').emit('dataUpdated', {
                type: 'stok-delete',
                data: { barkod },
                timestamp: new Date().toISOString()
            });
            
            res.json({ 
                success: true, 
                message: 'Ürün başarıyla silindi',
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(404).json({ 
                success: false, 
                message: 'Ürün bulunamadı',
                timestamp: new Date().toISOString()
            });
        }
        
    } catch (error) {
        console.error('❌ Ürün silinirken hata:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Ürün silinirken hata', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// POST /api/satis-ekle - Satış ekle
app.post('/api/satis-ekle', async (req, res) => {
    try {
        const satis = req.body;
        console.log('💰 Yeni satış ekleniyor:', satis.barkod, satis.miktar);
        
        // Validate required fields
        if (!satis.barkod || !satis.miktar || satis.miktar <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Barkod ve miktar zorunludur ve miktar 0\'dan büyük olmalıdır',
                timestamp: new Date().toISOString()
            });
        }
        
        // Ensure proper data types and handle null/undefined values
        const barkod = satis.barkod || '';
        
        // Get product name from stock if available
        let urunAdi = satis.urunAdi || '';
        if (!urunAdi) {
            // Load stock data to get product name
            const stokRows = db.prepare('SELECT * FROM stok WHERE barkod = ?').all(barkod);
            if (stokRows.length > 0) {
                urunAdi = stokRows[0].ad;
            }
        }
        const miktar = parseInt(satis.miktar) || 0;
        const fiyat = parseFloat(satis.fiyat) || 0;
        const alisFiyati = parseFloat(satis.alisFiyati) || 0;
        const musteriId = satis.musteriId || null;
        const tarih = satis.tarih || new Date().toISOString();
        const borc = satis.borc ? 1 : 0;
        const toplam = parseFloat(satis.toplam) || (fiyat * miktar);
        
        const result = db.prepare(`
            INSERT INTO satisGecmisi (barkod, urunAdi, miktar, fiyat, alisFiyati, musteriId, tarih, borc, toplam)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(barkod, urunAdi, miktar, fiyat, alisFiyati, musteriId, tarih, borc, toplam);
        
        // Real-time sync to all clients
        io.to('dataSync').emit('dataUpdated', {
            type: 'satis-add',
            data: satis,
            timestamp: new Date().toISOString()
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Satış başarıyla kaydedildi', 
            data: satis,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Satış eklenirken hata:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Satış eklenirken hata', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// POST /api/musteri-ekle - Müşteri ekle
app.post('/api/musteri-ekle', async (req, res) => {
    try {
        const musteri = req.body;
        console.log('👥 Yeni müşteri ekleniyor:', musteri.id, musteri.ad);
        
        // Generate ID if not provided
        if (!musteri.id) {
            musteri.id = 'MST' + Date.now();
        }
        
        // Validate required fields
        if (!musteri.ad) {
            return res.status(400).json({
                success: false,
                message: 'Müşteri adı zorunludur',
                timestamp: new Date().toISOString()
            });
        }
        
        // Ensure proper data types and handle null/undefined values
        const id = musteri.id || '';
        const ad = musteri.ad || '';
        const telefon = musteri.telefon || '';
        const adres = musteri.adres || '';
        const bakiye = parseFloat(musteri.bakiye) || 0;
        
        const result = db.prepare(`
            INSERT OR REPLACE INTO musteriler (id, ad, telefon, adres, bakiye, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(id, ad, telefon, adres, bakiye);
        
        // Real-time sync to all clients
        io.to('dataSync').emit('dataUpdated', {
            type: 'musteri-add',
            data: musteri,
            timestamp: new Date().toISOString()
        });
        
        res.status(201).json({ 
            success: true, 
            message: 'Müşteri başarıyla eklendi', 
            data: musteri,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Müşteri eklenirken hata:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Müşteri eklenirken hata', 
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// POST /api/backup-email - Manuel email backup
app.post('/api/backup-email', async (req, res) => {
    try {
        console.log('📧 Manuel email backup başlatılıyor...');
        
        await sendDailyBackup();
        
        res.json({
            success: true,
            message: 'Email backup başarıyla gönderildi',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Manuel email backup hatası:', error);
        res.status(500).json({
            success: false,
            message: 'Email backup gönderilemedi',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: db !== null ? 'connected' : 'disconnected'
    });
});

// API documentation endpoint
app.get('/api/docs', (req, res) => {
    res.json({
        success: true,
        message: 'API Documentation',
        endpoints: {
            'GET /api/test': 'API test ve database durumu',
            'GET /api/tum-veriler': 'Tüm verileri getir',
            'POST /api/tum-veriler': 'Tüm verileri kaydet',
            'POST /api/stok-ekle': 'Ürün ekle',
            'POST /api/satis-ekle': 'Satış kaydet',
            'POST /api/musteri-ekle': 'Müşteri ekle',
            'GET /api/database-status': 'Database durumu',
            'GET /health': 'Sistem sağlığı',
            'GET /': 'Ana sayfa',
            'GET /test': 'Test sayfası'
        },
        websocket: {
            'requestData': 'Veri isteği gönder',
            'dataUpdate': 'Veri güncelleme gönder',
            'connected': 'Bağlantı onayı al',
            'dataResponse': 'Veri yanıtı al',
            'updateResponse': 'Güncelleme yanıtı al'
        },
        timestamp: new Date().toISOString()
    });
});

// Stock update endpoint
app.put('/api/stok-guncelle', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        const { barkod, ad, miktar, alisFiyati, satisFiyati, kategori, aciklama } = req.body;
        
        if (!barkod) {
            return res.status(400).json({
                success: false,
                message: 'Barkod gerekli'
            });
        }
        
        const updateStock = db.prepare(`
            UPDATE stok SET 
                ad = ?, miktar = ?, alisFiyati = ?, satisFiyati = ?, 
                kategori = ?, aciklama = ?, updated_at = CURRENT_TIMESTAMP
            WHERE barkod = ?
        `);
        
        const result = updateStock.run(
            ad || '',
            parseInt(miktar) || 0,
            parseFloat(alisFiyati) || 0,
            parseFloat(satisFiyati) || 0,
            kategori || '',
            aciklama || '',
            barkod
        );
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ürün bulunamadı'
            });
        }
        
        res.json({
            success: true,
            message: 'Ürün başarıyla güncellendi'
        });
    } catch (error) {
        console.error('❌ Error updating stock:', error);
        res.status(500).json({
            success: false,
            message: 'Ürün güncellenirken hata oluştu',
            error: error.message
        });
    }
});

// Stock delete endpoint
app.delete('/api/stok-sil/:barkod', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        const { barkod } = req.params;
        
        if (!barkod) {
            return res.status(400).json({
                success: false,
                message: 'Barkod gerekli'
            });
        }
        
        const deleteStock = db.prepare('DELETE FROM stok WHERE barkod = ?');
        const result = deleteStock.run(barkod);
        
        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: 'Ürün bulunamadı'
            });
        }
        
        res.json({
            success: true,
            message: 'Ürün başarıyla silindi'
        });
    } catch (error) {
        console.error('❌ Error deleting stock:', error);
        res.status(500).json({
            success: false,
            message: 'Ürün silinirken hata oluştu',
            error: error.message
        });
    }
});

// Legacy endpoints for backward compatibility
app.get('/urunler', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        const rows = db.prepare('SELECT * FROM stok').all();
        let stokData = {};
        rows.forEach(row => { 
            stokData[row.barkod] = {
                barkod: row.barkod,
                ad: row.ad,
                miktar: row.miktar,
                alisFiyati: row.alisFiyati,
                satisFiyati: row.satisFiyati,
                kategori: row.kategori,
                aciklama: row.aciklama,
                eklenmeTarihi: row.created_at
            };
        });
        
        res.json({
            success: true,
            data: stokData,
            message: 'Ürünler başarıyla getirildi'
        });
    } catch (error) {
        console.error('❌ Error getting products:', error);
        res.status(500).json({
            success: false,
            message: 'Ürünler okunurken hata oluştu',
            error: error.message
        });
    }
});

app.post('/urunler', async (req, res) => {
    try {
        if (!db) {
            return res.status(500).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        const { stokListesi } = req.body;
        if (!stokListesi || typeof stokListesi !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Geçersiz veri formatı. stokListesi objesi bekleniyor.'
            });
        }
        
        const transaction = db.transaction(() => {
            // Clear existing stock
            db.prepare('DELETE FROM stok').run();
            
            // Insert new stock data
            const insertStok = db.prepare(`
                INSERT INTO stok (barkod, ad, marka, miktar, alisFiyati, satisFiyati, kategori, aciklama, varyant_id) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            
            let insertedCount = 0;
            for (const key in stokListesi) {
                const urun = stokListesi[key];
                try {
                    // Ensure we use the actual barcode from the product object
                    const barkod = urun.barkod || key;
                    
                    insertStok.run(
                        barkod,
                        urun.ad || '',
                        urun.marka || '',
                        parseInt(urun.miktar) || 0,
                        parseFloat(urun.alisFiyati) || 0,
                        parseFloat(urun.satisFiyati) || 0,
                        urun.kategori || '',
                        urun.aciklama || '',
                        urun.varyant_id || ''
                    );
                    insertedCount++;
                } catch (e) {
                    console.warn(`⚠️ Error inserting product ${key}:`, e.message);
                }
            }
            return insertedCount;
        });
        
        const count = transaction();
        
        res.json({
            success: true,
            message: 'Ürünler başarıyla kaydedildi',
            count: count
        });
    } catch (error) {
        console.error('❌ Error saving products:', error);
        res.status(500).json({
            success: false,
            message: 'Ürünler kaydedilirken hata oluştu',
            error: error.message
        });
    }
});

// Yeni API endpoint'leri
app.get('/api/categories', async (req, res) => {
    try {
        const categories = db.prepare('SELECT DISTINCT kategori FROM stok WHERE kategori IS NOT NULL AND kategori != "" ORDER BY kategori').all();
        res.json({
            success: true,
            data: categories.map(c => c.kategori)
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.post('/api/bulk-update', async (req, res) => {
    try {
        const { operation, products, value } = req.body;
        
        if (!operation || !products || products.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Geçersiz parametreler'
            });
        }
        
        const transaction = db.transaction(() => {
            let updatedCount = 0;
            
            products.forEach(barkod => {
                try {
                    switch(operation) {
                        case 'price_update':
                            db.prepare('UPDATE stok SET satisFiyati = ? WHERE barkod = ?').run(value, barkod);
                            break;
                        case 'stock_update':
                            db.prepare('UPDATE stok SET miktar = ? WHERE barkod = ?').run(value, barkod);
                            break;
                        case 'category_update':
                            db.prepare('UPDATE stok SET kategori = ? WHERE barkod = ?').run(value, barkod);
                            break;
                    }
                    updatedCount++;
                } catch (e) {
                    console.warn(`⚠️ Error updating product ${barkod}:`, e.message);
                }
            });
            
            return updatedCount;
        });
        
        const count = transaction();
        
        res.json({
            success: true,
            message: `${count} ürün güncellendi`,
            count: count
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// POST /api/stok-guncelle-barkod - Update existing product with same barcode
app.post('/api/stok-guncelle-barkod', async (req, res) => {
    try {
        const { barkod, ad, marka, miktar, alisFiyati, satisFiyati, kategori, aciklama, varyant_id } = req.body;
        
        if (!barkod || !ad) {
            return res.status(400).json({
                success: false,
                message: 'Barkod ve ürün adı zorunludur',
                timestamp: new Date().toISOString()
            });
        }
        
        // Check if product exists
        const existingProduct = db.prepare('SELECT * FROM stok WHERE barkod = ?').get(barkod);
        
        if (!existingProduct) {
            return res.status(404).json({
                success: false,
                message: 'Ürün bulunamadı',
                timestamp: new Date().toISOString()
            });
        }
        
        // Update the existing product
        const result = db.prepare(`
            UPDATE stok SET 
                ad = ?, marka = ?, miktar = ?, alisFiyati = ?, satisFiyati = ?, 
                kategori = ?, aciklama = ?, varyant_id = ?, updated_at = CURRENT_TIMESTAMP 
            WHERE barkod = ?
        `).run(ad, marka || '', miktar || 0, alisFiyati || 0, satisFiyati || 0, 
                kategori || '', aciklama || '', varyant_id || '', barkod);
        
        const updatedProduct = db.prepare('SELECT * FROM stok WHERE barkod = ?').get(barkod);
        
        // Real-time sync to all clients
        io.to('dataSync').emit('dataUpdated', {
            type: 'stok-update',
            data: updatedProduct,
            timestamp: new Date().toISOString()
        });
        
        res.json({ 
            success: true, 
            message: 'Ürün başarıyla güncellendi', 
            data: updatedProduct,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Reset database endpoint
app.post('/api/reset-database', async (req, res) => {
    try {
        const transaction = db.transaction(() => {
            // Clear all tables
            db.prepare('DELETE FROM stok').run();
            db.prepare('DELETE FROM musteriler').run();
            db.prepare('DELETE FROM satisGecmisi').run();
            
            // Reset auto-increment counters
            db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('stok', 'satisGecmisi')").run();
            
            return {
                stok: db.prepare('SELECT COUNT(*) as count FROM stok').get().count,
                musteriler: db.prepare('SELECT COUNT(*) as count FROM musteriler').get().count,
                satisGecmisi: db.prepare('SELECT COUNT(*) as count FROM satisGecmisi').get().count
            };
        });
        
        const counts = transaction();
        
        res.json({
            success: true,
            message: 'Tüm veriler başarıyla silindi',
            counts: counts
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test sayfası
app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'test.html'));
});

// Ana sayfa için HTML dosyasını serve et
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'try.html'));
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const networkInterfaces = os.networkInterfaces();
    let localIP = 'localhost';
    
    // Find local IP address
    for (const name of Object.keys(networkInterfaces)) {
        for (const interface of networkInterfaces[name]) {
            if (interface.family === 'IPv4' && !interface.internal) {
                localIP = interface.address;
                break;
            }
        }
        if (localIP !== 'localhost') break;
    }
    
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📊 Database: ${dbPath}`);
    console.log(`🔗 WebSocket: ws://localhost:${PORT}`);
    console.log(`🌐 HTTP: http://localhost:${PORT}`);
    console.log(`🌐 Local Network: http://${localIP}:${PORT}`);
    console.log(`🧪 Test: http://localhost:${PORT}/test`);
    console.log(`📋 API Docs: http://localhost:${PORT}/api/test`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    if (db) {
        db.close();
        console.log('✅ Database connection closed');
    }
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down server...');
    if (db) {
        db.close();
        console.log('✅ Database connection closed');
    }
    server.close(() => {
        console.log('✅ Server stopped');
        process.exit(0);
    });
});