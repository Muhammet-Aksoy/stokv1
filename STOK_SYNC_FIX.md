# Stock Synchronization UNIQUE Constraint Fix

## Problem
The system was experiencing UNIQUE constraint violations during stock synchronization:
```
⚠ Stok sync error for 123456: UNIQUE constraint failed: stok.barkod, stok.marka, stok.varyant_id
```

## Root Cause
The `stok` table has a UNIQUE constraint on the combination of `barkod`, `marka`, and `varyant_id`. However, the synchronization logic was only checking for existing records using the `barkod` field alone:

```javascript
const existing = db.prepare('SELECT id FROM stok WHERE barkod = ?').get(barkod);
```

This caused issues when trying to insert multiple variants of the same product (same barcode but different `marka` or `varyant_id`), as the system would only find the first variant and then try to insert duplicates.

## Solution
Updated the stock synchronization logic to properly handle the composite unique constraint:

### 1. Fixed Stock Sync Logic
- **Before**: Only checked `barkod` for existing records
- **After**: Checks the combination of `barkod`, `marka`, and `varyant_id`

```javascript
// Old code
const existing = db.prepare('SELECT id FROM stok WHERE barkod = ?').get(barkod);

// New code
const existing = db.prepare('SELECT id FROM stok WHERE barkod = ? AND marka = ? AND varyant_id = ?').get(barkod, marka, varyant_id);
```

### 2. Updated WHERE Clauses
- **Before**: UPDATE operations used only `barkod` in WHERE clause
- **After**: UPDATE operations use the full composite key

```javascript
// Old code
WHERE barkod = ?

// New code  
WHERE barkod = ? AND marka = ? AND varyant_id = ?
```

### 3. Fixed Bulk Import
Updated the bulk import function to include `marka` and `varyant_id` columns:

```javascript
// Old code
INSERT INTO stok (barkod, ad, miktar, alisFiyati, satisFiyati, kategori, aciklama) 
VALUES (?, ?, ?, ?, ?, ?, ?)

// New code
INSERT INTO stok (barkod, ad, marka, miktar, alisFiyati, satisFiyati, kategori, aciklama, varyant_id) 
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
```

## Benefits
1. **Eliminates UNIQUE constraint violations** during synchronization
2. **Properly handles product variants** with the same barcode but different brands or variant IDs
3. **Maintains data integrity** by respecting the composite unique constraint
4. **Improves synchronization reliability** by preventing duplicate insertions

## Database Schema
The `stok` table structure includes:
```sql
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
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(barkod, marka, varyant_id)
)
```

## Testing Recommendations
1. Test synchronization with products that have multiple variants
2. Verify that bulk operations work correctly with variant products
3. Check that real-time updates work properly for variant products
4. Ensure that the fix doesn't break existing functionality for single-variant products

## Files Modified
- `server.js`: Updated stock synchronization logic and bulk import function